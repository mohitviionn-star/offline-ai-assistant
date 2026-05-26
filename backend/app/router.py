import json
from typing import Any

from .config import settings
from .ollama_client import OllamaClient
from .tool_docs import search_documents
from .tool_sql import execute_sql, schema_summary, table_names

# Retrieval-quality gate: below this top-1 cosine score, treat document hits as weak.
DOC_SCORE_FLOOR = 0.40
REFUSAL_LINE = (
    "I don't have enough grounded information to answer that. "
    "Try rephrasing or upload a relevant document."
)

# ----------------------------------------------------------------------
# Combined router + SQL-gen prompt (was previously 2 separate LLM calls)
# ----------------------------------------------------------------------
PLAN_SYSTEM = """You are the planner for a grounded business assistant.

You decide how to answer a question using two evidence sources, and (if SQL is needed) you also produce the SQL query in the same response.

EVIDENCE SOURCES:
- search_documents: vector search over PDFs/policies/notes
- query_database: SELECT-only SQLite over the user's database

DECISION HEURISTIC — apply in order:

1. LOOK AT THE SCHEMA BELOW. Note every table name and what it represents.
2. If the question asks "what/who/which/list/show/how many <X>" where <X> matches a table name (singular or plural), route = "sql".
3. If the question is about policy, rules, terms, what the handbook/SOP/contract SAYS — route = "docs".
4. If the question needs BOTH (records from the database AND policy/text from the documents) — route = "hybrid".
5. When in doubt between docs and hybrid, PREFER hybrid.
6. NEVER refuse to route — pick the best match.

SQL GENERATION RULES (apply when route is "sql" or "hybrid"):
- Output a single SQLite SELECT query. No INSERT/UPDATE/DELETE/DDL.
- ALWAYS alias aggregates (e.g. SELECT COUNT(*) AS resident_count, not SELECT COUNT(*)).
- When the question mentions a specific person by name, JOIN to that person's row by name. For example, if `medications` has `resident_id` and the question is "What is Robert Miller allergic to?", JOIN with `residents` ON `residents.id = medications.resident_id` and filter `WHERE residents.first_name = 'Robert' AND residents.last_name = 'Miller'`.
- Prefer explicit columns over SELECT *.
- LIMIT 50 unless the question asks for an aggregate.
- Use only SQLite-compatible functions. NEVER use PostgreSQL-only functions (JSON_AGG, jsonb_agg, row_to_json, ARRAY_AGG). Use sqlite functions like COUNT, SUM, GROUP_CONCAT instead.
- If a SQL query is not appropriate, leave "sql_query" as an empty string.

OUTPUT ONLY this exact JSON shape (no prose, no markdown fences):
{
  "route": "docs" | "sql" | "hybrid",
  "docs_query": "<short keyword query or null>",
  "sql_query": "<a SQLite SELECT query, or empty string if not sql/hybrid>",
  "sql_rationale": "<one short line explaining what the SQL does, or empty>",
  "rationale": "<one short line for the overall routing decision>"
}

FEW-SHOT EXAMPLES (schema: residents, medications, pt_approvals, falls, clients, cases, alimony_payments, treatments, properties):

Q: "How many residents are at the facility?"
{"route":"sql","docs_query":null,"sql_query":"SELECT COUNT(*) AS resident_count FROM residents","sql_rationale":"Count rows in residents","rationale":"counting residents"}

Q: "What is our insulin administration policy?"
{"route":"docs","docs_query":"insulin administration policy protocol","sql_query":"","sql_rationale":"","rationale":"policy from SOP docs"}

Q: "What medications is Robert Miller allergic to?"
{"route":"sql","docs_query":null,"sql_query":"SELECT m.drug_name FROM medications m JOIN residents r ON r.id = m.resident_id WHERE r.first_name = 'Robert' AND r.last_name = 'Miller' AND m.is_allergy = 1","sql_rationale":"List Robert Miller's allergy entries","rationale":"specific person's records = sql, not policy"}

Q: "Show all missed alimony payments for Michael Rosenberg."
{"route":"sql","docs_query":null,"sql_query":"SELECT ap.due_date, ap.amount, ap.status FROM alimony_payments ap JOIN cases c ON c.id = ap.case_id JOIN clients cl ON cl.id = c.client_id WHERE cl.first_name = 'Michael' AND cl.last_name = 'Rosenberg' AND ap.status = 'missed' LIMIT 50","sql_rationale":"Missed alimony entries for Michael Rosenberg","rationale":"specific person + table 'alimony_payments'"}

Q: "Did Robert Diaz miss any treatment appointments, and what does our case strategy memo say about treatment gaps?"
{"route":"hybrid","docs_query":"treatment gaps case strategy","sql_query":"SELECT t.treatment_date, t.provider, t.status FROM treatments t JOIN clients cl ON cl.id = t.client_id WHERE cl.first_name = 'Robert' AND cl.last_name = 'Diaz' AND t.status = 'missed' LIMIT 50","sql_rationale":"Robert Diaz missed treatments","rationale":"records + policy memo"}

The user's question + database schema follow.
"""

ANSWER_SYSTEM = """You are a precise business assistant. You answer ONLY from the provided context.

LENGTH: Keep answers to 100 words or less. Be concise. No preamble.

EVIDENCE IS SUFFICIENT IF EITHER source has it. You do NOT need both to be present:
- DATABASE EVIDENCE alone IS sufficient to answer a question about specific records (people, payments, dates, counts).
- DOCUMENT EVIDENCE alone IS sufficient to answer a question about policy, rules, or procedures.
- Refuse ONLY when neither source has anything relevant. Do not refuse just because one side is missing or off-topic.

WHEN TO USE BOTH
- If both DATABASE and DOCUMENT EVIDENCE are provided, you MUST use BOTH:
  enumerate the database rows by name/value, then add the relevant policy from the documents.
- If the document evidence isn't directly relevant to the question, ignore it and answer from the database. Don't refuse.

CITATION RULES
- Every factual claim ends with a citation marker.
- For document claims: copy the tag exactly as shown at the start of the chunk (`[doc:filename p.N]`).
- For SQL claims: use the `[sql:...]` tag from the DATABASE EVIDENCE block.
- Only use `[sql:...]` if the context contains "DATABASE EVIDENCE:". Only use `[doc:...]` if the context contains "DOCUMENT EVIDENCE:".
- Do NOT use prior knowledge. Do NOT invent citations, page numbers, or values.

READING SQL RESULTS — READ LITERALLY
- If you see `ANSWER (use this exact value): <X>`, then `<X>` IS the answer. Use it with the `[sql:...]` citation.
- If you see `N row(s) returned:` followed by JSON, enumerate the entries by their visible fields.
- If you see `ANSWER: no rows match.`, say there are no matching records.

REFUSAL — use ONLY when neither source has relevant evidence:
"I don't have enough grounded information to answer that. Try rephrasing or upload a relevant document."
"""


# ----------------------------------------------------------------------
# Planning + SQL gen in ONE LLM call
# ----------------------------------------------------------------------
async def plan_and_sql(question: str, model: str | None = None) -> dict[str, Any]:
    """Single LLM call that returns route + docs_query + sql_query (if applicable).
    Replaces the previous two-call sequence of plan() + nl_to_sql()."""
    client = OllamaClient(model=model)
    schema = schema_summary(include_samples=False)  # terse schema — faster prefill
    user_msg = f"Database schema:\n{schema}\n\nUser question: {question}"
    resp = await client.chat(
        messages=[
            {"role": "system", "content": PLAN_SYSTEM},
            {"role": "user", "content": user_msg},
        ],
        temperature=0.0,
        format="json",
    )
    raw = resp.get("message", {}).get("content", "{}")
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        parsed = {"route": "docs", "docs_query": question, "sql_query": "", "rationale": "router fallback"}

    parsed.setdefault("route", "docs")
    parsed.setdefault("docs_query", question if parsed["route"] in ("docs", "hybrid") else None)
    parsed.setdefault("sql_query", "")
    parsed.setdefault("sql_rationale", "")
    parsed.setdefault("rationale", "")

    # SAFETY UPGRADE: if router chose docs-only but the question references a table entity,
    # upgrade to hybrid. SQL won't be auto-filled but the existing flow can still surface evidence.
    if parsed["route"] == "docs":
        q_lower = question.lower()
        try:
            tables = [t.lower() for t in table_names()]
        except Exception:
            tables = []
        for t in tables:
            forms = {t, t.rstrip("s"), t + "s"}
            if any(form and form in q_lower for form in forms):
                parsed["route"] = "hybrid"
                parsed["rationale"] = (
                    parsed.get("rationale", "") + f" | upgraded to hybrid (matched table '{t}')"
                ).strip(" |")
                break

    return parsed


# Backwards-compat shim — keeps older imports working.
async def plan(question: str, model: str | None = None) -> dict[str, Any]:
    p = await plan_and_sql(question, model=model)
    p.setdefault("sql_question", question if p.get("route") in ("sql", "hybrid") else None)
    return p


# ----------------------------------------------------------------------
# Context formatters (unchanged)
# ----------------------------------------------------------------------
def _format_doc_context(chunks: list[dict]) -> str:
    if not chunks:
        return "(no document hits)"
    parts = []
    for c in chunks:
        parts.append(
            f"[doc:{c['filename']} p.{c['page']}] score={c['score']}\n{c['text']}"
        )
    return "\n\n".join(parts)


def _format_sql_context(sql_result: dict) -> str:
    if not sql_result or not sql_result.get("sql"):
        return "(no SQL result)"
    cite = f"[sql:{sql_result['sql'][:80]}]"
    if sql_result.get("error"):
        return f"{cite} ERROR: {sql_result['error']}"
    rows = sql_result.get("rows", []) or []
    row_count = sql_result.get("row_count", len(rows))

    # Scalar / single-cell aggregate: put the answer FIRST, no row-count noise.
    if len(rows) == 1 and isinstance(rows[0], dict) and len(rows[0]) == 1:
        only_col, only_val = next(iter(rows[0].items()))
        return f"{cite}\nANSWER (use this exact value): {only_val}\n(column name: {only_col})"

    # Empty result.
    if row_count == 0:
        return f"{cite}\nANSWER: no rows match."

    # Multi-row: show row_count and the JSON rows.
    body = json.dumps(rows[:20], default=str, indent=2)
    return f"{cite}\n{row_count} row(s) returned:\n{body}"


# ----------------------------------------------------------------------
# Deterministic SQL-only answer composer (skips the answer LLM call)
# ----------------------------------------------------------------------
def _deterministic_sql_answer(sql_result: dict, question: str) -> str:
    """Format an SQL-only answer without calling the answer LLM.
    Used when route='sql' and SQL evidence is strong — saves ~60-100s on CPU hosts."""
    sql = sql_result.get("sql", "")
    cite = f"[sql:{sql[:80]}]"
    rows = sql_result.get("rows", []) or []
    row_count = sql_result.get("row_count", len(rows))

    if row_count == 0:
        return f"No matching records found. {cite}"

    # Scalar: single row, single column → use the value directly.
    if len(rows) == 1 and isinstance(rows[0], dict) and len(rows[0]) == 1:
        col, val = next(iter(rows[0].items()))
        # Phrase the answer based on the column name where possible.
        col_human = col.replace("_", " ")
        return f"{val} ({col_human}). {cite}"

    # Single row, multiple columns → render as key: value, key: value, ...
    if len(rows) == 1:
        kv = ", ".join(f"{k}: {v}" for k, v in rows[0].items() if v is not None)
        return f"{kv}. {cite}"

    # Multiple rows → show row count + enumerate
    preview = rows[:10]
    lines = [f"{row_count} matching record(s):"]
    for r in preview:
        # Take first 2-3 informative fields per row
        fields = [f"{k}={v}" for k, v in r.items() if v is not None and not isinstance(v, (dict, list))][:4]
        lines.append("  - " + ", ".join(fields))
    if row_count > len(preview):
        lines.append(f"  ... ({row_count - len(preview)} more)")
    lines.append(cite)
    return "\n".join(lines)


# ----------------------------------------------------------------------
# Main answer pipeline
# ----------------------------------------------------------------------
async def answer(question: str, model: str | None = None) -> dict[str, Any]:
    p = await plan_and_sql(question, model=model)
    route = p["route"]

    docs: list[dict] = []
    sql_result: dict = {}

    if route in ("docs", "hybrid") and p.get("docs_query"):
        docs = search_documents(p["docs_query"])

    # Execute the SQL the planner produced (no extra LLM call).
    if route in ("sql", "hybrid") and p.get("sql_query"):
        sql_result = execute_sql(p["sql_query"], p.get("sql_rationale", ""))

    # RETRIEVAL-QUALITY GATE — refuse before calling the answer LLM if evidence is weak.
    strong_docs = bool(docs) and any(d.get("score", 0) >= DOC_SCORE_FLOOR for d in docs)
    strong_sql = bool(sql_result.get("sql")) and not sql_result.get("error") and sql_result.get("row_count", 0) > 0
    if not strong_docs and not strong_sql:
        return {
            "answer": REFUSAL_LINE,
            "route": route,
            "rationale": (p.get("rationale", "") + " | gated: no strong evidence").strip(" |"),
            "citations": _build_citations(docs, sql_result),
            "evidence": {"documents": docs, "sql": sql_result},
            "confidence": "refused",
            "gated": True,
        }

    # FAST PATH — pure SQL route with strong evidence: skip the answer LLM entirely.
    # This is the single biggest CPU-host speedup (saves ~60-100s).
    if route == "sql" and strong_sql and not docs:
        answer_text = _deterministic_sql_answer(sql_result, question)
        return {
            "answer": answer_text,
            "route": route,
            "rationale": p.get("rationale", ""),
            "citations": _build_citations(docs, sql_result),
            "evidence": {"documents": docs, "sql": sql_result},
            "confidence": "medium",
            "fast_path": True,
        }

    # Otherwise, compose with the answer LLM.
    context_blocks = []
    if docs:
        context_blocks.append("DOCUMENT EVIDENCE:\n" + _format_doc_context(docs))
    if sql_result:
        context_blocks.append("DATABASE EVIDENCE:\n" + _format_sql_context(sql_result))
    context = "\n\n".join(context_blocks) if context_blocks else "(no evidence retrieved)"

    client = OllamaClient(model=model)
    resp = await client.chat(
        messages=[
            {"role": "system", "content": ANSWER_SYSTEM},
            {"role": "user", "content": f"Context:\n{context}\n\nQuestion: {question}"},
        ],
        temperature=0.1,
    )
    answer_text = resp.get("message", {}).get("content", "").strip()

    citations = _build_citations(docs, sql_result)
    confidence = _confidence(answer_text, docs, sql_result)

    return {
        "answer": answer_text,
        "route": route,
        "rationale": p.get("rationale", ""),
        "citations": citations,
        "evidence": {
            "documents": docs,
            "sql": sql_result,
        },
        "confidence": confidence,
    }


async def answer_stream(question: str, model: str | None = None):
    """Streaming version of answer(): yields (event_type, data) tuples.
    Event types:
      - 'meta'  → routing + citations + evidence (sent ONCE up front, before tokens)
      - 'token' → a string fragment of the answer (zero or more)
      - 'done'  → final confidence + latency_ms
    """
    import time
    t0 = time.time()
    p = await plan_and_sql(question, model=model)
    route = p["route"]

    docs: list[dict] = []
    sql_result: dict = {}

    if route in ("docs", "hybrid") and p.get("docs_query"):
        docs = search_documents(p["docs_query"])
    if route in ("sql", "hybrid") and p.get("sql_query"):
        sql_result = execute_sql(p["sql_query"], p.get("sql_rationale", ""))

    strong_docs = bool(docs) and any(d.get("score", 0) >= DOC_SCORE_FLOOR for d in docs)
    strong_sql = bool(sql_result.get("sql")) and not sql_result.get("error") and sql_result.get("row_count", 0) > 0
    citations = _build_citations(docs, sql_result)

    meta = {
        "route": route,
        "rationale": p.get("rationale", ""),
        "citations": citations,
        "evidence": {"documents": docs, "sql": sql_result},
    }

    # Refused — no LLM call needed.
    if not strong_docs and not strong_sql:
        meta["rationale"] = (meta["rationale"] + " | gated: no strong evidence").strip(" |")
        yield ("meta", meta)
        yield ("token", REFUSAL_LINE)
        yield ("done", {"confidence": "refused", "gated": True, "latency_ms": int((time.time() - t0) * 1000)})
        return

    # Fast path — pure SQL, no answer LLM call.
    if route == "sql" and strong_sql and not docs:
        yield ("meta", meta)
        yield ("token", _deterministic_sql_answer(sql_result, question))
        yield ("done", {"confidence": "medium", "fast_path": True, "latency_ms": int((time.time() - t0) * 1000)})
        return

    # Otherwise, stream the answer LLM call.
    yield ("meta", meta)

    context_blocks = []
    if docs:
        context_blocks.append("DOCUMENT EVIDENCE:\n" + _format_doc_context(docs))
    if sql_result:
        context_blocks.append("DATABASE EVIDENCE:\n" + _format_sql_context(sql_result))
    context = "\n\n".join(context_blocks) if context_blocks else "(no evidence retrieved)"

    client = OllamaClient(model=model)
    accumulated = []
    try:
        async for tok in client.chat_stream(
            messages=[
                {"role": "system", "content": ANSWER_SYSTEM},
                {"role": "user", "content": f"Context:\n{context}\n\nQuestion: {question}"},
            ],
            temperature=0.1,
        ):
            accumulated.append(tok)
            yield ("token", tok)
    except Exception as e:
        yield ("token", f"\n\n[error during generation: {e}]")

    full_text = "".join(accumulated).strip()
    confidence = _confidence(full_text, docs, sql_result)
    yield ("done", {"confidence": confidence, "latency_ms": int((time.time() - t0) * 1000)})


def _build_citations(docs: list[dict], sql_result: dict) -> list[dict]:
    cites: list[dict] = []
    for d in docs:
        cites.append(
            {
                "type": "document",
                "label": f"{d['filename']} p.{d['page']}",
                "doc_id": d.get("doc_id"),
                "filename": d.get("filename"),
                "page": d.get("page"),
                "snippet": d["text"][:280],
            }
        )
    if sql_result and sql_result.get("sql"):
        cites.append(
            {
                "type": "sql",
                "label": f"SQL: {sql_result['sql'][:60]}",
                "sql": sql_result["sql"],
                "rationale": sql_result.get("rationale", ""),
                "row_count": sql_result.get("row_count", 0),
                "rows_preview": sql_result.get("rows", [])[:5],
                "error": sql_result.get("error"),
            }
        )
    return cites


def _confidence(answer_text: str, docs: list[dict], sql_result: dict) -> str:
    has_doc_cite = "[doc:" in answer_text and bool(docs)
    has_sql_cite = "[sql:" in answer_text and bool(sql_result.get("sql")) and not sql_result.get("error")
    if "I don't have enough grounded information" in answer_text and not (has_doc_cite or has_sql_cite):
        return "refused"
    if has_doc_cite and has_sql_cite:
        return "high"
    if has_doc_cite or has_sql_cite:
        return "medium"
    return "low"
