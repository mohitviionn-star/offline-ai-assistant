from functools import lru_cache
from sentence_transformers import SentenceTransformer
from .config import settings


@lru_cache(maxsize=1)
def get_embedder() -> SentenceTransformer:
    return SentenceTransformer(settings.embedding_model)


def embed_texts(texts: list[str]) -> list[list[float]]:
    model = get_embedder()
    vecs = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
    return vecs.tolist()


def embed_query(text: str) -> list[float]:
    return embed_texts([text])[0]
