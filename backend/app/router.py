import json
from typing import Any

from .config import settings
from .ollama_client import OllamaClient
from .tool_docs import search_documents
from .tool_sql import execute_sql, execute_sql_with_repair, schema_summary, table_names

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
6. If the question contains an ACRONYM or domain jargon (SOL, PT, OT, DKA, MMI, UM/UIM, ePHI, MAR, ARDC, NPP, etc.) — route = "hybrid". The glossary document needs to be retrieved so we can translate the term to the actual schema/policy.
7. NEVER refuse to route — pick the best match.

SQL GENERATION RULES (apply when route is "sql" or "hybrid"):
- Output a single SQLite SELECT query. No INSERT/UPDATE/DELETE/DDL.
- ALWAYS alias aggregates (e.g. SELECT COUNT(*) AS resident_count, not SELECT COUNT(*)).
- When the question mentions a specific person by name, JOIN to that person's row by name. For example, if `medications` has `resident_id` and the question is "What is Robert Miller allergic to?", JOIN with `residents` ON `residents.id = medications.resident_id` and filter `WHERE residents.first_name = 'Robert' AND residents.last_name = 'Miller'`.
- Prefer explicit columns over SELECT *.
- LIMIT 50 unless the question asks for an aggregate.
- Use only SQLite-compatible functions. NEVER use PostgreSQL-only functions (JSON_AGG, jsonb_agg, row_to_json, ARRAY_AGG). Use sqlite functions like COUNT, SUM, GROUP_CONCAT instead.
- If a SQL query is not appropriate, leave "sql_query" as an empty string.

CLARIFICATION (rare — set ONLY when truly needed):
- Set "clarification" to a question for the user ONLY when the question is genuinely ambiguous AND the answer would meaningfully differ across valid interpretations. Examples: "show me the missed payments" (whose? alimony or rent?), "how many cases" (status? year?).
- Do NOT use clarification just because the question is broad. Most questions can be answered with the best interpretation.
- When clarification is set, the system skips SQL/docs and asks the user instead.
- Default: empty string ("") — meaning no clarification needed.

OUTPUT ONLY this exact JSON shape (no prose, no markdown fences):
{
  "route": "docs" | "sql" | "hybrid",
  "docs_query": "<short keyword query or null>",
  "sql_query": "<a SQLite SELECT query, or empty string if not sql/hybrid>",
  "sql_rationale": "<one short line explaining what the SQL does, or empty>",
  "rationale": "<one short line for the overall routing decision>",
  "clarification": "<a question for the user, or empty string>",
  "clarification_options": ["<short option label>", "..."]
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

Q: "How much rent has Devon Patel paid in the last 6 months, and what does the handbook say about late fees?"
{"route":"hybrid","docs_query":"late fee policy rent payment","sql_query":"SELECT p.due_date, p.amount, p.status, p.paid_on FROM payments p JOIN leases l ON l.id = p.lease_id JOIN tenants t ON t.id = l.tenant_id WHERE t.first_name = 'Devon' AND t.last_name = 'Patel' ORDER BY p.due_date DESC LIMIT 6","sql_rationale":"Devon Patel's recent rent payments","rationale":"records (rent history) + tenant handbook policy"}

Q: "Which leases are expiring in the next 6 months, and what does the handbook say about renewal notices?"
{"route":"hybrid","docs_query":"renewal notice lease expiration","sql_query":"SELECT t.first_name, t.last_name, l.end_date, l.monthly_rent FROM leases l JOIN tenants t ON t.id = l.tenant_id WHERE date(l.end_date) <= date('now','+6 months') AND date(l.end_date) >= date('now') ORDER BY l.end_date","sql_rationale":"Leases expiring within 6 months","rationale":"database listing + handbook policy"}

Q: "Are pets allowed at 120 Maple Ave?"
{"route":"hybrid","docs_query":"pet policy deposit","sql_query":"SELECT pr.address, l.pets_allowed, l.notes FROM leases l JOIN properties pr ON pr.id = l.property_id WHERE pr.address = '120 Maple Ave'","sql_rationale":"Pet allowance for that property","rationale":"property-specific rule + general policy"}

Q: "Which clients have upcoming SOL deadlines?"
{"route":"hybrid","docs_query":"SOL statute of limitations filing deadline","sql_query":"SELECT cl.first_name, cl.last_name, f.due_date FROM filings f JOIN cases ca ON ca.id = f.case_id JOIN clients cl ON cl.id = ca.client_id WHERE f.filing_type LIKE '%Statute%' AND date(f.due_date) >= date('now') ORDER BY f.due_date LIMIT 50","sql_rationale":"Clients with upcoming SOL filings","rationale":"acronym (SOL) -> glossary maps to filings.filing_type LIKE 'Statute%'"}

Q: "Does Robert have PT approval?"
{"route":"hybrid","docs_query":"PT physical therapy approval workflow","sql_query":"SELECT r.first_name, r.last_name, pa.status, pa.approval_date FROM pt_approvals pa JOIN residents r ON r.id = pa.resident_id WHERE r.first_name = 'Robert'","sql_rationale":"Robert's PT approval status","rationale":"PT acronym -> physical therapy -> pt_approvals table"}

Q: "What is the security deposit policy for a 2-year lease?"
{"route":"docs","docs_query":"security deposit policy lease duration","sql_query":"","sql_rationale":"","rationale":"pure policy question — the '2-year lease' is a hypothetical condition in the policy, not a specific lease row to look up"}

Q: "What is the late fee for rent paid 10 days late?"
{"route":"docs","docs_query":"late fee policy rent","sql_query":"","sql_rationale":"","rationale":"policy parameter conditioned on a hypothetical — no specific tenant or lease referenced, so docs only"}

Q: "Show me the missed payments"
{"route":"docs","docs_query":null,"sql_query":"","sql_rationale":"","rationale":"ambiguous — needs clarification","clarification":"Whose missed payments, and which kind?","clarification_options":["Michael Rosenberg — missed alimony","Devon Patel — missed rent","All tenants — missed rent"]}

The user's question + database schema follow.
"""

ANSWER_SYSTEM = """You are a precise business assistant. You answer ONLY from the provided context.

LENGTH: Keep answers to 100 words or less. Be concise. No preamble.

OUTPUT STYLE — write a clean, conversational paragraph. NEVER do any of these:
- Do NOT write the headers "DATABASE EVIDENCE:" or "DOCUMENT EVIDENCE:" in your answer.
- Do NOT write "N row(s) returned:" in your answer.
- Do NOT dump raw JSON or table rows. Re-state the values in prose.
- Do NOT include the literal SQL query text in your answer body. The `[sql:...]` citation marker at the end of a sentence is the only place SQL appears.
- Write ISO dates like "2026-03-18" as "March 18, 2026". Write money as "$3,500.00".
- Convert column names like `treatment_date` to natural English ("treatment on...").

ENTITY ECHO — ALWAYS restate the person, property, or entity by name in your answer, even if the question already named them. Pronouns ("they", "the client", "the resident") are NOT acceptable substitutes when a name exists in the evidence. Example: instead of "She was admitted on Aug 12, 2025", write "Sarah Klein was admitted on August 12, 2025 [sql:...]".

EVIDENCE IS SUFFICIENT IF EITHER source has it. You do NOT need both to be present:
- DATABASE EVIDENCE alone IS sufficient to answer a question about specific records.
- DOCUMENT EVIDENCE alone IS sufficient to answer a question about policy, rules, or procedures.
- Refuse ONLY when neither source has anything relevant.

WHEN TO USE BOTH
- If both DATABASE and DOCUMENT EVIDENCE are provided, weave both into one paragraph: lead with the database facts (names, values), then layer in the relevant policy.
- If the document evidence isn't directly on-topic, ignore it and answer from the database.

CITATION RULES
- Every factual claim ends with a `[doc:filename p.N]` or `[sql:...]` marker.
- Only use `[sql:...]` if the context contains "DATABASE EVIDENCE:". Only use `[doc:...]` if the context contains "DOCUMENT EVIDENCE:".
- Do NOT invent citations, page numbers, or values.

READING SQL RESULTS — READ LITERALLY
- If you see `ANSWER (use this exact value): <X>`, that `<X>` IS the answer; restate it in a sentence with the `[sql:...]` citation.
- If you see `N row(s) returned:` followed by JSON, summarize the entries in prose using their fields — never echo the JSON.
- If you see `ANSWER: no rows match.`, say there are no matching records.

REFUSAL — use ONLY when neither source has relevant evidence:
"I don't have enough grounded information to answer that. Try rephrasing or upload a relevant document."

MULTI-TURN — if the context block contains a "Recent conversation" transcript above the EVIDENCE section, it is there only to resolve pronouns ("she", "his", "that case") and continuity references. Do NOT cite citations from prior assistant turns — only cite from the current EVIDENCE block. Do NOT repeat the prior assistant's answer; just respond to the current question.
"""


# Cap on how many prior turns we forward to the LLMs. Older context is dropped.
HISTORY_TURN_CAP = 6  # roughly 3 user/assistant pairs
ASSISTANT_HISTORY_PREVIEW_CHARS = 240  # truncate past answers so we don't bloat tokens


def _format_history(history: list[dict] | None) -> str:
    """Render recent conversation as a compact transcript. Assistant responses
    are truncated so the prompt doesn't blow up on long answers. Returns "" if
    history is empty/None — caller can branch cheaply."""
    if not history:
        return ""
    lines = []
    for turn in history[-HISTORY_TURN_CAP:]:
        role = turn.get("role")
        content = (turn.get("content") or "").strip()
        if not content or role not in ("user", "assistant"):
            continue
        if role == "assistant" and len(content) > ASSISTANT_HISTORY_PREVIEW_CHARS:
            content = content[:ASSISTANT_HISTORY_PREVIEW_CHARS].rstrip() + "…"
        lines.append(f"{'USER' if role == 'user' else 'ASSISTANT'}: {content}")
    return "Recent conversation (for context, resolve pronouns from here):\n" + "\n".join(lines)


# ----------------------------------------------------------------------
# Planning + SQL gen in ONE LLM call
# ----------------------------------------------------------------------
async def plan_and_sql(question: str, model: str | None = None, history: list[dict] | None = None) -> dict[str, Any]:
    """Single LLM call that returns route + docs_query + sql_query (if applicable).
    Replaces the previous two-call sequence of plan() + nl_to_sql()."""
    client = OllamaClient(model=model)
    schema = schema_summary(include_samples=False)  # terse schema — faster prefill
    history_block = _format_history(history)
    user_msg_parts = []
    if history_block:
        user_msg_parts.append(history_block)
    user_msg_parts.append(f"Database schema:\n{schema}")
    user_msg_parts.append(f"User question: {question}")
    user_msg = "\n\n".join(user_msg_parts)
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
    parsed.setdefault("clarification", "")
    parsed.setdefault("clarification_options", [])
    # Coerce option list defensively — LLM sometimes returns null or string.
    if not isinstance(parsed["clarification_options"], list):
        parsed["clarification_options"] = []

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
def _humanize_col(col: str) -> str:
    """`first_name` -> `First name`. Keep acronyms uppercase."""
    pretty = col.replace("_", " ").strip()
    if pretty.isupper() or len(pretty) <= 3:
        return pretty
    return pretty[:1].upper() + pretty[1:]


# Column-name hints that mean the value should be formatted as currency
_MONEY_HINTS = ("amount", "rent", "price", "value", "deposit", "salary",
                "cost", "balance", "total_dollar", "revenue", "expense", "fee")


def _is_money_col(col: str | None) -> bool:
    if not col:
        return False
    cl = col.lower()
    return any(h in cl for h in _MONEY_HINTS)


def _fmt_value(v, col: str | None = None):
    """Render a SQL cell value in a conversational way.
    Detects ISO dates, money columns, big ints, None."""
    if v is None:
        return "—"
    # ISO date YYYY-MM-DD
    if isinstance(v, str) and len(v) >= 10 and v[4:5] == "-" and v[7:8] == "-":
        try:
            from datetime import date
            d = date.fromisoformat(v[:10])
            return d.strftime("%b %-d, %Y")
        except Exception:
            return v
    if isinstance(v, (int, float)):
        if _is_money_col(col):
            return f"${v:,.2f}" if isinstance(v, float) else f"${v:,}"
        if isinstance(v, float):
            if v == int(v):
                return f"{int(v):,}"
            return f"{v:,.2f}"
        if abs(v) >= 1000:
            return f"{v:,}"
        return str(v)
    return str(v)


def _scalar_sentence(col: str, val) -> str:
    """Turn a single col/val into a complete sentence."""
    val_str = _fmt_value(val, col=col)
    c = col.lower()
    # Counts
    if c.endswith("_count") or c == "count":
        entity = c[:-6] if c.endswith("_count") else "result"
        entity = entity.replace("_", " ").strip()
        is_one = val_str == "1"
        plural = "" if entity.endswith("s") or is_one else "s"
        verb = "is" if is_one else "are"
        return f"There {verb} {val_str} {entity}{plural}."
    if c.startswith(("total_", "sum_")):
        return f"Total: {val_str}."
    if c.startswith(("avg_", "average_", "mean_")):
        return f"Average: {val_str}."
    if c.startswith(("max_", "maximum_")):
        return f"Highest: {val_str}."
    if c.startswith(("min_", "minimum_")):
        return f"Lowest: {val_str}."
    return f"{_humanize_col(col)}: {val_str}."


def _deterministic_sql_answer(sql_result: dict, question: str) -> str:
    """Format an SQL-only answer without calling the answer LLM.
    Saves the slowest LLM call on CPU hosts, while keeping output conversational."""
    sql = sql_result.get("sql", "")
    cite = f"[sql:{sql[:80]}]"
    rows = sql_result.get("rows", []) or []
    row_count = sql_result.get("row_count", len(rows))

    if row_count == 0:
        return f"No matching records found. {cite}"

    # ---- Scalar (1 row, 1 col): "There are 10 residents." ----
    if len(rows) == 1 and isinstance(rows[0], dict) and len(rows[0]) == 1:
        col, val = next(iter(rows[0].items()))
        return f"{_scalar_sentence(col, val)} {cite}"

    # ---- Multi-row single column (a list of values): "Penicillin, Sulfa drugs, and Codeine." ----
    if rows and all(isinstance(r, dict) and len(r) == 1 for r in rows):
        col = next(iter(rows[0].keys()))
        vals = [_fmt_value(r[col], col=col) for r in rows if r[col] is not None]
        if len(vals) == 1:
            return f"{vals[0]}. {cite}"
        if len(vals) == 2:
            return f"{vals[0]} and {vals[1]}. {cite}"
        return f"{', '.join(vals[:-1])}, and {vals[-1]}. {cite}"

    # ---- Single row, multiple columns: "Robert Miller — status: pending, room: 115." ----
    if len(rows) == 1:
        r = rows[0]
        # Prefer a name-like field as the leading label.
        label_keys = ("full_name", "first_name", "name", "drug_name", "filename")
        leader = None
        for lk in label_keys:
            if lk in r and r[lk]:
                leader = (lk, str(r[lk]))
                break
        if leader:
            lk, lv = leader
            extras = [f"{_humanize_col(k).lower()}: {_fmt_value(v, col=k)}" for k, v in r.items()
                      if k != lk and v is not None]
            tail = f" — {', '.join(extras)}" if extras else ""
            return f"{lv}{tail}. {cite}"
        # No obvious name field: just key: value chain.
        kv = ", ".join(f"{_humanize_col(k).lower()}: {_fmt_value(v, col=k)}" for k, v in r.items() if v is not None)
        return f"{kv}. {cite}"

    # ---- Multi-row, multi-column ----
    # Build a conversational inline list, prefixed by the rationale where helpful.
    # Each row gets compacted by detecting "natural" combinations like {amount + date}
    # into "$X on Date" instead of "amount: X, date: Y".
    label_keys = ("full_name", "first_name", "name", "drug_name", "filename")

    # Trim imperative prefixes from the LLM-generated rationale so it reads like a noun phrase.
    rationale = (sql_result.get("rationale") or "").strip().rstrip(":.")
    for prefix in ("list ", "show all ", "show me all ", "show ", "get all ", "get ",
                   "retrieve ", "find ", "fetch ", "count of ", "counting "):
        if rationale.lower().startswith(prefix):
            rationale = rationale[len(prefix):]
            break

    def render_row(r):
        # Prefer a name-like leader
        leader_key = next((k for k in label_keys if k in r and r[k]), None)
        if leader_key == "first_name" and "last_name" in r and r["last_name"]:
            label, skip = f"{r['first_name']} {r['last_name']}", {"first_name", "last_name"}
        elif leader_key:
            label, skip = str(r[leader_key]), {leader_key}
        else:
            label, skip = "", set()

        # Detect money col + date col → render as "$X on <date>"
        money_col = next((k for k in r if _is_money_col(k) and r[k] is not None and k not in skip), None)
        date_col = next((k for k in r if isinstance(r[k], str) and len(r[k]) >= 10
                         and r[k][4:5] == "-" and r[k][7:8] == "-" and k not in skip), None)
        if money_col and date_col:
            money = _fmt_value(r[money_col], col=money_col)
            date = _fmt_value(r[date_col], col=date_col)
            phrase = f"{money} on {date}"
            skip = skip | {money_col, date_col}
        else:
            phrase = ""

        # Any remaining non-null fields
        tail = [f"{_humanize_col(k).lower()} {_fmt_value(v, col=k)}"
                for k, v in r.items() if k not in skip and v is not None]
        tail_str = ", ".join(tail)

        if label and phrase and tail_str:
            return f"{label} — {phrase}, {tail_str}"
        if label and phrase:
            return f"{label} — {phrase}"
        if label and tail_str:
            return f"{label} ({tail_str})"
        if label:
            return label
        if phrase and tail_str:
            return f"{phrase} ({tail_str})"
        if phrase:
            return phrase
        return tail_str

    # Drop columns that have the same value across all rows AND that value is
    # already implied by the rationale (e.g., status='missed' when the question
    # asked for missed payments). Keeps the output uncluttered.
    if rows and isinstance(rows[0], dict):
        for col_to_check in ("status", "type", "category"):
            vals = {r.get(col_to_check) for r in rows if col_to_check in r}
            if len(vals) == 1 and (v := next(iter(vals))) is not None:
                if str(v).lower() in rationale.lower():
                    for r in rows:
                        r.pop(col_to_check, None)

    items = [render_row(r) for r in rows[:10]]
    items = [i for i in items if i]
    overflow = row_count - len(items)
    if overflow > 0:
        items.append(f"and {overflow} more")

    if rationale:
        intro = rationale[:1].upper() + rationale[1:]
    else:
        plural = "s" if row_count != 1 else ""
        intro = f"{row_count} record{plural}"

    if len(items) == 1:
        body = items[0]
    elif len(items) == 2:
        body = f"{items[0]}; {items[1]}"
    else:
        body = "; ".join(items[:-1]) + f"; and {items[-1]}"

    return f"{intro}: {body}. {cite}"


# ----------------------------------------------------------------------
# Main answer pipeline
# ----------------------------------------------------------------------
async def answer(question: str, model: str | None = None, history: list[dict] | None = None) -> dict[str, Any]:
    import asyncio
    p = await plan_and_sql(question, model=model, history=history)
    route = p["route"]

    # Run SQL execution + Qdrant search in parallel — they are independent.
    async def _do_sql():
        if route in ("sql", "hybrid") and p.get("sql_query"):
            return await execute_sql_with_repair(
                p["sql_query"], p.get("sql_rationale", ""), question, model=model
            )
        return {}

    async def _do_docs():
        if route in ("docs", "hybrid") and p.get("docs_query"):
            return await asyncio.to_thread(search_documents, p["docs_query"])
        return []

    sql_result, docs = await asyncio.gather(_do_sql(), _do_docs())

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
    history_block = _format_history(history)
    if history_block:
        context_blocks.append(history_block)
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


async def answer_stream(question: str, model: str | None = None, history: list[dict] | None = None):
    """Streaming version of answer(): yields (event_type, data) tuples.
    Event types in order:
      - 'plan'  → emitted RIGHT AFTER step 1 (route + planned sql/docs query). UI
                  can render the routing decision + SQL preview immediately.
      - 'meta'  → emitted after SQL exec + Qdrant search complete (parallel).
                  Contains full citations and evidence. Tokens follow.
      - 'token' → a string fragment of the answer (zero or more)
      - 'done'  → final confidence + latency_ms
    """
    import asyncio
    import time
    t0 = time.time()

    # --- Step 1: plan + sql gen (one LLM call) ---
    p = await plan_and_sql(question, model=model, history=history)
    route = p["route"]

    # Emit `plan` event immediately so the UI can render route + SQL preview
    # before SQL execution and Qdrant search finish.
    yield ("plan", {
        "route": route,
        "rationale": p.get("rationale", ""),
        "sql_query": p.get("sql_query", ""),
        "sql_rationale": p.get("sql_rationale", ""),
        "docs_query": p.get("docs_query"),
        "clarification": p.get("clarification", ""),
        "clarification_options": p.get("clarification_options", []),
    })

    # --- Short-circuit on clarification ---
    # If the planner asked for clarification, skip retrieval + answer LLM entirely.
    # The UI renders the clarification question with quick-reply chips.
    if p.get("clarification"):
        yield ("done", {
            "confidence": "clarification",
            "clarification_required": True,
            "latency_ms": int((time.time() - t0) * 1000),
        })
        return

    # --- Step 2 + 3: SQL execution + Qdrant search IN PARALLEL ---
    # SQL is fast (<100ms), embedding-search is slow (~1-9s). Running them
    # concurrently saves time, and we yield a `step` event AS EACH ONE finishes
    # so the UI can show live progress checkmarks.
    sql_result: dict = {}
    docs: list[dict] = []
    wants_sql = route in ("sql", "hybrid") and bool(p.get("sql_query"))
    wants_docs = route in ("docs", "hybrid") and bool(p.get("docs_query"))

    # Speculative doc search on pure-SQL route: kick off in parallel using the
    # question itself as the query. If SQL comes back strong we drop the task
    # so the fast path fires without waiting for embeddings.
    docs_query = p.get("docs_query")
    docs_speculative = False
    if route == "sql" and not wants_docs:
        docs_query = question
        wants_docs = True
        docs_speculative = True

    # Announce what we're about to do
    if wants_sql:
        yield ("step", {"kind": "sql", "status": "started"})
    if wants_docs:
        yield ("step", {"kind": "docs", "status": "started", "speculative": docs_speculative})

    async def _do_sql():
        return await execute_sql_with_repair(
            p["sql_query"], p.get("sql_rationale", ""), question, model=model
        )

    async def _do_docs():
        return await asyncio.to_thread(search_documents, docs_query)

    pending: set[asyncio.Task] = set()
    if wants_sql:
        pending.add(asyncio.create_task(_do_sql(), name="sql"))
    if wants_docs:
        pending.add(asyncio.create_task(_do_docs(), name="docs"))

    bailed_for_fast_path = False
    while pending:
        done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            name = task.get_name()
            if name == "sql":
                sql_result = task.result()
                yield ("step", {
                    "kind": "sql",
                    "status": "done",
                    "row_count": sql_result.get("row_count", 0),
                    "has_error": bool(sql_result.get("error")),
                    "repair_attempts": sql_result.get("repair_attempts", 0),
                })
                # Speculative-docs bailout: SQL is sufficient, drop the
                # in-flight docs task so the fast path can emit immediately.
                if (
                    docs_speculative
                    and not sql_result.get("error")
                    and sql_result.get("row_count", 0) > 0
                ):
                    for t in list(pending):
                        if t.get_name() == "docs":
                            t.cancel()
                            pending.discard(t)
                            yield ("step", {"kind": "docs", "status": "skipped", "reason": "sql sufficient"})
                    bailed_for_fast_path = True
                    break
            elif name == "docs":
                docs = task.result()
                top_score = max((d.get("score", 0) for d in docs), default=0)
                yield ("step", {
                    "kind": "docs",
                    "status": "done",
                    "count": len(docs),
                    "top_score": round(float(top_score), 3),
                })
        if bailed_for_fast_path:
            break

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

    # Fast path — pure SQL, no answer LLM call. `not strong_docs` (rather than
    # `not docs`) so weak speculative-doc hits don't push us off the fast path.
    if route == "sql" and strong_sql and not strong_docs:
        yield ("meta", meta)
        fast_answer = _deterministic_sql_answer(sql_result, question)
        yield ("token", fast_answer)
        yield ("done", {
            "confidence": "medium",
            "fast_path": True,
            "latency_ms": int((time.time() - t0) * 1000),
            "followups_pending": True,
        })
        followups = await _generate_followups(question, fast_answer, model=model)
        yield ("followups", {"questions": followups})
        return

    # Otherwise, stream the answer LLM call.
    yield ("meta", meta)

    context_blocks = []
    history_block = _format_history(history)
    if history_block:
        context_blocks.append(history_block)
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
    will_try_followups = confidence != "refused"
    yield ("done", {
        "confidence": confidence,
        "latency_ms": int((time.time() - t0) * 1000),
        "followups_pending": will_try_followups,
    })

    # Follow-up suggestions — best-effort, after the answer is fully streamed.
    # Skip if we refused, since there's no useful answer to build on.
    if will_try_followups:
        followups = await _generate_followups(question, full_text, model=model)
        yield ("followups", {"questions": followups})


FOLLOWUP_SYSTEM = """Given a user's question and the assistant's answer, suggest 3 short follow-up questions the user might naturally ask next.

RULES:
- Each follow-up is a complete, self-contained question under 80 characters.
- Build on entities/facts mentioned in the answer (specific people, dates, amounts, document names).
- Vary the angle: one drills deeper, one broadens scope, one explores a related concept.
- Skip generic questions like "tell me more" or "any other details?".
- If you cannot suggest 3 useful follow-ups, return fewer or an empty list.

OUTPUT ONLY a JSON object: {"questions": ["...", "...", "..."]}
"""


async def _generate_followups(question: str, answer: str, model: str | None = None) -> list[str]:
    """One small LLM call to suggest 3 follow-up questions.
    Best-effort — returns [] on any failure so the main path is unaffected."""
    if not answer or len(answer) < 20:
        return []
    try:
        client = OllamaClient(model=model)
        resp = await client.chat(
            messages=[
                {"role": "system", "content": FOLLOWUP_SYSTEM},
                {"role": "user", "content": f"Question: {question}\n\nAnswer: {answer}"},
            ],
            temperature=0.4,
            format="json",
        )
        raw = resp.get("message", {}).get("content", "{}")
        parsed = json.loads(raw)
        qs = parsed.get("questions", [])
        if not isinstance(qs, list):
            return []
        return [str(q).strip() for q in qs if isinstance(q, (str, int, float)) and str(q).strip()][:3]
    except Exception:
        return []


def _build_citations(docs: list[dict], sql_result: dict) -> list[dict]:
    cites: list[dict] = []
    for d in docs:
        full_text = d.get("text", "")
        cites.append(
            {
                "type": "document",
                "label": f"{d['filename']} p.{d['page']}",
                "doc_id": d.get("doc_id"),
                "filename": d.get("filename"),
                "page": d.get("page"),
                "snippet": full_text[:280],            # short preview (UI uses this in lists)
                "chunk_text": full_text,                # full chunk text — drives PDF highlighting
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
