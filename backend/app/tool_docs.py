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
    """Vector-search ingested documents with per-document diversification.

    Without diversification, a single large PDF with hundreds of chunks
    (e.g. NIST 800-66r2 has 509) can drown out shorter, more relevant
    documents (e.g. a 5-chunk SOP) just by having more top-scoring chunks.

    Strategy:
      1. Pull `top_k * candidate_multiplier` candidates from Qdrant.
      2. Group by filename.
      3. Round-robin across files, taking at most `per_doc_cap` from each,
         in original score order, until we have `top_k` results.
    """
    k = top_k or settings.top_k
    candidates_k = max(k * candidate_multiplier, k + 10)

    vec = embed_query(query)
    hits = search(vec, candidates_k)

    by_doc: dict[str, list[dict]] = defaultdict(list)
    for h in hits:
        p = h["payload"]
        chunk = {
            "doc_id": p.get("doc_id"),
            "filename": p.get("filename"),
            "page": p.get("page"),
            "chunk_idx": p.get("chunk_idx"),
            "score": round(h["score"], 4),
            "text": p.get("text", ""),
            "citation": f"{p.get('filename')} p.{p.get('page')}",
        }
        # Cap per-document during accumulation so we don't waste memory
        if len(by_doc[chunk["filename"]]) < per_doc_cap:
            by_doc[chunk["filename"]].append(chunk)

    # Round-robin: take the top hit from each doc, then the 2nd, etc.
    # This guarantees small docs get representation alongside huge ones.
    results: list[dict] = []
    while len(results) < k and any(by_doc.values()):
        for filename in list(by_doc.keys()):
            if by_doc[filename] and len(results) < k:
                results.append(by_doc[filename].pop(0))
            if not by_doc[filename]:
                del by_doc[filename]
    return results
