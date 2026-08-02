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
npm run cli -- status
npm run cli -- ingest --dry-run
npm run cli -- ingest
npm run cli -- search "Aanu"
npm run cli -- search --limit 5 --dedupe title "Aanu-Kathara"
npm run cli -- show sec_ab11f1ed3840bfafc4b84c59
npm run cli -- duplicates --kind title
npm run cli -- duplicates --kind content
npm run cli -- entities build
npm run cli -- entities list --type Person
npm run cli -- entities duplicates
npm run dev
```

Run `npm run cli -- help` for the complete command summary. Add `--json` to `status`,
`search`, `show`, or `duplicates` when scripting.

Search deduplication is caller-controlled:

- `file` returns one best section from each source file and is the default;
- `title` collapses files with the same normalized title;
- `content` collapses byte-identical source files;
- `none` returns matching sections without collapsing them.

Duplicate source records are never deleted or merged automatically. The CLI reports them so
later entity resolution can preserve their separate provenance and select or review a preferred
record explicitly.

A non-dry-run ingest automatically rebuilds the deterministic entity projection. `entities build`
is also available when testing classification rules without rescanning the archive.

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

## Entity boundary

The current index does not claim that every title is a resolved person, place, or thing. The
next deterministic entity pass will use explicit frontmatter, directory conventions, titles,
aliases, and wikilinks. Ambiguous prose extraction and duplicate resolution may use a local LLM
later, but model output will remain a provenance-bearing proposal rather than automatic canon.
