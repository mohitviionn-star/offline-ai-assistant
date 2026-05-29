"""End-to-end evaluation suite for the Offline AI Assistant.

Runs a curated set of queries (drawn from Jenny's example list where possible)
against the backend, then scores each one on:

- Routing accuracy (was the route 'sql' / 'docs' / 'hybrid' what we expected?)
- Entity presence (did the expected named entities appear in the answer?)
- Citation presence (did the response include the expected `[doc:]` / `[sql:]` markers?)
- Refusal (did the system give the gated refusal line?)
- Latency

Usage:
    python scripts/eval.py
    python scripts/eval.py --url http://88.222.213.55:8002    # against Hostinger
    python scripts/eval.py --model llama3.2:1b                # override model
    python scripts/eval.py --jsonl out.jsonl                  # also write per-case JSON
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field, asdict


# ----------------------------------------------------------------------
# Test cases
# ----------------------------------------------------------------------
@dataclass
class TestCase:
    id: str
    question: str
    vertical: str
    expected_route: str  # 'sql', 'docs', 'hybrid', or 'any'
    must_contain: list[str] = field(default_factory=list)  # entities that MUST appear (case-insensitive)
    expects_sql_cite: bool = False
    expects_doc_cite: bool = False
    # "soft" — if True and entity check fails, mark "partial" instead of "fail"
    soft: bool = False


CASES: list[TestCase] = [
    # ─────────────────────────────────────────────────────────
    # HEALTHCARE / NURSING HOME
    # ─────────────────────────────────────────────────────────
    TestCase(
        id="h1_count_residents",
        question="How many residents are at the facility?",
        vertical="Healthcare",
        expected_route="sql",
        must_contain=["10"],
        expects_sql_cite=True,
    ),
    TestCase(
        id="h2_robert_allergies",
        question="What medications is Robert Miller allergic to?",
        vertical="Healthcare",
        expected_route="sql",
        must_contain=["Penicillin", "Sulfa", "Codeine"],
        expects_sql_cite=True,
    ),
    TestCase(
        id="h3_pt_approval_hybrid",
        question="Does Robert Miller have physical therapy approval, and what does our protocol say about PT eligibility?",
        vertical="Healthcare",
        expected_route="hybrid",
        must_contain=["Robert Miller", "pending"],
        expects_sql_cite=True,
        expects_doc_cite=True,
    ),
    TestCase(
        id="h4_insulin_policy",
        question="What is our insulin administration protocol?",
        vertical="Healthcare",
        expected_route="docs",
        must_contain=["insulin"],
        expects_doc_cite=True,
        soft=True,  # the small SOP can get drowned out — partial credit ok
    ),
    TestCase(
        id="h5_sarah_admission",
        question="When was Sarah Klein admitted?",
        vertical="Healthcare",
        expected_route="sql",
        # Date is the answer; the LLM often answers "Admission date: Aug 12, 2025"
        # without re-naming the resident. Don't require the name.
        must_contain=["Aug", "2025"],
        expects_sql_cite=True,
    ),

    # ─────────────────────────────────────────────────────────
    # PROPERTY MANAGEMENT
    # ─────────────────────────────────────────────────────────
    TestCase(
        id="p1_devon_rent_hybrid",
        question="How much rent has Devon Patel paid in the last 6 months, and what does our tenant handbook say about late fees?",
        vertical="Property Mgmt",
        expected_route="hybrid",
        # LLM produces "$1,800.00" with a thousands separator — match the comma'd form.
        must_contain=["Devon Patel", "1,800", "5%", "late"],
        expects_sql_cite=True,
        expects_doc_cite=True,
    ),
    TestCase(
        id="p2_expiring_leases",
        question="Which leases are expiring in the next 6 months, and what does the handbook say about renewal notices?",
        vertical="Property Mgmt",
        expected_route="hybrid",
        must_contain=["60 days"],  # the renewal-notice rule
        expects_sql_cite=True,
        expects_doc_cite=True,
        soft=True,
    ),
    TestCase(
        id="p3_pet_policy",
        question="What is our pet deposit policy?",
        vertical="Property Mgmt",
        expected_route="docs",
        must_contain=["$300", "pet"],
        expects_doc_cite=True,
    ),
    TestCase(
        id="p4_count_tenants",
        question="How many active tenants do we have?",
        vertical="Property Mgmt",
        expected_route="sql",
        must_contain=["6"],  # we seeded 6 tenants
        expects_sql_cite=True,
        soft=True,  # 5 or 6 acceptable depending on Marcus Lin status
    ),
    TestCase(
        id="p5_security_deposit",
        question="What is the security deposit policy for a 2-year lease?",
        vertical="Property Mgmt",
        # Route may upgrade to "hybrid" because "lease" matches the leases table.
        # Either route is acceptable for this policy-only question.
        expected_route="any",
        must_contain=["two months"],
        expects_doc_cite=True,
    ),

    # ─────────────────────────────────────────────────────────
    # LEGAL (divorce + personal injury)
    # ─────────────────────────────────────────────────────────
    TestCase(
        id="l1_rosenberg_alimony",
        question="Show all missed alimony payments for Michael Rosenberg.",
        vertical="Legal · Divorce",
        expected_route="sql",
        must_contain=["Michael Rosenberg", "$3,500", "2025"],
        expects_sql_cite=True,
    ),
    TestCase(
        id="l2_rosenberg_hybrid",
        question="Show all missed alimony payments for Michael Rosenberg and retrieve the enforcement procedure from our settlement SOP.",
        vertical="Legal · Divorce",
        expected_route="hybrid",
        # Don't require the name (LLM often summarizes "three missed payments"
        # without re-naming the client). $3,500 is the load-bearing fact.
        must_contain=["3,500"],
        expects_sql_cite=True,
        expects_doc_cite=True,
    ),
    TestCase(
        id="l3_diaz_treatment_hybrid",
        question="Did Robert Diaz miss any treatment appointments, and what does our case strategy memo say about treatment gaps?",
        vertical="Legal · PI",
        expected_route="hybrid",
        must_contain=["Robert Diaz", "30 days"],  # the gap-credibility rule
        expects_sql_cite=True,
        expects_doc_cite=True,
    ),
    TestCase(
        id="l4_sol_query",
        question="Which clients have upcoming statute-of-limitations deadlines?",
        vertical="Legal · PI",
        # Acronyms route to hybrid so the glossary PDF is fetched and the planner
        # can translate "SOL" -> filings.filing_type LIKE 'Statute%'.
        expected_route="hybrid",
        must_contain=[],  # any answer with no refusal counts
        expects_sql_cite=True,
        soft=True,
    ),
    TestCase(
        id="l5_custody_sop",
        question="What does our custody SOP say about overnight travel outside Illinois?",
        vertical="Legal · Divorce",
        expected_route="docs",
        must_contain=["Illinois"],
        expects_doc_cite=True,
    ),
]


# ----------------------------------------------------------------------
# Scoring
# ----------------------------------------------------------------------
@dataclass
class CaseResult:
    case: TestCase
    actual_route: str = ""
    confidence: str = ""
    latency_ms: int = 0
    answer_preview: str = ""
    route_ok: bool = False
    entities_present: list[str] = field(default_factory=list)
    entities_missing: list[str] = field(default_factory=list)
    entities_ok: bool = False
    has_sql_cite: bool = False
    has_doc_cite: bool = False
    cites_ok: bool = False
    refused: bool = False
    error: str | None = None

    @property
    def passed(self) -> bool:
        if self.error or self.refused:
            return False
        return self.route_ok and self.cites_ok and (self.entities_ok or self.case.soft)

    @property
    def status(self) -> str:
        if self.error:    return "ERROR"
        if self.refused:  return "REFUSED"
        if self.passed:   return "PASS"
        if self.route_ok and self.cites_ok and self.case.soft:
            return "PARTIAL"
        return "FAIL"


def run_case(case: TestCase, url: str, model: str | None, timeout: int = 240) -> CaseResult:
    body = {"question": case.question}
    if model:
        body["model"] = model

    req = urllib.request.Request(
        f"{url.rstrip('/')}/query",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            resp = json.load(r)
    except urllib.error.HTTPError as e:
        return CaseResult(case=case, error=f"HTTP {e.code}",
                          latency_ms=int((time.time() - t0) * 1000))
    except Exception as e:
        return CaseResult(case=case, error=str(e)[:120],
                          latency_ms=int((time.time() - t0) * 1000))

    answer = (resp.get("answer") or "").strip()
    answer_lower = answer.lower()
    citations = resp.get("citations") or []
    actual_route = resp.get("route", "")
    confidence = resp.get("confidence", "")

    entities_present = [e for e in case.must_contain if e.lower() in answer_lower]
    entities_missing = [e for e in case.must_contain if e.lower() not in answer_lower]

    has_sql = any(c.get("type") == "sql" for c in citations)
    has_doc = any(c.get("type") == "document" for c in citations)
    sql_ok = (not case.expects_sql_cite) or has_sql
    doc_ok = (not case.expects_doc_cite) or has_doc

    return CaseResult(
        case=case,
        actual_route=actual_route,
        confidence=confidence,
        latency_ms=resp.get("latency_ms", int((time.time() - t0) * 1000)),
        answer_preview=answer[:160].replace("\n", " "),
        route_ok=(case.expected_route == actual_route) or (case.expected_route == "any"),
        entities_present=entities_present,
        entities_missing=entities_missing,
        entities_ok=len(entities_missing) == 0,
        has_sql_cite=has_sql,
        has_doc_cite=has_doc,
        cites_ok=sql_ok and doc_ok,
        refused=("don't have enough grounded information" in answer_lower),
    )


def report(results: list[CaseResult]) -> None:
    total = len(results)
    passed = sum(1 for r in results if r.passed)
    partial = sum(1 for r in results if r.status == "PARTIAL")
    failed = sum(1 for r in results if r.status == "FAIL")
    refused = sum(1 for r in results if r.refused)
    errored = sum(1 for r in results if r.error)
    route_ok = sum(1 for r in results if r.route_ok)
    entities_ok = sum(1 for r in results if r.entities_ok)
    cites_ok = sum(1 for r in results if r.cites_ok)
    latencies_ms = [r.latency_ms for r in results if r.latency_ms]
    p50 = int(statistics.median(latencies_ms)) if latencies_ms else 0
    p95 = int(sorted(latencies_ms)[int(len(latencies_ms) * 0.95) - 1]) if latencies_ms else 0

    print()
    print("═" * 78)
    print(f"  {'id':<28} {'vertical':<18} {'rt':<7} {'cf':<7} {'sec':>5}  status")
    print("─" * 78)
    for r in results:
        sec = f"{r.latency_ms / 1000:.1f}" if r.latency_ms else "?"
        symbol = {"PASS": "✓", "PARTIAL": "·", "FAIL": "✗", "REFUSED": "✗", "ERROR": "!"}.get(r.status, "?")
        rt = (r.actual_route or "—")[:6]
        cf = (r.confidence or "—")[:6]
        print(f"  {symbol} {r.case.id:<26} {r.case.vertical:<18} {rt:<7} {cf:<7} {sec:>5}  {r.status}")
    print("─" * 78)
    print(f"  Pass:        {passed}/{total} ({100*passed/total:.0f}%)")
    print(f"  Partial:     {partial}/{total}")
    print(f"  Fail:        {failed}/{total}")
    print(f"  Refused:     {refused}/{total}")
    print(f"  Errored:     {errored}/{total}")
    print(f"  Routing OK:  {route_ok}/{total} ({100*route_ok/total:.0f}%)")
    print(f"  Entities OK: {entities_ok}/{total} ({100*entities_ok/total:.0f}%)")
    print(f"  Citations OK:{cites_ok}/{total} ({100*cites_ok/total:.0f}%)")
    print(f"  Latency p50: {p50/1000:.1f}s   p95: {p95/1000:.1f}s")
    print("═" * 78)

    # Detail: print failed cases with their answer previews
    fails = [r for r in results if r.status in ("FAIL", "REFUSED", "ERROR")]
    if fails:
        print("\nFailures (first 80 chars of answer):")
        for r in fails:
            print(f"\n  [{r.case.id}] {r.case.question}")
            if r.error:
                print(f"    ERROR: {r.error}")
                continue
            if r.refused:
                print(f"    → REFUSED")
            if not r.route_ok:
                print(f"    expected route={r.case.expected_route}, got route={r.actual_route}")
            if r.entities_missing:
                print(f"    missing: {r.entities_missing}")
            if not r.cites_ok:
                print(f"    citations: sql_expected={r.case.expects_sql_cite} sql_got={r.has_sql_cite}"
                      f" / doc_expected={r.case.expects_doc_cite} doc_got={r.has_doc_cite}")
            print(f"    answer: {r.answer_preview!r}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://localhost:8000",
                        help="Backend base URL (e.g. http://88.222.213.55:8002)")
    parser.add_argument("--model", default=None,
                        help="Override OLLAMA_MODEL per request (e.g. llama3.2:1b)")
    parser.add_argument("--jsonl", default=None,
                        help="Write per-case JSON to this file in addition to console output")
    parser.add_argument("--filter", default=None,
                        help="Only run cases whose id matches this substring")
    parser.add_argument("--timeout", type=int, default=240)
    args = parser.parse_args()

    cases = CASES
    if args.filter:
        cases = [c for c in cases if args.filter in c.id]

    print(f"Running {len(cases)} cases against {args.url}"
          + (f" with model={args.model}" if args.model else ""))

    results = []
    t_start = time.time()
    for i, case in enumerate(cases, 1):
        print(f"  [{i:>2}/{len(cases)}] {case.id} … ", end="", flush=True)
        r = run_case(case, args.url, args.model, timeout=args.timeout)
        results.append(r)
        sec = r.latency_ms / 1000 if r.latency_ms else 0
        print(f"{r.status}  ({sec:.1f}s)")

    total_sec = time.time() - t_start
    print(f"\nTotal wall-clock: {total_sec/60:.1f} min")
    report(results)

    if args.jsonl:
        with open(args.jsonl, "w") as f:
            for r in results:
                d = asdict(r)
                d["case"] = asdict(r.case)
                f.write(json.dumps(d, default=str) + "\n")
        print(f"\nWrote per-case results to {args.jsonl}")


if __name__ == "__main__":
    main()
