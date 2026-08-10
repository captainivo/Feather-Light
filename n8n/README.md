# n8n workflows

Workflow exports in this directory are versioned source artifacts. Import them into n8n only after
the matching Feather-Light API version is deployed.

## Story Archive validation

`story-archive-validate.json` exposes a POST webhook and forwards the submitted JSON to
`POST /v1/archive/validate`. It validates only: it does not write Markdown, record a ledger event,
or commit Git changes.

The n8n runtime must provide these secrets/configuration values:

- `FEATHER_LIGHT_BASE_URL`, such as `http://feather-light:8765` on a Docker network;
- `FEATHER_LIGHT_API_TOKEN`, supplied through the container secret/environment configuration.

Do not place the bearer token in this workflow export or commit it to Git. The workflow is imported
inactive and should remain inactive until a test execution returns `status: "valid"` and
`persisted: false`.
