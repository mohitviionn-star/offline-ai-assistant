# Deploy to Hugging Face Spaces

End-to-end ~15 minutes. Free tier, no credit card.

## 1. Get a Groq API key (free)

1. Sign up at <https://console.groq.com>
2. Create an API key under **API Keys**
3. Save it — you'll paste it into the Space as a secret in step 4.

## 2. Create the HF Space

1. Log in at <https://huggingface.co>
2. New → Space
3. **Owner**: your account. **Space name**: e.g. `offline-ai-demo`
4. **License**: any (MIT is fine)
5. **Space SDK**: **Docker** → **Blank**
6. **Hardware**: **CPU basic — free**
7. **Visibility**: Public (or Private + share a link)
8. Click **Create Space**

## 3. Stage the deploy folder

From the project root:

```bash
bash hf-space/sync.sh
```

This produces `hf-space/_build/`, a self-contained repo with backend, frontend, Dockerfile, and the baked PDF + SQLite copied in.

## 4. Set the Groq secret

In your Space → **Settings** → **Variables and secrets** → **New secret**:

- Name: `GROQ_API_KEY`
- Value: the key from step 1

(Optional, only if you want to override defaults — they're already set in `config.py`:)

- `LLM_PROVIDER=groq`
- `GROQ_MODEL=llama-3.1-8b-instant`

## 5. Push to the Space

```bash
cd hf-space/_build
git init
git add .
git commit -m "initial deploy"
git remote add space https://huggingface.co/spaces/<YOUR_USERNAME>/<SPACE_NAME>
git push space main --force
```

HF will prompt for credentials. Use a **write-scoped access token** (Settings → Access Tokens) as the password, not your HF account password.

## 6. Watch the build

In the Space UI, click **Logs** → **Build logs**. First build takes ~5-8 min (pip install + npm install + sentence-transformers model download).

When it flips to **Running**, you'll see ingestion logs:

```
[entrypoint] seeding business.db from baked copy
[entrypoint] ingesting baked PDFs
  [ingested] tenant_handbook.pdf: ~30 chunks / 6 pages
[entrypoint] launching uvicorn on :7860
```

## 7. Test

Open the Space URL (e.g. `https://your-username-offline-ai-demo.hf.space`).

Try these in the UI:

- "What is the late fee policy?" → docs route
- "List all tenants" → sql route
- "How much rent did Devon Patel pay last month, and what is the late fee policy?" → hybrid route

## Updating later

Edit code locally, then re-run:

```bash
bash hf-space/sync.sh
cd hf-space/_build
git add . && git commit -m "update" && git push space main --force
```

## Known limitations of this demo

- **No persistence**: PDFs uploaded via the UI during the demo are lost on container restart. The baked-in `tenant_handbook.pdf` is always re-ingested on cold start.
- **First request after idle is slow**: HF free Spaces sleep after ~48hr inactivity; first request after sleep takes ~30-60s to wake.
- **Embeddings model downloads on first cold start**: sentence-transformers will pull `BAAI/bge-small-en-v1.5` (~130MB) the first time the container starts. Subsequent restarts use the HF cache.
- **LLM is Groq, not Ollama**: the real product runs Ollama locally on the client's box. The cloud demo uses Groq for speed and zero-setup. Behavior is similar (same Llama 3.1 8B family); be transparent with the client about this swap.
