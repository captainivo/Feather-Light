# Feather-Light

Feather-Light is a TypeScript service that builds a compact, provenance-preserving index of
the Westpole archive. Markdown remains authoritative and is always treated as read-only.

The current Phase 1 slice discovers Markdown safely, records a content-hashed manifest,
parses frontmatter and heading-bounded sections, extracts wikilinks, builds an FTS5 index,
and exposes bounded status and search operations.

## Setup

```bash
npm install
cp config.example.yaml config.yaml
npm run db:migrate
npm run ingest
npm test
```

For this workstation, `config.yaml` points to the canonical local archive at
`/Users/captainivo/Documents/Mithra Library/The Westpole`. The file is ignored by Git so
machine-specific paths are not published.

## Commands

```bash
npm run db:migrate
npm run ingest
npm run ingest:dry
npm run search -- "Aanu"
npm run dev
```

The API binds to `127.0.0.1:8765` by default:

- `GET /health` reports process health only.
- `GET /v1/status` reports index freshness and record counts.
- `POST /v1/search` searches titles, headings, and section text with bounded results.

## Safety guarantees

- Archive roots must be explicitly configured as read-only.
- Symlinks, special files, hidden application state, and unsupported files are skipped.
- Source files are opened only for reading.
- Missing or incomplete roots never trigger mass deletion.
- Indexed content is stored only under the local `state/` directory.
- Search results include stable source IDs, relative paths, headings, line ranges, and hashes.

