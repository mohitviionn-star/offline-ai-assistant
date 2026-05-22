#!/usr/bin/env bash
set -euo pipefail

echo "[entrypoint] starting Offline AI Assistant (HF Space demo)"

# Seed SQLite from the baked copy if not already present
if [ ! -f "/tmp/data/business.db" ] && [ -f "/app/baked/business.db" ]; then
  echo "[entrypoint] seeding business.db from baked copy"
  cp /app/baked/business.db /tmp/data/business.db
fi

# Make baked PDFs reachable via the /api/documents/<filename> endpoint
# (which serves from settings.upload_dir = /tmp/uploads).
if [ -d "/app/baked" ]; then
  mkdir -p /tmp/uploads
  cp /app/baked/*.pdf /tmp/uploads/ 2>/dev/null || true
fi

# Re-ingest baked PDFs into the local Qdrant on every cold start.
# Idempotent because ensure_collection() is a no-op if the collection exists,
# and chunk IDs are stable per (filename, page, chunk_idx). For a 1-PDF demo
# this takes ~10-20s on CPU.
if [ -d "/app/baked" ]; then
  echo "[entrypoint] ingesting baked PDFs"
  python - <<'PY'
import os, glob, sys
sys.path.insert(0, "/app")
from app.ingestion import ingest_pdf
from app.vector_store import ensure_collection, list_documents

ensure_collection()
existing = {d.get("filename") for d in list_documents()}
for pdf in sorted(glob.glob("/app/baked/*.pdf")):
    name = os.path.basename(pdf)
    if name in existing:
        print(f"  [skip] {name} already indexed")
        continue
    result = ingest_pdf(pdf, name)
    print(f"  [ingested] {name}: {result['chunks']} chunks / {result['pages']} pages")
PY
fi

echo "[entrypoint] launching uvicorn on :7860"
exec uvicorn hf_main:app --host 0.0.0.0 --port 7860 --app-dir /app
