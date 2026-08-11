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

The image uses independent build stages for the root service, River-Slate, and Shard-Lantern. A
minimal Node supervisor starts Granite-Wing first, waits for its API and shared database, then starts
the two dependent services. If any process exits unexpectedly, the supervisor terminates the whole
unit so container restart policy can restore a coherent set rather than leave a partial stack.

## Implemented first slice

The repository now includes a multi-stage Node 22 image and Compose definition for the existing
service. The runtime runs as the unprivileged `node` user with a read-only root filesystem, all
Linux capabilities dropped, and `no-new-privileges` enabled. SQLite state uses a named volume;
configuration, the API token, and canonical Markdown use read-only bind mounts. Canon is mounted at
`/archive/westpole`, and the Docker build context explicitly excludes local configuration, state,
private archives, and migration artifacts.

## Consolidated process shell

The image now packages Granite-Wing, Sky-Loom, River-Slate, and Shard-Lantern. Granite-Wing and
Sky-Loom are modules of the root Feather-Light process; River-Slate and Shard-Lantern remain separate
processes and data owners inside the same container. The container health check verifies all three
HTTP processes on loopback. Only Granite-Wing's authenticated port is published by Compose.

Named volumes keep the Feather-Light ledger/index, River-Slate generated health-card state, and
Shard-Lantern database independent. Canon remains a read-only bind mount. Private Shard-Lantern seed
data is intentionally not wired into the synthetic/default manifest; it will be provided as a
private mounted file during the later state migration.

The old Aauthora API on `8421` remains external for now because it still owns emotional state,
outfit, and possessions. Sky-Loom's deterministic environment engine already lives in the root
process and database; packaging it does not falsely claim those remaining responsibilities have
been migrated.

Granite-Wing and River-Slate accept `AUTHORA_API_BASE_URL`, and Granite-Wing accepts
`OLLAMA_BASE_URL`, so container deployments do not accidentally treat their own loopback as the
VM. Overrides are restricted to loopback and RFC 1918 private-LAN addresses. The current Mithra
Aauthora listener is loopback-only, so it must be deliberately bridged or migrated before features
that still depend on it can pass a cutover rehearsal. This dependency must not be exposed broadly
to the LAN merely to make the container reachable.
