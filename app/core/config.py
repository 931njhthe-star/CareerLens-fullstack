from pathlib import Path
from functools import lru_cache
from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / '.env', env_file_encoding='utf-8-sig', extra='ignore')
    openai_api_key: SecretStr = SecretStr('')
    openai_model: str = 'gpt-6-luna'
    embedding_model: str = 'text-embedding-3-small'
    embedding_dimensions: int = 1536
    database_url: SecretStr = SecretStr('')
    jwt_secret_key: SecretStr = SecretStr('')
    jwt_issuer: str = 'careerlens'
    access_token_seconds: int = 900
    refresh_token_days: int = 30
    database_pool_max_size: int = 10
    app_env: str = 'development'
    auth_enabled: bool = True
    admin_user_ids: str = ''
    cors_origins: str = 'http://localhost:3000,http://localhost:5173'
    upload_max_bytes: int = 10485760
    chunk_tokens: int = 600
    chunk_overlap: int = 80
    llm_concurrency: int = 4
    llm_timeout_seconds: float = 90
    worker_poll_seconds: float = 3
    worker_lease_seconds: int = 180
    evaluation_timeout_seconds: int = 900
    evaluation_report_dir: Path = ROOT / 'data' / 'private' / 'evaluation_reports'
    evaluation_execution_report_dir: Path = ROOT / 'data' / 'private' / 'evaluation_execution_reports'
    max_document_tokens: int = 20000
    checkpoint_enabled: bool = True


@lru_cache
def settings() -> Settings:
    return Settings()
