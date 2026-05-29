import json
import time
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from .config import settings
from . import audit
from .ingestion import ingest_pdf, save_upload
from .ollama_client import OllamaClient
from .router import answer as run_answer, answer_stream as run_answer_stream
from .tool_sql import schema_summary
from .vector_store import ensure_collection, list_documents

app = FastAPI(title="Offline AI Assistant", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _startup() -> None:
    audit.init()
    try:
        ensure_collection()
    except Exception:
        pass


class QueryIn(BaseModel):
    question: str
    model: str | None = None  # override OLLAMA_MODEL per request (e.g. "llama3.2:1b")


class FeedbackIn(BaseModel):
    vote: str  # "up" or "down"
    question: str
    answer: str
    reason: str | None = None


@app.get("/health")
async def health() -> dict:
    ollama = OllamaClient()
    return {
        "ok": True,
        "ollama_alive": await ollama.is_alive(),
        "ollama_model": settings.ollama_model,
        "qdrant_url": settings.qdrant_url,
        "sqlite_path": settings.sqlite_path,
    }


@app.get("/models")
async def models() -> dict:
    """List models available on the configured Ollama host, plus a curated
    'tier' label so the UI can present a Fast / Balanced / Smart selector."""
    import httpx
    tier_map = {
        "llama3.2:1b":     {"tier": "fast",     "label": "Fast (Llama 3.2 1B)",  "note": "~2x faster, lower quality"},
        "llama3.2:3b":     {"tier": "balanced", "label": "Balanced (Llama 3.2 3B)", "note": "default — good speed/quality"},
        "qwen2.5:7b":      {"tier": "smart",    "label": "Smart (Qwen 2.5 7B)",  "note": "best quality, ~2x slower"},
        "llama3.1:8b":     {"tier": "smart",    "label": "Smart (Llama 3.1 8B)", "note": "best quality, ~2x slower"},
    }
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{settings.ollama_url.rstrip('/')}/api/tags")
            r.raise_for_status()
            installed = [m["name"] for m in r.json().get("models", [])]
    except Exception as e:
        return {"current": settings.ollama_model, "available": [], "error": str(e)}

    # Surface only chat-capable models (skip embedding models)
    chat = [m for m in installed if not m.startswith("nomic-embed")]
    enriched = [
        {"name": m, **(tier_map.get(m, {"tier": "other", "label": m, "note": ""}))}
        for m in chat
    ]
    return {"current": settings.ollama_model, "available": enriched}


@app.get("/schema")
async def get_schema() -> dict:
    return {"schema": schema_summary()}


@app.get("/documents")
async def documents() -> dict:
    try:
        return {"documents": list_documents()}
    except Exception as e:
        return {"documents": [], "error": str(e)}


@app.post("/ingest")
async def ingest(file: UploadFile = File(...)) -> dict:
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "only .pdf supported in MVP")
    content = await file.read()
    path = save_upload(content, file.filename)
    result = ingest_pdf(path, file.filename)
    return {"ok": True, **result}


@app.get("/documents/{filename}")
async def get_document(filename: str) -> FileResponse:
    safe = Path(filename).name
    path = Path(settings.upload_dir) / safe
    if not path.exists():
        raise HTTPException(404, "not found")
    return FileResponse(path, media_type="application/pdf")


@app.post("/query")
async def query(body: QueryIn) -> dict:
    t0 = time.time()
    result = await run_answer(body.question, model=body.model)
    latency = int((time.time() - t0) * 1000)
    result["latency_ms"] = latency
    result["model_used"] = body.model or settings.ollama_model
    audit.log_query(body.question, result, latency)
    return result


@app.post("/query/stream")
async def query_stream(body: QueryIn):
    """Server-Sent Events stream of the answer.
    Emits 3 event types:
      event: meta   data: {route, rationale, citations, evidence}
      event: token  data: {text}
      event: done   data: {confidence, latency_ms, fast_path?, gated?}
    """
    async def gen():
        accumulated_text = []
        meta_payload = {}
        done_payload = {}
        try:
            async for event_type, payload in run_answer_stream(body.question, model=body.model):
                if event_type == "plan":
                    yield f"event: plan\ndata: {json.dumps(payload, default=str)}\n\n"
                elif event_type == "step":
                    yield f"event: step\ndata: {json.dumps(payload, default=str)}\n\n"
                elif event_type == "meta":
                    meta_payload = payload
                    yield f"event: meta\ndata: {json.dumps(payload, default=str)}\n\n"
                elif event_type == "token":
                    accumulated_text.append(payload)
                    yield f"event: token\ndata: {json.dumps({'text': payload})}\n\n"
                elif event_type == "done":
                    done_payload = payload
                    yield f"event: done\ndata: {json.dumps(payload)}\n\n"
                elif event_type == "followups":
                    yield f"event: followups\ndata: {json.dumps(payload)}\n\n"
        except Exception as e:
            yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"
        finally:
            # Log to audit using whatever we got
            try:
                full = "".join(accumulated_text).strip()
                composite = {
                    "answer": full,
                    "route": meta_payload.get("route"),
                    "confidence": done_payload.get("confidence"),
                    "citations": meta_payload.get("citations", []),
                }
                audit.log_query(body.question, composite, done_payload.get("latency_ms", 0))
            except Exception:
                pass

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # disable nginx buffering for SSE
        },
    )


@app.get("/audit")
async def get_audit(limit: int = 50) -> dict:
    return {"queries": audit.recent(limit)}


@app.post("/feedback")
async def feedback(body: FeedbackIn) -> dict:
    if body.vote not in ("up", "down"):
        raise HTTPException(400, "vote must be 'up' or 'down'")
    audit.log_feedback(body.vote, body.question, body.answer, body.reason)
    return {"ok": True}
