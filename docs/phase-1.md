# Phase 1 — Westpole archive retrieval

## Current milestone

Milestone 1 establishes the repository and local service without opening the archive.

Included:

- Python 3.11 project managed by `uv`;
- FastAPI application with `/health` and `/v1/status`;
- validated localhost-only, read-only configuration defaults;
- SQLite/Alembic migration baseline;
- bounded response settings and machine-readable error foundation;
- structured operational logging that does not include archive prose;
- pytest and Ruff checks locally and in GitHub Actions.

## Initial decisions

The project-plan defaults are adopted until benchmark evidence requires a change:

1. Index the Westpole working copy as the first and only source root.
2. Keep source roots read-only and identify every root independently.
3. Omit embeddings from the MVP.
4. Bind the API to localhost.
5. Keep generated definitions unpreferred until reviewed.
6. Use deterministic SQLite ingestion before enabling Graphiti extraction.
7. Keep emotional state and weather outside Phase 1.

The production source path remains configuration, never application code. It is deliberately
absent from active defaults until Milestone 0 confirms the mounted root and benchmarks it.

## Next work

Before Milestone 2, confirm the accessible Westpole working-copy path and assemble a reviewed
benchmark question set. Milestone 2 then adds safe discovery, complete/partial scan semantics,
hashing, Markdown parsing, and exact source-section provenance.

