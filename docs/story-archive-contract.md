# Story Archive Phase 0 contract

This contract separates clients from archive processing. Hermes, a future web UI, a CLI, or a
file-drop adapter must all produce the same normalized submission before n8n begins an archive
transaction.

## Canon authority

The author decides canon. A client or language service may prepare material and surface ambiguity,
but it must not silently change status or convert unsupported material into fact.

Allowed statuses are deliberately small:

- `canon`
- `probable`
- `draft`
- `speculative`
- `contradicted`
- `retconned`
- `discarded`

## Permanent IDs

IDs are lowercase, hyphenated, and permanent, for example `person-angus-001`. Renaming or moving a
note never changes its ID. Titles and aliases may change without creating a new entity.

## Required note metadata

```yaml
---
id: person-angus-001
title: Angus
type: person
status: canon
primary_category: character
categories:
  - character
  - third-civilization
regions:
  - alphara
eras:
  - third-civilization
aliases:
  - The Black Thorin
created: 2026-08-09
---
```

`categories`, `regions`, `eras`, and `aliases` are always arrays, including when empty. Duplicate
values are rejected case-insensitively.

## Normalized submission

```json
{
  "submission_id": "SUB-2026-08-09-004",
  "mode": "archive",
  "source_client": "web-ui",
  "submitted_at": "2026-08-09T19:54:00-07:00",
  "content": "Raw or prepared note text",
  "requested_status": "canon",
  "primary_subject": "Angus",
  "targets": ["person-angus-001"],
  "categories": ["character"],
  "metadata": {}
}
```

The accepted modes are `capture`, `develop`, `archive`, `update`, `retcon`, `discard`, `lookup`,
and `report`. An update or retcon must name at least one permanent target ID. Write-oriented modes
must contain non-whitespace content.

The submission ID is the idempotency key at the client boundary. Mechanical facts such as hashes,
diff totals, ledger event IDs, and Git commit IDs are generated after intake and never supplied as
trusted client facts.

## Validation endpoint

`POST /v1/archive/validate` accepts the normalized submission using the same bearer-token policy as
the other `/v1` routes. A successful response has `status: "valid"` and `persisted: false`.
Validation never claims that a transaction was queued, that canon was written, or that a Git commit
was created. Raw content is not echoed in the response; only its character count is returned.

## Durable intake endpoint

`POST /v1/archive/submissions` validates and stores the complete normalized request in the
development ledger. A new request returns HTTP 202 with `persisted: true`, a generated transaction
ID, and `transaction_status: "pending"`. It still does not write canon or create a Git commit.

`submission_id` is the idempotency key. Replaying the same normalized request returns HTTP 200 and
the original transaction with `replayed: true`. Reusing that ID with a different request returns
HTTP 409 with `status: "idempotency_conflict"`. Metadata object key order does not affect request
identity.

## Existing-vault migration audit

`npm run cli -- archive audit` performs the Phase 0.5 read-only scan. For each Markdown file it
records the source hash, effective title, existing fields, missing required fields, invalid values,
and a deterministic proposed ID when no ID exists. The proposal is advisory and is never written to
the note.

Use `--root ROOT_ID` to select one configured root and `--output MANIFEST.json` to save the complete
manifest outside the vault. The output contains a deterministic `manifestHash` suitable for review
and later batch approval. No audit operation writes Markdown or mutates the retrieval index.
