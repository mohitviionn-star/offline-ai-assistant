---
title: Offline AI Assistant (Demo)
emoji: "📄"
colorFrom: indigo
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
---

# Offline AI Assistant — Cloud Demo

Hybrid RAG (PDF + SQLite) demo. The production product runs fully offline on the client's machine using Ollama; this Space proxies the LLM to Groq for cloud demo purposes.

**Architecture (cloud demo):**
- React UI (built static) served by FastAPI
- FastAPI backend: routing, retrieval, citation logic
- Qdrant in local-file mode (single-container friendly)
- SQLite for structured data
- Groq API for LLM inference (Llama 3.1 8B Instant)

**Demo data baked into the image:**
- `tenant_handbook.pdf` (re-ingested into Qdrant on cold start)
- `business.db` (tenants/leases/properties/payments)

Configure `GROQ_API_KEY` as a Space Secret before launching.
