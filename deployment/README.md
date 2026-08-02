# VM deployment

Target layout:

```text
/home/mithra/feather-light/                         application checkout
/home/mithra/.config/feather-light/config.yaml     host configuration
/home/mithra/.hermes/mithra/feather-light/state/  rebuildable SQLite state
/home/mithra/.hermes/plugins/feather-light/        Hermes plugin
```

The API and Hermes are expected to run on the same VM. Feather-Light binds only to
`127.0.0.1:8765`; it is not exposed to the LAN. The Hermes plugin exposes only retrieval and has
no ingestion, database, filesystem, SQL, Cypher, or mutation operation.

## Install

```bash
# From the development machine (the repository is private):
rsync -az --delete \
  --exclude .git --exclude .github --exclude node_modules --exclude dist --exclude state \
  ./ mithra@192.168.1.65:/home/mithra/feather-light/

# On the VM:
cd /home/mithra/feather-light
chmod +x deployment/install.sh
deployment/install.sh
```

The installer enables the plugin and restarts the Hermes gateway. The tool becomes available to
new Hermes sessions as `feather_light`. If Hermes uses a session tool allowlist, add that tool to
its knowledge/lore profile and remove the legacy direct archive scanner only after a successful
acceptance test.

## Verify

```bash
systemctl --user status feather-light.service feather-light-ingest.timer
journalctl --user -u feather-light.service -n 100 --no-pager
curl -s http://127.0.0.1:8765/health
curl -s http://127.0.0.1:8765/v1/status
curl -s -X POST http://127.0.0.1:8765/v1/query \
  -H 'Content-Type: application/json' \
  -d '{"operation":"get","query":"Aanu-Kathara","limit":5}'
```

Before activation, verify the configured archive path exists and is the intended canonical,
read-only root. An unavailable root must produce a failed ingest without deleting indexed data.
