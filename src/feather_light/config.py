"""Validated service configuration with conservative defaults."""

from pathlib import Path

from pydantic import BaseModel, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class ServerSettings(BaseModel):
    host: str = "127.0.0.1"
    port: int = Field(default=8765, ge=1, le=65535)

    @field_validator("host")
    @classmethod
    def require_localhost_by_default(cls, value: str) -> str:
        if value not in {"127.0.0.1", "localhost", "::1"}:
            raise ValueError("network binding requires an explicit authenticated deployment")
        return value


class DatabaseSettings(BaseModel):
    path: Path = Path("state/feather_light.sqlite3")


class ArchiveRootSettings(BaseModel):
    root_id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]*$")
    display_name: str
    path: Path
    read_only: bool = True
    enabled: bool = True

    @field_validator("read_only")
    @classmethod
    def require_read_only(cls, value: bool) -> bool:
        if not value:
            raise ValueError("Phase 1 archive roots must be read-only")
        return value


class LimitSettings(BaseModel):
    search_results: int = Field(default=10, ge=1, le=100)
    definition_characters: int = Field(default=800, ge=100, le=4000)
    relationships_per_result: int = Field(default=10, ge=0, le=100)
    evidence_characters: int = Field(default=4000, ge=100, le=16000)
    graph_depth: int = Field(default=1, ge=1, le=3)
    response_characters: int = Field(default=16000, ge=1000, le=64000)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="FEATHER_LIGHT_",
        env_nested_delimiter="__",
        extra="forbid",
    )

    service_name: str = "feather-light"
    environment: str = "development"
    log_level: str = "INFO"
    server: ServerSettings = ServerSettings()
    database: DatabaseSettings = DatabaseSettings()
    archive_roots: list[ArchiveRootSettings] = []
    limits: LimitSettings = LimitSettings()
