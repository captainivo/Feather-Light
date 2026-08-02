# Phase 1 — Westpole archive retrieval

## Source boundary

The first source is the canonical `The Westpole` archive. It has its own root identity and is
read-only even when the underlying filesystem is writable. A notebook working copy may be
added later only as a separate root; records from distinct roots must never silently merge.

Initial workstation discovery found 394 Markdown files totaling about 1.9 MB at:

```text
/Users/captainivo/Documents/Mithra Library/The Westpole
```

Production deployment is expected to configure the equivalent SMB-mounted path rather than
copy this workstation path into business logic.

## Current implementation

- TypeScript on Node.js 22.
- SQLite manifest, provenance, sections, wikilinks, and FTS5.
- Explicit SQL migrations.
- Complete/partial/failed ingest-run states.
- Content hashes and stable source/section identifiers.
- Heading and exact line boundaries for evidence retrieval.
- Bounded HTTP and CLI search.

Graphiti remains a future, isolated Python integration because its official implementation is
Python-native. Deterministic TypeScript ingestion remains usable if that integration is absent.

## Deferred boundaries

Emotional state, weather, autobiographical memory, and relationship state are not part of this
archive index. Generated summaries and contaminated historical Honcho representations are not
migration inputs.

