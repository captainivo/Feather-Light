# VM deployment

Target layout:

```text
/home/mithra/feather-light/                         application checkout
/home/mithra/.config/feather-light/config.yaml     host configuration
/home/mithra/.hermes/mithra/feather-light/state/  rebuildable SQLite state
/home/mithra/.hermes/plugins/feather-light/        Hermes plugin
```

The API and Hermes are expected to run on the same VM. Feather-Light binds only to
`127.0.0.1:8765`; it is not exposed to the LAN. Hermes receives bounded operations and has no
filesystem, SQL, Cypher, or archive-ingestion access. Deliberate emotional and agency operations
are the only mutation surfaces.

Feather-Light 0.4 owns the deterministic Aauthora environmental clock in TypeScript. On first
startup it imports the current day from the legacy Python Aauthora API, then persists and advances
season, Thaena, weather, accumulation, daylight, and bodily-cycle state in its own SQLite database.
The `feather-light-environment.timer` performs catch-up at Vancouver midnight; every read also
checks for missed days. Weather-only reads no longer depend on Python. The Python API temporarily
remains available for emotional reflection, conversation activity, inventory, gifts, and outfit
records while those stores are migrated separately.

Feather-Light 0.5 adds Open Hand Phase 3. Explicit refusal, pause, and withdrawal directives are
checked deterministically before Hermes tool calls. Agency control remains exempt so a directive
can always be revised or retracted. A separate storage-repair ledger distinguishes correction,
supersession, retraction, retrieval suppression, and deletion intent. The only native repair apply
operation is reversible suppression in Feather-Light's retrieval index: it changes query visibility
without changing or deleting canonical source files. Other storage systems report their actual
capability mode and require a separate verified adapter or manual action.

Open Hand is a local continuity and enforcement boundary, not proof of caller identity. Deployment
must keep Feather-Light loopback-only, and future multi-agent support must add authenticated,
principal-scoped ownership before directives can safely be shared between agents.

The civil clock maps each Vancouver calendar day proportionally onto that day's 24–45-hour
Aauthoran duration. Aauthoran midnight aligns with Vancouver midnight, and the recorded daylight
interval is centered on the Aauthoran day's midpoint. `current_state` exposes elapsed and remaining
Aauthoran hours, formatted Aauthoran time, progress, daylight boundaries, and whether it is
currently light or dark. This projection does not change the once-per-Earth-date generation rule.

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

The installer also replaces the existing `mithra_current_state` and
`mithra_emotional_reflection` implementations with compatibility shims. Their public tool names
remain unchanged, and all access now passes through Feather-Light. Current-state retrieval accepts
`weather`, `summary`, and `full` scopes; `summary` is the compact default and `full` is the explicit
audit path. The Aauthora service on port 8421 is now a temporary persistence backend only for the
remaining non-weather systems.

Version `0.2.4` expands conservative fact extraction beyond `Known Facts` lists. Approved factual
headings such as Construction, Form, Function, Appearance, History, Trapped Personhood, reports,
and Legacy can supply bounded sentence and bullet assertions. Bullet fragments are contextualized
with their section lead or entity and heading; open-question sections remain excluded. Explicit
reports and editorial speculation retain separate predicates and confidence. Facts responses include
a coverage summary and distribute bounded results across source sections before returning additional
claims from the same section.

Version `0.2.5` normalizes punctuation on contextualized bullet fragments and uses only the final
colon-led clause as their frame. This prevents comma-period endings and avoids repeating unrelated
lead sentences.

## Verify

```bash
systemctl --user status feather-light.service feather-light-ingest.timer feather-light-environment.timer
journalctl --user -u feather-light.service -n 100 --no-pager
curl -s http://127.0.0.1:8765/health
curl -s http://127.0.0.1:8765/v1/status
curl -s -X POST http://127.0.0.1:8765/v1/query \
  -H 'Content-Type: application/json' \
  -d '{"operation":"get","query":"Aanu-Kathara","limit":3,"view":"brief"}'
curl -s -X POST http://127.0.0.1:8765/v1/query \
  -H 'Content-Type: application/json' \
  -d '{"operation":"current_state","scope":"weather","recordConversation":false}'
```

Before activation, verify the configured archive path exists and is the intended canonical,
read-only root. An unavailable root must produce a failed ingest without deleting indexed data.
