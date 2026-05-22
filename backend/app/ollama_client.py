from typing import Any
import httpx
from .config import settings


class OllamaClient:
    def __init__(self, url: str | None = None, model: str | None = None):
        self.url = (url or settings.ollama_url).rstrip("/")
        self.model = model or settings.ollama_model

    async def chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.1,
        format: str | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "options": {"temperature": temperature},
        }
        if tools:
            payload["tools"] = tools
        if format:
            payload["format"] = format

        async with httpx.AsyncClient(timeout=300.0) as client:
            r = await client.post(f"{self.url}/api/chat", json=payload)
            r.raise_for_status()
            return r.json()

    async def is_alive(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(f"{self.url}/api/tags")
                return r.status_code == 200
        except Exception:
            return False
