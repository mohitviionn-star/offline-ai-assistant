"""
HF Space top-level FastAPI:
- mounts the existing backend app at /api (so the React frontend's BASE="/api"
  works without any frontend change)
- serves the React build at / from /app/static
"""
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app import audit
from app.main import app as api_app
from app.ollama_client import RateLimitError
from app.vector_store import ensure_collection


async def _rate_limit_handler(_: Request, exc: RateLimitError) -> JSONResponse:
    wait = f" (try again in ~{int(exc.retry_after)}s)" if exc.retry_after else ""
    return JSONResponse(
        status_code=200,
        content={
            "answer": (
                "The cloud demo is rate-limited right now — too many queries "
                f"in a short window{wait}. Please wait a few seconds and try again. "
                "(This limit doesn't apply in the offline install, which runs the "
                "LLM locally.)"
            ),
            "route": "refused",
            "rationale": "groq rate-limited",
            "citations": [],
            "evidence": {"documents": [], "sql": {}},
            "confidence": "refused",
            "gated": True,
            "latency_ms": 0,
        },
    )


# Register on api_app so it catches errors raised inside the mounted sub-app.
api_app.add_exception_handler(RateLimitError, _rate_limit_handler)

# Mounted sub-apps don't get their @on_event("startup") handlers fired by the
# parent's lifespan, so app.main's startup never runs. Initialize the audit
# tables and Qdrant collection here at import time — both are idempotent.
audit.init()
try:
    ensure_collection()
except Exception:
    pass

app = FastAPI(title="Offline AI Assistant (HF Space)")

# /api/* → existing FastAPI handlers (/health, /query, /ingest, ...)
app.mount("/api", api_app)

# /* → React SPA. html=True makes StaticFiles serve index.html for unknown paths.
static_dir = Path("/app/static")
if static_dir.exists():
    app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")
