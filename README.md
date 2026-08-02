# Feather-Light

Feather-Light is a compact, provenance-preserving retrieval API for the Westpole archive.
It will maintain a deterministic SQLite search/provenance index and a semantic knowledge
graph while treating the Markdown archive as read-only canonical source material.

This repository currently contains the Phase 1 service skeleton (Milestone 1). It does not
open or ingest archive files yet.

## Quick start

```bash
uv sync --extra dev
uv run alembic upgrade head
uv run feather-light serve
```

The service binds to `127.0.0.1:8765` by default. Check it with:

```bash
curl http://127.0.0.1:8765/health
curl http://127.0.0.1:8765/v1/status
```

## Configuration

Settings use the `FEATHER_LIGHT_` environment prefix. Nested fields use `__`:

```bash
export FEATHER_LIGHT_SERVER__PORT=9000
export FEATHER_LIGHT_LOG_LEVEL=DEBUG
```

Archive roots are intentionally empty by default. A checked-in example is available at
`config.example.yaml`; YAML file loading will be added with the ingestion milestone.

The current implementation decisions and milestone boundary are recorded in
`docs/phase-1.md`.

## Development

```bash
uv run pytest
uv run ruff check .
uv run ruff format --check .
```

## Phase 1 boundaries

- The source archive is read-only and remains authoritative.
- Ordinary retrieval is compact; evidence is fetched explicitly.
- Contradictory claims remain separate assertions.
- Phase 2 emotional state and Phase 3 weather are out of scope.
