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

Before activation, create an n8n **Header Auth** credential named `Granite Archive Intake` with
header name `X-Granite-Archive-Key` and a newly generated value. Attach it to the webhook node after
import; the versioned credential reference is only a placeholder and contains no secret. Install
the same value in Mithra's owner-readable
`~/.config/granite-archive/webhook-token`. Set
`GRANITE_ARCHIVE_WEBHOOK_URL` for Hermes to the production webhook URL ending in
`/webhook/story-archive/intake`.

Do not place the bearer token in this workflow export or commit it to Git. The workflow is imported
inactive and should remain inactive until a test execution returns `status: "accepted"`,
`persisted: true`, and `transaction_status: "pending"`.

The production webhook is authenticated independently from the Feather-Light bearer token. Do not
reuse either token or expose the n8n editor outside the trusted network.

## Completion email

`story-archive-completion-email.json` is a reusable sub-workflow for the final successful branch of
the future canonical-write worker. It refuses to send unless the input says `transaction_status:
"succeeded"` and includes both `note_id` and `git_revision`. The receipt contains procedural details
only—title, permanent ID, operation, canon status, changed path, Git revision, transaction ID, and
completion time—and never includes private story content.

Before use, create an n8n **SMTP** credential named `Granite Archive Notifications`, attach it to the
email node after import, and configure:

- `ARCHIVE_NOTIFICATION_FROM`, the sender address accepted by the SMTP account;
- `ARCHIVE_NOTIFICATION_EMAIL`, the private destination address.

Keep the workflow inactive until a synthetic `succeeded` payload sends one correct test message and
a non-success payload is rejected. The canonical worker must invoke it only after the note write,
ledger finalization, and Git commit all succeed.

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
