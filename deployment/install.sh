#!/usr/bin/env bash
set -euo pipefail

export PATH="/home/mithra/.hermes/node/bin:$PATH"

APP_DIR="/home/mithra/feather-light"
CONFIG_DIR="/home/mithra/.config/feather-light"
STATE_DIR="/home/mithra/.hermes/mithra/feather-light/state"
PLUGIN_DIR="/home/mithra/.hermes/plugins/feather-light"
OPEN_HAND_PLUGIN_DIR="/home/mithra/.hermes/plugins/mithra-open-hand"
CONTEXT_PLUGIN_DIR="/home/mithra/.hermes/plugins/mithra-context-telemetry"
SYSTEMD_DIR="/home/mithra/.config/systemd/user"
HERMES_PY="/home/mithra/.hermes/hermes-agent/venv/bin/python"
TOKEN_FILE="$CONFIG_DIR/api-token"

if [[ "$(id -un)" != "mithra" ]]; then
  echo "Run this installer as the mithra user." >&2
  exit 1
fi
if [[ ! -f "$APP_DIR/package.json" ]]; then
  echo "Expected Feather-Light application at $APP_DIR." >&2
  exit 1
fi
if [[ ! -d "/mnt/flying-battery-documents/The Westpole" ]]; then
  echo "Canonical Westpole root is unavailable; refusing initial ingest." >&2
  exit 1
fi

cd "$APP_DIR"
npm ci
npm run check
npm test
npm run build

install -d -m 0750 "$CONFIG_DIR" "$STATE_DIR" "$PLUGIN_DIR" "$OPEN_HAND_PLUGIN_DIR" "$SYSTEMD_DIR"
if [[ ! -f "$TOKEN_FILE" ]]; then
  umask 077
  od -An -N32 -tx1 /dev/urandom | tr -d ' \n' > "$TOKEN_FILE"
  printf '\n' >> "$TOKEN_FILE"
fi
if [[ ! -f "$CONFIG_DIR/config.yaml" ]]; then
  install -m 0640 deployment/config.vm.yaml "$CONFIG_DIR/config.yaml"
else
  install -m 0640 deployment/config.vm.yaml "$CONFIG_DIR/config.yaml.new"
  echo "Preserved existing $CONFIG_DIR/config.yaml; review the updated template at config.yaml.new."
  if ! grep -Eq '^[[:space:]]*authTokenFile:' "$CONFIG_DIR/config.yaml"; then
    echo "Warning: existing configuration does not enable API authentication; merge server.authTokenFile from config.yaml.new." >&2
  fi
fi
install -m 0644 deployment/systemd/feather-light.service "$SYSTEMD_DIR/feather-light.service"
install -m 0644 deployment/systemd/feather-light-ingest.service "$SYSTEMD_DIR/feather-light-ingest.service"
install -m 0644 deployment/systemd/feather-light-ingest.timer "$SYSTEMD_DIR/feather-light-ingest.timer"
install -m 0644 deployment/systemd/feather-light-environment.service "$SYSTEMD_DIR/feather-light-environment.service"
install -m 0644 deployment/systemd/feather-light-environment.timer "$SYSTEMD_DIR/feather-light-environment.timer"
install -m 0644 deployment/hermes-plugin/plugin.yaml "$PLUGIN_DIR/plugin.yaml"
install -m 0644 deployment/hermes-plugin/__init__.py "$PLUGIN_DIR/__init__.py"
install -m 0644 deployment/mithra-open-hand/plugin.yaml "$OPEN_HAND_PLUGIN_DIR/plugin.yaml"
install -m 0644 deployment/mithra-open-hand/__init__.py "$OPEN_HAND_PLUGIN_DIR/__init__.py"

if [[ -d "$CONTEXT_PLUGIN_DIR" ]]; then
  install -m 0644 deployment/hermes-compat/world_state_tool.py "$CONTEXT_PLUGIN_DIR/world_state_tool.py"
  install -m 0644 deployment/hermes-compat/emotional_reflection_tool.py "$CONTEXT_PLUGIN_DIR/emotional_reflection_tool.py"
else
  echo "Warning: context compatibility plugin directory is absent; compatibility shims were not installed." >&2
fi

systemctl --user daemon-reload
systemctl --user enable --now feather-light.service feather-light-ingest.timer feather-light-environment.timer
systemctl --user restart feather-light.service
systemctl --user start feather-light-ingest.service

if [[ -x "$HERMES_PY" ]]; then
  "$HERMES_PY" -m hermes_cli.main plugins enable feather-light
  "$HERMES_PY" -m hermes_cli.main plugins enable mithra-open-hand
  systemctl --user restart hermes-gateway.service
else
  echo "Warning: Hermes Python is absent; plugins were installed but not enabled and the gateway was not restarted." >&2
fi

curl --fail --silent --show-error http://127.0.0.1:8765/health
echo
{
  printf 'header = "Authorization: Bearer %s"\n' "$(tr -d '\n' < "$TOKEN_FILE")"
  printf 'url = "http://127.0.0.1:8765/v1/status"\n'
} | curl --fail --silent --show-error --config -
echo
echo "Feather-Light service installed. Review warnings above before treating Hermes integration as complete."
