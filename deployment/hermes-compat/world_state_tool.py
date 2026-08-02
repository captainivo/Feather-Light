"""Compatibility tool routing Mithra's current state through Feather-Light."""
from __future__ import annotations

import json
from urllib.request import Request, urlopen

BASE_URL = "http://127.0.0.1:8765"
MAX_RESPONSE_BYTES = 65_536

SCHEMA = {
    "name": "mithra_current_state",
    "description": (
        "Get Mithra's current Aauthora environment, bodily cycle, emotional state, outfit, "
        "possessions summary, and prior-conversation interval through Feather-Light."
    ),
    "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
}


def _query(payload: dict) -> dict:
    request = Request(
        BASE_URL + "/v1/query",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json"},
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


def fetch_compact_state(*, record_conversation: bool) -> dict:
    return _query({"operation": "current_state", "recordConversation": record_conversation})


def handle(_args: dict, **_kwargs) -> str:
    try:
        return json.dumps(fetch_compact_state(record_conversation=True), sort_keys=True)
    except Exception as exc:
        return json.dumps({"error": "feather_light_state_unavailable", "detail": str(exc)[:240]})
