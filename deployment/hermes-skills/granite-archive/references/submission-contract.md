# Submission contract

Send one strict JSON object with these fields:

```json
{
  "submission_id": "mithra-unique-id",
  "mode": "capture",
  "source_client": "mithra-hermes",
  "submitted_at": "2026-08-10T12:00:00-07:00",
  "content": "The exact author-approved material.",
  "requested_status": "draft",
  "primary_subject": "Optional display name",
  "targets": [],
  "categories": [],
  "metadata": {}
}
```

Allowed modes are `capture`, `develop`, `archive`, `update`, `retcon`, `discard`, `lookup`, and
`report`. Allowed statuses are `canon`, `probable`, `draft`, `speculative`, `contradicted`,
`retconned`, and `discarded`.

`source_client` and categories are lowercase slugs. Target IDs are lowercase hyphenated permanent
IDs. `update` and `retcon` require at least one target. Write-oriented modes require non-empty
content. Use a genuinely unique, stable `submission_id`; retrying identical JSON with the same ID is
safe, while reusing an ID for different content is rejected.

The client validates locally before contacting n8n, but Feather-Light performs authoritative
validation and durable idempotency checks.
