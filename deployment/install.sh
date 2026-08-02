#!/usr/bin/env bash
set -euo pipefail

export PATH="/home/mithra/.hermes/node/bin:$PATH"

APP_DIR="/home/mithra/feather-light"
CONFIG_DIR="/home/mithra/.config/feather-light"
STATE_DIR="/home/mithra/.hermes/mithra/feather-light/state"
PLUGIN_DIR="/home/mithra/.hermes/plugins/feather-light"
SYSTEMD_DIR="/home/mithra/.config/systemd/user"
HERMES_PY="/home/mithra/.hermes/hermes-agent/venv/bin/python"

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

install -d -m 0750 "$CONFIG_DIR" "$STATE_DIR" "$PLUGIN_DIR" "$SYSTEMD_DIR"
install -m 0640 deployment/config.vm.yaml "$CONFIG_DIR/config.yaml"
install -m 0644 deployment/systemd/feather-light.service "$SYSTEMD_DIR/feather-light.service"
install -m 0644 deployment/systemd/feather-light-ingest.service "$SYSTEMD_DIR/feather-light-ingest.service"
install -m 0644 deployment/systemd/feather-light-ingest.timer "$SYSTEMD_DIR/feather-light-ingest.timer"
install -m 0644 deployment/hermes-plugin/plugin.yaml "$PLUGIN_DIR/plugin.yaml"
install -m 0644 deployment/hermes-plugin/__init__.py "$PLUGIN_DIR/__init__.py"

systemctl --user daemon-reload
systemctl --user enable --now feather-light.service feather-light-ingest.timer
systemctl --user start feather-light-ingest.service

if [[ -x "$HERMES_PY" ]]; then
  "$HERMES_PY" -m hermes_cli.main plugins enable feather-light
  systemctl --user restart hermes-gateway.service
fi

curl --fail --silent --show-error http://127.0.0.1:8765/health
echo
curl --fail --silent --show-error http://127.0.0.1:8765/v1/status
echo
echo "Feather-Light installed and enabled for new Hermes sessions."
