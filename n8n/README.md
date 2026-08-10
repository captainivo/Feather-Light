# n8n workflows

Workflow exports in this directory are versioned source artifacts. Import them into n8n only after
the matching Feather-Light API version is deployed.

## Story Archive intake

`story-archive-intake.json` exposes a POST webhook and forwards the submitted JSON to
`POST /v1/archive/submissions`. It validates and durably records a pending archive transaction. It
does not yet write Markdown, record note events, or commit Git changes.

The n8n runtime must provide these secrets/configuration values:

- `FEATHER_LIGHT_BASE_URL`, such as `http://feather-light:8765` on a Docker network;
- `FEATHER_LIGHT_API_TOKEN`, supplied through the container secret/environment configuration.

Do not place the bearer token in this workflow export or commit it to Git. The workflow is imported
inactive and should remain inactive until a test execution returns `status: "accepted"`,
`persisted: true`, and `transaction_status: "pending"`.

## Queue worker

`story-archive-queue-worker.json` is the first portion of the archive-transaction orchestrator. It
polls for one pending transaction, claims it atomically, fetches the normalized request using the
claiming worker ID, and validates it again at the processing boundary. Invalid work is moved to
`failed` with bounded procedural provenance instead of being left in `processing`. The runtime additionally
requires `FEATHER_LIGHT_WORKER_ID`, a stable non-secret identifier unique to that n8n worker.

The successful branch deliberately ends at `Ready For Processing`: Markdown staging, deterministic archive
validation, Git commit, ledger finalization, and broader transport/runtime error recovery are being added as subsequent
versioned portions. Keep this workflow inactive until those downstream nodes exist; activating this
partial export would leave claimed transactions in `processing`.
