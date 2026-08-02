"""Create the service metadata baseline."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001_service_metadata"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "service_metadata",
        sa.Column("key", sa.String(length=100), primary_key=True),
        sa.Column("value", sa.Text(), nullable=False),
    )
    op.bulk_insert(
        sa.table(
            "service_metadata",
            sa.column("key", sa.String()),
            sa.column("value", sa.Text()),
        ),
        [
            {"key": "schema_version", "value": revision},
            {"key": "parser_version", "value": "uninitialized"},
        ],
    )


def downgrade() -> None:
    op.drop_table("service_metadata")
