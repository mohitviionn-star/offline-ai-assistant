import json
import sqlite3
from pathlib import Path
import sqlglot
from sqlglot import expressions as exp

from .config import settings
from .ollama_client import OllamaClient


def _conn() -> sqlite3.Connection:
    Path(settings.sqlite_path).parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(settings.sqlite_path)
    c.row_factory = sqlite3.Row
    return c


def table_names() -> list[str]:
    """Just the user table names — used for fast schema-aware routing checks."""
    with _conn() as c:
        rows = c.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).fetchall()
    return [r["name"] for r in rows]


def schema_summary() -> str:
    """Compact human-readable schema description for the LLM."""
    out: list[str] = []
    with _conn() as c:
        tables = c.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).fetchall()
        for t in tables:
            tname = t["name"]
            cols = c.execute(f"PRAGMA table_info({tname})").fetchall()
            col_defs = ", ".join(f"{col['name']} {col['type']}" for col in cols)
            sample = c.execute(f"SELECT * FROM {tname} LIMIT 2").fetchall()
            sample_rows = [dict(r) for r in sample]
            out.append(
                f"TABLE {tname}({col_defs})\n  sample: {json.dumps(sample_rows, default=str)}"
            )
    return "\n".join(out) if out else "(no tables)"


def _is_select_only(sql: str) -> bool:
    try:
        statements = sqlglot.parse(sql, read="sqlite")
    except Exception:
        return False
    if not statements:
        return False
    for stmt in statements:
        if stmt is None:
            return False
        if not isinstance(stmt, (exp.Select, exp.Union, exp.Intersect, exp.Except)):
            return False
        for node in stmt.walk():
            if isinstance(node, (exp.Insert, exp.Update, exp.Delete, exp.Drop, exp.Alter, exp.Create, exp.Command)):
                return False
    return True


SQL_GEN_PROMPT = """You translate natural-language questions into a single SQLite SELECT query.

Rules:
- Output ONLY JSON: {{"sql": "<query>", "rationale": "<one line>"}}
- SELECT only. No INSERT/UPDATE/DELETE/DDL.
- ALWAYS alias aggregates with a descriptive name. E.g. `SELECT COUNT(*) AS active_count ...` not `SELECT COUNT(*) ...`. Same for SUM/AVG/MIN/MAX — never leave them un-aliased.
- When listing entities, JOIN to include the human-readable name (e.g. for leases, include `tenants.full_name`).
- Always LIMIT 50 unless the user asked for an aggregate.
- Prefer explicit column names over *.
- If the question cannot be answered with the schema, return {{"sql": "", "rationale": "<why>"}}.

Schema:
{schema}

Question: {question}
"""


async def nl_to_sql(question: str) -> dict:
    schema = schema_summary()
    client = OllamaClient()
    resp = await client.chat(
        messages=[
            {"role": "system", "content": "You are a precise SQLite query generator."},
            {"role": "user", "content": SQL_GEN_PROMPT.format(schema=schema, question=question)},
        ],
        temperature=0.0,
        format="json",
    )
    raw = resp.get("message", {}).get("content", "{}")
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {"sql": "", "rationale": "model output was not valid JSON", "rows": [], "error": raw[:200]}

    sql = (parsed.get("sql") or "").strip().rstrip(";")
    rationale = parsed.get("rationale", "")

    if not sql:
        return {"sql": "", "rationale": rationale, "rows": [], "error": "no sql generated"}

    if not _is_select_only(sql):
        return {"sql": sql, "rationale": rationale, "rows": [], "error": "rejected: non-SELECT statement"}

    try:
        with _conn() as c:
            cur = c.execute(sql)
            cols = [d[0] for d in cur.description] if cur.description else []
            rows = [dict(r) for r in cur.fetchmany(50)]
    except sqlite3.Error as e:
        return {"sql": sql, "rationale": rationale, "rows": [], "error": str(e)}

    return {
        "sql": sql,
        "rationale": rationale,
        "columns": cols,
        "rows": rows,
        "row_count": len(rows),
    }


async def query_database(natural_language_question: str) -> dict:
    """Tool wrapper exposed to the router."""
    result = await nl_to_sql(natural_language_question)
    citation = f"sql:{result.get('sql','')[:60]}" if result.get("sql") else "sql:none"
    result["citation"] = citation
    return result
