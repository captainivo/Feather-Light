"""SQLite engine primitives; archive schema arrives with ingestion."""

from pathlib import Path

import sqlalchemy as sa
from sqlalchemy import MetaData
from sqlalchemy.engine import Engine

metadata = MetaData()

service_metadata = sa.Table(
    "service_metadata",
    metadata,
    sa.Column("key", sa.String(100), primary_key=True),
    sa.Column("value", sa.Text, nullable=False),
)


def create_sqlite_engine(path: Path) -> Engine:
    """Create an engine for rebuildable local state, never an archive path."""
    return sa.create_engine(f"sqlite:///{path}")
