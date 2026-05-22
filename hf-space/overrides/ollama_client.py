"""
HF Space adapter: keeps the OllamaClient class name and async chat() shape
so router.py / main.py don't need to change, but routes calls to Groq's
OpenAI-compatible endpoint when llm_provider=groq.

The Ollama response shape returned to callers is:
    {"message": {"content": "..."}}
which is what the existing router expects.
"""
from typing import Any
import json
import httpx

from .config import settings


class RateLimitError(Exception):
    """Raised when the upstream LLM returns 429 (free-tier cap on Groq)."""

    def __init__(self, retry_after: float | None = None):
        self.retry_after = retry_after
        super().__init__("upstream rate limit")


class OllamaClient:
    def __init__(self, url: str | None = None, model: str | None = None):
        self.provider = settings.llm_provider.lower()
        if self.provider == "groq":
            self.url = (settings.groq_base_url).rstrip("/")
            self.model = model or settings.groq_model
            self.api_key = settings.groq_api_key
        else:
            self.url = (url or settings.ollama_url).rstrip("/")
            self.model = model or settings.ollama_model
            self.api_key = ""

    async def chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.1,
        format: str | None = None,
    ) -> dict[str, Any]:
        if self.provider == "groq":
            return await self._groq_chat(messages, temperature, format)
        return await self._ollama_chat(messages, tools, temperature, format)

    async def _groq_chat(
        self,
        messages: list[dict[str, Any]],
        temperature: float,
        format: str | None,
    ) -> dict[str, Any]:
        if not self.api_key:
            raise RuntimeError(
                "GROQ_API_KEY is not set. Add it as a Space Secret."
            )
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "stream": False,
        }
        if format == "json":
            payload["response_format"] = {"type": "json_object"}

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(timeout=120.0) as client:
            r = await client.post(
                f"{self.url}/chat/completions", json=payload, headers=headers
            )
            if r.status_code == 429:
                retry_after_header = r.headers.get("retry-after")
                try:
                    retry_after = float(retry_after_header) if retry_after_header else None
                except ValueError:
                    retry_after = None
                raise RateLimitError(retry_after=retry_after)
            r.raise_for_status()
            data = r.json()

        content = data["choices"][0]["message"]["content"]
        # Normalize to Ollama's response shape so router.py works unchanged.
        return {"message": {"content": content}}

    async def _ollama_chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None,
        temperature: float,
        format: str | None,
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
        if self.provider == "groq":
            # No cheap healthcheck on Groq — treat key-present as alive.
            return bool(self.api_key)
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(f"{self.url}/api/tags")
                return r.status_code == 200
        except Exception:
            return False
