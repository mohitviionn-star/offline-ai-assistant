import json
import sqlite3
import time
from pathlib import Path
from .config import settings


def _conn() -> sqlite3.Connection:
    Path(settings.audit_db_path).parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(settings.audit_db_path)
    c.row_factory = sqlite3.Row
    return c


def init() -> None:
    with _conn() as c:
        c.execute(
            """CREATE TABLE IF NOT EXISTS queries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts REAL NOT NULL,
                question TEXT NOT NULL,
                route TEXT,
                answer TEXT,
                confidence TEXT,
                citations_json TEXT,
                latency_ms INTEGER
            )"""
        )
        c.execute(
            """CREATE TABLE IF NOT EXISTS feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts REAL NOT NULL,
                vote TEXT NOT NULL,
                question TEXT,
                answer_preview TEXT,
                reason TEXT
            )"""
        )


def log_query(question: str, result: dict, latency_ms: int) -> None:
    with _conn() as c:
        c.execute(
            "INSERT INTO queries (ts, question, route, answer, confidence, citations_json, latency_ms) VALUES (?,?,?,?,?,?,?)",
            (
                time.time(),
                question,
                result.get("route"),
                result.get("answer"),
                result.get("confidence"),
                json.dumps(result.get("citations", []), default=str),
                latency_ms,
            ),
        )


def log_feedback(vote: str, question: str, answer: str, reason: str | None = None) -> None:
    with _conn() as c:
        c.execute(
            "INSERT INTO feedback (ts, vote, question, answer_preview, reason) VALUES (?,?,?,?,?)",
            (time.time(), vote, question, (answer or "")[:500], reason),
        )


def recent(limit: int = 50) -> list[dict]:
    with _conn() as c:
        rows = c.execute(
            "SELECT id, ts, question, route, confidence, latency_ms FROM queries ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]
