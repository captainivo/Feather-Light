"""Compatibility tool routing Mithra's current state through Feather-Light."""
from __future__ import annotations

import json
import os
from urllib.request import Request, urlopen

BASE_URL = "http://127.0.0.1:8765"
MAX_RESPONSE_BYTES = 65_536
VALID_SCOPES = {"weather", "summary", "full"}
TOKEN_FILE = os.path.expanduser(os.environ.get("FEATHER_LIGHT_TOKEN_FILE", "~/.config/feather-light/api-token"))

SCHEMA = {
    "name": "mithra_current_state",
    "description": (
        "Get Mithra's current Aauthora state through Feather-Light. Use weather for a minimal "
        "weather/season snapshot, summary for compact environment/body/mood/outfit context, "
        "and full only when detailed audit evidence is required."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "scope": {
                "type": "string",
                "enum": ["weather", "summary", "full"],
                "description": "weather is minimal; summary is the default; full returns audit detail.",
            },
        },
        "additionalProperties": False,
    },
}


def _query(payload: dict) -> dict:
    headers = {"Content-Type": "application/json"}
    try:
        with open(TOKEN_FILE, encoding="utf-8") as token_file:
            token = token_file.read().strip()
        if token:
            headers["Authorization"] = f"Bearer {token}"
    except FileNotFoundError:
        pass
    request = Request(
        BASE_URL + "/v1/query",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers=headers,
    )
    with urlopen(request, timeout=5) as response:
        raw = response.read(MAX_RESPONSE_BYTES + 1)
    if len(raw) > MAX_RESPONSE_BYTES:
        raise ValueError("Feather-Light response exceeded the safety limit")
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError("Feather-Light returned a non-object response")
    return value


def check_available() -> bool:
    try:
        with urlopen(BASE_URL + "/health", timeout=2) as response:
            return response.status == 200
    except Exception:
        return False


def fetch_compact_state(*, record_conversation: bool, scope: str = "summary") -> dict:
    selected_scope = scope if scope in VALID_SCOPES else "summary"
    return _query({
        "operation": "current_state",
        "recordConversation": record_conversation,
        "scope": selected_scope,
    })


def handle(args: dict, **_kwargs) -> str:
    try:
        scope = str((args or {}).get("scope") or "summary")
        return json.dumps(
            fetch_compact_state(record_conversation=True, scope=scope),
            sort_keys=True,
            separators=(",", ":"),
        )
    except Exception as exc:
        return json.dumps({"error": "feather_light_state_unavailable", "detail": str(exc)[:240]})
