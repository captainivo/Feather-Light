---
name: granite-archive
description: Prepare, validate, and submit author-approved Westpole story archive requests through the Feather-Light n8n intake boundary. Use for capture, archive, update, retcon, discard, or archive-transaction status requests. Do not use for ordinary brainstorming or read-only lore search.
version: 0.1.0
metadata:
  hermes:
    tags: [feather-light, granite-wing, story-archive, westpole]
    category: knowledge
---

# Granite Archive

Granite Archive is the careful writing boundary for the private Westpole archive. Feather-Light is
the authority for validation, durable transactions, and archive state. n8n is the orchestrator.
Never treat a successful intake response as proof that canon was written.

## Choose the operation

- `capture`: preserve supplied material in the durable development ledger without claiming canon.
- `archive`: propose a new archive note.
- `update`: propose changes to one or more existing permanent IDs.
- `retcon`: explicitly replace or contradict earlier canon; always name the affected IDs.
- `discard`: propose removal from active canon while retaining provenance.
- `develop`: remain in conversation; do not submit unless the author explicitly asks to capture it.
- `lookup` or `report`: use the `feather_light` read tool rather than creating a write transaction.

Read [references/archive-policy.md](references/archive-policy.md) before any write-oriented request.
Read [references/submission-contract.md](references/submission-contract.md) before constructing JSON.

## Workflow

1. Preserve the author's wording and distinguish stated fact from inference.
2. Resolve existing permanent IDs with `feather_light` before `update`, `retcon`, or `discard`.
3. Ask only questions whose answers could change identity, canon status, target IDs, or meaning.
4. For a new `archive` note, resolve and show the permanent ID, note type, primary and secondary
   categories, relative Markdown path, regions, eras, aliases, requested status, subject, and exact
   content. Put that approved identity in `metadata.archive_note`; n8n must not infer it.
5. Show a compact intake proposal containing mode, requested status, subject, targets, categories,
   and the exact content to preserve. Obtain explicit author approval before submission.
6. Write only the normalized JSON request to a temporary file with owner-only permissions. Do not
   place story content or credentials in shell arguments, logs, chat summaries, or Git.
7. Run `scripts/archivectl validate REQUEST.json`. If it succeeds, run
   `scripts/archivectl submit REQUEST.json`.
8. Report the returned `transaction_id` and `transaction_status`. Say "queued" or "accepted", never
   "archived", until the transaction reaches `succeeded` and the result identifies the committed
   note and Git revision.
9. Delete the temporary request file after submission unless the author asks to retain it locally.

If validation, authentication, or n8n fails, stop and report the exact bounded error. Never bypass
the n8n intake by editing the Westpole vault, SQLite ledger, or Git repository directly.

## Secret boundary

The client reads its webhook key from `GRANITE_ARCHIVE_TOKEN_FILE` (default:
`~/.config/granite-archive/webhook-token`) and its endpoint from `GRANITE_ARCHIVE_WEBHOOK_URL` or
the default `~/.config/granite-archive/webhook-url` file. Never print, copy either value into notes,
or commit the key. The
public key fingerprint used for Mithra's source-maintenance checkout is unrelated and cannot
authenticate archive submissions.
