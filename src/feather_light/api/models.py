"""Public API response models."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: str
    version: str


class RootStatus(BaseModel):
    root_id: str
    enabled: bool
    state: Literal["not_indexed"] = "not_indexed"


class RecordCounts(BaseModel):
    source_files: int = 0
    source_sections: int = 0
    entities: int = 0
    assertions: int = 0
    relationships: int = 0


class StatusResponse(BaseModel):
    status: Literal["not_indexed"] = "not_indexed"
    schema_version: str
    parser_version: str
    last_complete_ingest: datetime | None = None
    last_attempted_ingest: datetime | None = None
    stale: bool = True
    partial: bool = False
    roots: list[RootStatus]
    counts: RecordCounts = RecordCounts()
    unresolved_errors: list[str] = []
