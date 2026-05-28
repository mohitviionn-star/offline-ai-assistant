from collections import defaultdict

from .config import settings
from .embeddings import embed_query
from .vector_store import search


def search_documents(
    query: str,
    top_k: int | None = None,
    per_doc_cap: int = 2,
    candidate_multiplier: int = 4,
) -> list[dict]:
    """Vector-search ingested documents, optionally rerank with a cross-encoder,
    then diversify per-document.

    Pipeline:
      1. Pull a wide candidate pool from Qdrant (bi-encoder cosine).
      2. (Optional) Cross-encoder rerank the candidate pool.
      3. Per-document round-robin: at most `per_doc_cap` chunks per file,
         so a single huge PDF can't drown out smaller relevant ones.
    """
    k = top_k or settings.top_k
    if settings.enable_reranker:
        candidates_k = max(settings.rerank_candidates, k + 10)
    else:
        candidates_k = max(k * candidate_multiplier, k + 10)

    vec = embed_query(query)
    hits = search(vec, candidates_k)

    candidates: list[dict] = []
    for h in hits:
        p = h["payload"]
        candidates.append({
            "doc_id": p.get("doc_id"),
            "filename": p.get("filename"),
            "page": p.get("page"),
            "chunk_idx": p.get("chunk_idx"),
            "score": round(h["score"], 4),
            "text": p.get("text", ""),
            "citation": f"{p.get('filename')} p.{p.get('page')}",
        })

    if settings.enable_reranker and candidates:
        from .reranker import rerank
        candidates = rerank(query, candidates, top_k=len(candidates))

    by_doc: dict[str, list[dict]] = defaultdict(list)
    for c in candidates:
        if len(by_doc[c["filename"]]) < per_doc_cap:
            by_doc[c["filename"]].append(c)

    results: list[dict] = []
    while len(results) < k and any(by_doc.values()):
        for filename in list(by_doc.keys()):
            if by_doc[filename] and len(results) < k:
                results.append(by_doc[filename].pop(0))
            if not by_doc[filename]:
                del by_doc[filename]
    return results
