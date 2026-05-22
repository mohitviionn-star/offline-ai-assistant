# syntax=docker/dockerfile:1.6

# ---------- Stage 1: build React ----------
FROM node:20-alpine AS frontend
WORKDIR /fe
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY frontend/ ./
# Frontend expects API under /api, which the FastAPI wrapper serves.
RUN npm run build

# ---------- Stage 2: Python runtime ----------
FROM python:3.11-slim

# HF Spaces requires a non-root user with HOME=/home/user
RUN useradd -m -u 1000 user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/home/user/.cache/huggingface \
    SENTENCE_TRANSFORMERS_HOME=/home/user/.cache/sentence-transformers

WORKDIR /app

# System deps for pypdf / numpy wheels
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Python deps (CPU torch via extra index, same as backend/requirements.txt)
COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt \
    && pip install --no-cache-dir groq==0.11.0

# Backend source
COPY backend/app /app/app

# Apply HF-specific overrides on top of the synced backend
COPY hf-space/overrides/config.py /app/app/config.py
COPY hf-space/overrides/ollama_client.py /app/app/ollama_client.py
COPY hf-space/overrides/vector_store.py /app/app/vector_store.py
COPY hf-space/overrides/hf_main.py /app/hf_main.py

# Baked-in demo data (PDFs + prebuilt SQLite)
COPY hf-space/baked /app/baked

# React build output → served as static by FastAPI
COPY --from=frontend /fe/dist /app/static

# Entrypoint
COPY hf-space/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh \
    && mkdir -p /tmp/data /tmp/uploads /tmp/qdrant \
    && chown -R user:user /app /tmp/data /tmp/uploads /tmp/qdrant /home/user

USER user

EXPOSE 7860
ENTRYPOINT ["/app/entrypoint.sh"]
