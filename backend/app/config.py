from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    ollama_url: str = "http://host.docker.internal:11434"
    ollama_model: str = "llama3.1:8b"

    qdrant_url: str = "http://qdrant:6333"
    qdrant_collection: str = "documents"

    embedding_model: str = "BAAI/bge-small-en-v1.5"
    embedding_dim: int = 384

    sqlite_path: str = "/data/business.db"
    audit_db_path: str = "/data/audit.db"
    upload_dir: str = "/data/uploads"

    chunk_size: int = 800
    chunk_overlap: int = 120
    top_k: int = 6


settings = Settings()
