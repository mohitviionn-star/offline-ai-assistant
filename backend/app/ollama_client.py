from typing import Any, AsyncIterator
import json
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
        keep_alive: str = "24h",
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "keep_alive": keep_alive,
            "options": {"temperature": temperature},
        }
        if tools:
            payload["tools"] = tools
        if format:
            payload["format"] = format

        async with httpx.AsyncClient(timeout=900.0) as client:
            r = await client.post(f"{self.url}/api/chat", json=payload)
            r.raise_for_status()
            return r.json()

    async def chat_stream(
        self,
        messages: list[dict[str, Any]],
        temperature: float = 0.1,
        keep_alive: str = "24h",
    ) -> AsyncIterator[str]:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "stream": True,
            "keep_alive": keep_alive,
            "options": {"temperature": temperature},
        }
        async with httpx.AsyncClient(timeout=900.0) as client:
            async with client.stream("POST", f"{self.url}/api/chat", json=payload) as r:
                r.raise_for_status()
                async for line in r.aiter_lines():
                    if not line:
                        continue
                    try:
                        obj = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    tok = obj.get("message", {}).get("content", "")
                    if tok:
                        yield tok
                    if obj.get("done"):
                        break

    async def is_alive(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(f"{self.url}/api/tags")
                return r.status_code == 200
        except Exception:
            return False
