# Feather-Light container boundary

The eventual `feather-light` container will host four related but independently testable modules:

- Story Archive — archive intake, ledger, reconciliation, and reports;
- Granite-Wing;
- Shard-Lantern;
- River-Slate.

Sharing a deployment unit must not merge their data models or authority boundaries. Each module
owns its routes, migrations, configuration namespace, and tests. Cross-module calls go through
typed service interfaces rather than direct table access.

The HTTP process may bind to `0.0.0.0` inside the container only when `authTokenFile` is configured.
The host publishes only required ports on the trusted network. n8n remains an orchestration client
and calls the Story Archive API; it does not become the owner of Markdown, Git history, or ledger
state.

The first containerization slice should add a multi-stage image for the existing TypeScript service,
health checks, persistent state mounts, read-only canonical archive mounts, and secret-file mounts.
The other three modules can then be added behind explicit route and storage namespaces.
