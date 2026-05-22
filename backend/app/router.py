import json
from typing import Any

from .config import settings
from .ollama_client import OllamaClient
from .tool_docs import search_documents
from .tool_sql import query_database, schema_summary, table_names

# Retrieval-quality gate: below this top-1 cosine score, treat document hits as weak.
DOC_SCORE_FLOOR = 0.40
REFUSAL_LINE = (
    "I don't have enough grounded information to answer that. "
    "Try rephrasing or upload a relevant document."
)

ROUTER_SYSTEM = """You are the planner for a grounded business assistant.

You answer questions by calling tools. Two tools are available:
- search_documents: vector search over uploaded PDFs/notes
- query_database: natural-language query over a SQLite database

DECISION HEURISTIC — apply in order:

1. LOOK AT THE SCHEMA BELOW. Note every table name and the entities they represent.

2. If the question asks "what/who/which/list/show/how many <X>" where <X> matches (or is the plural/singular of) a table name or a column meaning in the schema, route = "sql".
   Examples: "list tenants" / "what are the tenant names" / "how many leases" / "show me properties in Austin" → sql.
   The word "names", "list", "all", "active", "expired", "total", "sum" are STRONG sql signals when paired with a schema entity.

3. If the question is about policy, rules, terms, definitions, what the handbook/contract/document SAYS — route = "docs".
   Examples: "what is the late fee policy" / "how do I report a maintenance issue" / "what does the lease say about pets" → docs.

4. If the question needs BOTH (records from the database AND policy/text from the documents) — route = "hybrid".
   Examples: "for tenants whose lease expires soon, what does the handbook say about renewal" → hybrid.

5. If the question seems unrelated to both, still call docs as a best effort.

6. When in doubt between docs and hybrid, PREFER hybrid. Extra evidence never hurts.

NEVER refuse to route. Pick the best-matching route.

OUTPUT ONLY this JSON (no prose):
{
  "route": "docs" | "sql" | "hybrid",
  "docs_query": "<query string or null>",
  "sql_question": "<natural-language question or null>",
  "rationale": "<one short line>"
}

FEW-SHOT EXAMPLES (schema has tables: tenants, leases, properties, payments)

Q: "What are the tenant names?"
{"route":"sql","docs_query":null,"sql_question":"list tenant full names","rationale":"'names' + table 'tenants' = sql"}

Q: "What is the late fee policy?"
{"route":"docs","docs_query":"late fee policy rent payment","sql_question":null,"rationale":"policy from handbook"}

Q: "How much rent did Devon Patel pay last month, and what is the late fee policy?"
{"route":"hybrid","docs_query":"late fee policy rent","sql_question":"sum of payments by Devon Patel in the last month","rationale":"database record + policy text"}

Q: "Show me leases expiring in 6 months."
{"route":"sql","docs_query":null,"sql_question":"leases with end_date within next 6 months including tenant names","rationale":"list leases by date"}

Q: "Can I have a dog?"
{"route":"docs","docs_query":"pet policy dogs allowed","sql_question":null,"rationale":"handbook pet policy"}

Q: "How many properties do we have in Austin and what does the handbook say about privacy?"
{"route":"hybrid","docs_query":"privacy tenant records","sql_question":"count of properties in Austin","rationale":"count from db + policy from docs"}

The user's question, plus the database schema, are below.
"""

ANSWER_SYSTEM = """You are a precise business assistant. You answer ONLY from the provided context.

CITATION RULES (always followed)
- EVERY factual claim MUST end with a citation marker. Even single-sentence answers.
- For document claims: copy the citation tag EXACTLY as it appears at the START of the chunk you are quoting. If the chunk header is `[doc:foo.pdf p.3]`, use `[doc:foo.pdf p.3]` — never a different page number.
- For SQL claims: use the same `[sql:...]` tag that prefixes the DATABASE EVIDENCE block, abbreviated to ~60 chars.
- ONLY use `[sql:...]` if the context actually contains "DATABASE EVIDENCE:". If there is no DATABASE EVIDENCE, do not invent SQL citations.
- ONLY use `[doc:...]` if the context actually contains "DOCUMENT EVIDENCE:". If there is no DOCUMENT EVIDENCE, do not invent doc citations.
- Do NOT use prior knowledge. Do NOT invent citations, page numbers, or values.

ANSWERING POLICY
- Answer what IS supported. For any part that is NOT supported, say so explicitly: "The handbook does not mention X." Do NOT refuse the whole answer because one sub-part is missing.
- When BOTH document and database evidence are provided, you MUST use BOTH. Lead with the database facts (enumerate the actual entities by name), then layer in the relevant policy from the documents.
- Use the FULL refusal line below ONLY when NO part of the question is supported:
  "I don't have enough grounded information to answer that. Try rephrasing or upload a relevant document."
- Keep answers tight: 2-6 sentences unless a list is clearer.

READING SQL RESULTS — READ LITERALLY
- If you see `ANSWER (use this exact value): <X>`, then `<X>` IS the answer. Use that exact number/value. Do NOT use any other number from the context. Still attach the `[sql:...]` citation to the sentence containing it.
- If you see `N row(s) returned:` followed by JSON, the JSON list IS the data. Enumerate the entries by their visible fields (e.g. names, addresses). Do not paraphrase numbers, and do not summarize as "some" or "a few".
- If you see `ANSWER: no rows match.`, say there are no matching records.
- NEVER treat `N row(s) returned` as the answer to a "how many" question — that's metadata, not the answer.
"""


async def plan(question: str) -> dict[str, Any]:
    client = OllamaClient()
    schema = schema_summary()
    user_msg = f"Database schema:\n{schema}\n\nUser question: {question}"
    resp = await client.chat(
        messages=[
            {"role": "system", "content": ROUTER_SYSTEM},
            {"role": "user", "content": user_msg},
        ],
        temperature=0.0,
        format="json",
    )
    raw = resp.get("message", {}).get("content", "{}")
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        parsed = {"route": "docs", "docs_query": question, "sql_question": None, "rationale": "router fallback"}

    parsed.setdefault("route", "docs")
    parsed.setdefault("docs_query", question if parsed["route"] in ("docs", "hybrid") else None)
    parsed.setdefault("sql_question", question if parsed["route"] in ("sql", "hybrid") else None)
    parsed.setdefault("rationale", "")

    # SAFETY UPGRADE: if router chose docs-only but the question mentions a table
    # entity (with naive plural/singular handling), upgrade to hybrid. Catches the
    # "what are tenant names" class of routing misses.
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
                parsed["sql_question"] = question
                parsed["rationale"] = (parsed.get("rationale", "") + f" | upgraded to hybrid (matched table '{t}')").strip(" |")
                break

    return parsed


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

    # Multi-row: show row_count and the JSON rows. Avoid the word 'rows=N' (model misreads as the answer).
    body = json.dumps(rows[:20], default=str, indent=2)
    return f"{cite}\n{row_count} row(s) returned:\n{body}"


async def answer(question: str) -> dict[str, Any]:
    p = await plan(question)
    route = p["route"]

    docs: list[dict] = []
    sql_result: dict = {}

    if route in ("docs", "hybrid") and p.get("docs_query"):
        docs = search_documents(p["docs_query"])
    if route in ("sql", "hybrid") and p.get("sql_question"):
        sql_result = await query_database(p["sql_question"])

    # RETRIEVAL-QUALITY GATE — if all evidence is weak/missing, refuse WITHOUT
    # calling the answer LLM. The model can't hallucinate from context it never sees.
    strong_docs = bool(docs) and any(d.get("score", 0) >= DOC_SCORE_FLOOR for d in docs)
    strong_sql = bool(sql_result.get("sql")) and not sql_result.get("error") and (
        sql_result.get("row_count", 0) > 0 or "no rows" not in str(sql_result.get("rationale", "")).lower()
    )
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

    context_blocks = []
    if docs:
        context_blocks.append("DOCUMENT EVIDENCE:\n" + _format_doc_context(docs))
    if sql_result:
        context_blocks.append("DATABASE EVIDENCE:\n" + _format_sql_context(sql_result))
    context = "\n\n".join(context_blocks) if context_blocks else "(no evidence retrieved)"

    client = OllamaClient()
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
    # Only mark fully refused if the refusal line dominates the answer (no citations at all).
    if "I don't have enough grounded information" in answer_text and not (has_doc_cite or has_sql_cite):
        return "refused"
    if has_doc_cite and has_sql_cite:
        return "high"
    if has_doc_cite or has_sql_cite:
        return "medium"
    return "low"
