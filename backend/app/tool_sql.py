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


def schema_summary(include_samples: bool = True) -> str:
    """Compact schema description for the LLM. Sample rows can be skipped
    to keep the prompt short — useful for the router/plan call where the
    LLM just needs to know which tables exist."""
    out: list[str] = []
    with _conn() as c:
        tables = c.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).fetchall()
        for t in tables:
            tname = t["name"]
            cols = c.execute(f"PRAGMA table_info({tname})").fetchall()
            col_defs = ", ".join(f"{col['name']} {col['type']}" for col in cols)
            if include_samples:
                sample = c.execute(f"SELECT * FROM {tname} LIMIT 2").fetchall()
                sample_rows = [dict(r) for r in sample]
                out.append(
                    f"TABLE {tname}({col_defs})\n  sample: {json.dumps(sample_rows, default=str)}"
                )
            else:
                out.append(f"TABLE {tname}({col_defs})")
    return "\n".join(out) if out else "(no tables)"


def execute_sql(sql: str, rationale: str = "") -> dict:
    """Execute a SELECT-only SQL string and return rows. No LLM involvement.
    Used by router's merged plan_and_sql path."""
    sql = (sql or "").strip().rstrip(";")
    if not sql:
        return {"sql": "", "rationale": rationale, "rows": [], "error": "no sql"}
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


SQL_REPAIR_PROMPT = """A previous SQLite query failed or returned no rows. Fix it.

Original question: {question}
Original rationale: {rationale}
Failed SQL:
{sql}

Failure reason: {failure}

Schema:
{schema}

Rules:
- Output ONLY JSON: {{"sql": "<repaired query>", "rationale": "<what changed>"}}
- SELECT only.
- If the failure was "no rows", consider broadening filters (LIKE instead of =, drop overly-specific WHERE clauses, use case-insensitive matching).
- If the failure was a SQL error, fix the syntax/column/table issue.
- ALWAYS alias aggregates with a descriptive name.
- Use LIMIT 50 when listing rows.
- If you cannot repair the query, return {{"sql": "", "rationale": "<why unfixable>"}}.
"""


async def execute_sql_with_repair(
    sql: str,
    rationale: str,
    question: str,
    model: str | None = None,
    max_attempts: int = 2,
) -> dict:
    """Run SQL, and on error or empty rows, ask the LLM to repair it once.
    Adds `repair_attempts` and (when applicable) `repair_history` to the result."""
    result = execute_sql(sql, rationale)
    result["repair_attempts"] = 0

    needs_repair = bool(result.get("error")) or (
        not result.get("error") and result.get("row_count", 0) == 0
    )
    if not needs_repair or max_attempts < 1:
        return result

    history: list[dict] = [{"sql": sql, "error": result.get("error"), "row_count": result.get("row_count", 0)}]
    client = OllamaClient(model=model)
    schema = schema_summary(include_samples=False)

    current_sql = sql
    current_rationale = rationale
    current_result = result

    for attempt in range(1, max_attempts + 1):
        failure = current_result.get("error") or f"query returned 0 rows"
        prompt = SQL_REPAIR_PROMPT.format(
            question=question,
            rationale=current_rationale,
            sql=current_sql,
            failure=failure,
            schema=schema,
        )
        try:
            resp = await client.chat(
                messages=[
                    {"role": "system", "content": "You are a precise SQLite repair assistant."},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.0,
                format="json",
            )
            raw = resp.get("message", {}).get("content", "{}")
            parsed = json.loads(raw)
        except (json.JSONDecodeError, Exception):
            break

        new_sql = (parsed.get("sql") or "").strip().rstrip(";")
        if not new_sql or new_sql == current_sql:
            break

        new_rationale = parsed.get("rationale", current_rationale)
        new_result = execute_sql(new_sql, new_rationale)
        history.append({"sql": new_sql, "error": new_result.get("error"), "row_count": new_result.get("row_count", 0)})

        if not new_result.get("error") and new_result.get("row_count", 0) > 0:
            new_result["repair_attempts"] = attempt
            new_result["repair_history"] = history
            return new_result

        current_sql = new_sql
        current_rationale = new_rationale
        current_result = new_result

    current_result["repair_attempts"] = len(history) - 1
    current_result["repair_history"] = history
    return current_result
