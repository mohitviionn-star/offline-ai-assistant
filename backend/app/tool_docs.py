from .config import settings
from .embeddings import embed_query
from .vector_store import search


def search_documents(query: str, top_k: int | None = None) -> list[dict]:
    """Vector-search ingested documents. Returns chunks with citation metadata."""
    k = top_k or settings.top_k
    vec = embed_query(query)
    hits = search(vec, k)
    results: list[dict] = []
    for h in hits:
        p = h["payload"]
        results.append(
            {
                "doc_id": p.get("doc_id"),
                "filename": p.get("filename"),
                "page": p.get("page"),
                "chunk_idx": p.get("chunk_idx"),
                "score": round(h["score"], 4),
                "text": p.get("text", ""),
                "citation": f"{p.get('filename')} p.{p.get('page')}",
            }
        )
    return results
