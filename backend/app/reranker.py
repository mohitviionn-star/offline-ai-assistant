"""Cross-encoder reranker for document retrieval.

Bi-encoder (bge-small) is fast but lossy: it scores query and chunk independently.
A cross-encoder reads (query, chunk) together and is far more accurate at the cost
of being slower. We use it as a re-ranking step after Qdrant top-k retrieval.
"""
from functools import lru_cache
from sentence_transformers import CrossEncoder

from .config import settings


@lru_cache(maxsize=1)
def get_reranker() -> CrossEncoder:
    return CrossEncoder(settings.reranker_model)


def rerank(query: str, candidates: list[dict], top_k: int) -> list[dict]:
    """Score (query, candidate.text) pairs with a cross-encoder and return
    the top_k candidates sorted by rerank score (descending).
    Each candidate gets a new `rerank_score` field; original `score` is preserved."""
    if not candidates:
        return []
    model = get_reranker()
    pairs = [(query, c.get("text", "") or "") for c in candidates]
    scores = model.predict(pairs, show_progress_bar=False)
    for c, s in zip(candidates, scores):
        c["rerank_score"] = float(s)
    candidates.sort(key=lambda c: c["rerank_score"], reverse=True)
    return candidates[:top_k]
