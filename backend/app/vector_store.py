from functools import lru_cache
from qdrant_client import QdrantClient
from qdrant_client.http import models as qm
from .config import settings


@lru_cache(maxsize=1)
def get_client() -> QdrantClient:
    return QdrantClient(url=settings.qdrant_url, timeout=30.0)


def ensure_collection() -> None:
    client = get_client()
    existing = {c.name for c in client.get_collections().collections}
    if settings.qdrant_collection not in existing:
        client.create_collection(
            collection_name=settings.qdrant_collection,
            vectors_config=qm.VectorParams(
                size=settings.embedding_dim, distance=qm.Distance.COSINE
            ),
        )


def upsert_chunks(points: list[dict]) -> None:
    client = get_client()
    qpoints = [
        qm.PointStruct(id=p["id"], vector=p["vector"], payload=p["payload"])
        for p in points
    ]
    client.upsert(collection_name=settings.qdrant_collection, points=qpoints)


def search(vector: list[float], top_k: int) -> list[dict]:
    client = get_client()
    hits = client.search(
        collection_name=settings.qdrant_collection,
        query_vector=vector,
        limit=top_k,
        with_payload=True,
    )
    return [
        {"id": str(h.id), "score": float(h.score), "payload": h.payload or {}}
        for h in hits
    ]


def list_documents() -> list[dict]:
    client = get_client()
    seen: dict[str, dict] = {}
    offset = None
    while True:
        points, offset = client.scroll(
            collection_name=settings.qdrant_collection,
            limit=256,
            with_payload=True,
            offset=offset,
        )
        for p in points:
            payload = p.payload or {}
            doc_id = payload.get("doc_id")
            if not doc_id or doc_id in seen:
                continue
            seen[doc_id] = {
                "doc_id": doc_id,
                "filename": payload.get("filename"),
                "pages": payload.get("total_pages"),
            }
        if not offset:
            break
    return list(seen.values())
