import hashlib
import re
import uuid
from pathlib import Path
from pypdf import PdfReader
from .config import settings
from .embeddings import embed_texts
from .vector_store import ensure_collection, upsert_chunks


def _clean(text: str) -> str:
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _chunk_page(text: str, page_num: int, size: int, overlap: int) -> list[dict]:
    text = _clean(text)
    if not text:
        return []
    chunks: list[dict] = []
    start = 0
    n = len(text)
    while start < n:
        end = min(start + size, n)
        if end < n:
            window = text[start:end]
            break_at = max(window.rfind(". "), window.rfind("\n"))
            if break_at > size * 0.5:
                end = start + break_at + 1
        chunk_text = text[start:end].strip()
        if chunk_text:
            chunks.append(
                {"text": chunk_text, "page": page_num, "char_start": start, "char_end": end}
            )
        if end == n:
            break
        start = max(0, end - overlap)
    return chunks


def ingest_pdf(file_path: str, filename: str) -> dict:
    ensure_collection()
    reader = PdfReader(file_path)
    total_pages = len(reader.pages)

    doc_id = hashlib.sha1(f"{filename}:{file_path}".encode()).hexdigest()[:16]

    all_chunks: list[dict] = []
    for i, page in enumerate(reader.pages, start=1):
        page_text = page.extract_text() or ""
        all_chunks.extend(
            _chunk_page(page_text, i, settings.chunk_size, settings.chunk_overlap)
        )

    if not all_chunks:
        return {"doc_id": doc_id, "filename": filename, "chunks": 0, "pages": total_pages}

    vectors = embed_texts([c["text"] for c in all_chunks])

    points: list[dict] = []
    for idx, (chunk, vec) in enumerate(zip(all_chunks, vectors)):
        points.append(
            {
                "id": str(uuid.uuid4()),
                "vector": vec,
                "payload": {
                    "doc_id": doc_id,
                    "filename": filename,
                    "total_pages": total_pages,
                    "page": chunk["page"],
                    "chunk_idx": idx,
                    "char_start": chunk["char_start"],
                    "char_end": chunk["char_end"],
                    "text": chunk["text"],
                },
            }
        )

    upsert_chunks(points)
    return {
        "doc_id": doc_id,
        "filename": filename,
        "chunks": len(points),
        "pages": total_pages,
    }


def save_upload(content: bytes, filename: str) -> str:
    Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", filename)
    out = Path(settings.upload_dir) / safe
    out.write_bytes(content)
    return str(out)
