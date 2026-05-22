from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- LLM provider -----------------------------------------------------
    # In the cloud demo, llm_provider=groq routes the OllamaClient adapter
    # to Groq's OpenAI-compatible /chat/completions endpoint.
    # Default stays "ollama" so the same image can be re-pointed at a real
    # Ollama box (e.g. via a Modal tunnel) by flipping the env var.
    llm_provider: str = "groq"

    # Ollama config (used when llm_provider=ollama)
    ollama_url: str = "http://host.docker.internal:11434"
    ollama_model: str = "llama3.1:8b"

    # Groq config (used when llm_provider=groq)
    groq_api_key: str = ""
    groq_base_url: str = "https://api.groq.com/openai/v1"
    groq_model: str = "llama-3.1-8b-instant"

    # --- Vector store -----------------------------------------------------
    # qdrant_mode=local uses file-backed embedded Qdrant — required on
    # single-container HF Spaces. qdrant_mode=server keeps the original
    # docker-compose behavior for local dev.
    qdrant_mode: str = "local"
    qdrant_url: str = "http://qdrant:6333"
    qdrant_path: str = "/tmp/qdrant"
    qdrant_collection: str = "documents"

    embedding_model: str = "BAAI/bge-small-en-v1.5"
    embedding_dim: int = 384

    # --- Writable paths (HF Spaces only allows /tmp and $HOME) ------------
    sqlite_path: str = "/tmp/data/business.db"
    audit_db_path: str = "/tmp/data/audit.db"
    upload_dir: str = "/tmp/uploads"

    chunk_size: int = 800
    chunk_overlap: int = 120
    top_k: int = 6


settings = Settings()
