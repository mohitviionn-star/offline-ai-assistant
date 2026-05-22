import time
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .config import settings
from . import audit
from .ingestion import ingest_pdf, save_upload
from .ollama_client import OllamaClient
from .router import answer as run_answer
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
    result = await run_answer(body.question)
    latency = int((time.time() - t0) * 1000)
    result["latency_ms"] = latency
    audit.log_query(body.question, result, latency)
    return result


@app.get("/audit")
async def get_audit(limit: int = 50) -> dict:
    return {"queries": audit.recent(limit)}
