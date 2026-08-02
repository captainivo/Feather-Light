"""Hermes adapter for the local Feather-Light API."""

from __future__ import annotations

import json
import os
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


BASE_URL = os.environ.get("FEATHER_LIGHT_URL", "http://127.0.0.1:8765").rstrip("/")
TIMEOUT_SECONDS = 5
MAX_RESPONSE_BYTES = 65_536

SCHEMA = {
    "name": "feather_light",
    "description": (
        "Search and inspect the canonical Westpole archive through compact, sourced, "
        "read-only records. Use for Aauthora people, places, things, lore facts, direct "
        "relationships, and chronology. Request facts only when the brief entity record "
        "is insufficient."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "operation": {
                "type": "string",
                "enum": ["search", "get", "facts", "timeline", "status"],
            },
            "query": {
                "type": "string",
                "description": "Search terms, exact entity name/ID, or timeline terms.",
            },
            "anchor": {
                "type": "string",
                "description": "Optional chronology anchor such as Fourth Civilization.",
            },
            "limit": {"type": "integer", "minimum": 1, "maximum": 20},
            "dedupe": {
                "type": "string",
                "enum": ["file", "title", "content", "none"],
                "description": "Search duplicate handling; file is the compact default.",
            },
            "allSources": {
                "type": "boolean",
                "description": "For timeline only, include duplicate source occurrences.",
            },
        },
        "required": ["operation"],
        "additionalProperties": False,
    },
}


def _request(payload: dict[str, Any]) -> dict[str, Any]:
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    request = Request(
        f"{BASE_URL}/v1/query",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            data = response.read(MAX_RESPONSE_BYTES + 1)
            if len(data) > MAX_RESPONSE_BYTES:
                return {"status": "response_limited", "error": "Feather-Light response exceeded adapter limit"}
            value = json.loads(data.decode("utf-8"))
            return value if isinstance(value, dict) else {"status": "internal_error"}
    except HTTPError as exc:
        data = exc.read(MAX_RESPONSE_BYTES)
        try:
            value = json.loads(data.decode("utf-8"))
            return value if isinstance(value, dict) else {"status": "internal_error"}
        except Exception:
            return {"status": "unavailable", "error": f"HTTP {exc.code}"}
    except (URLError, TimeoutError, OSError) as exc:
        return {"status": "unavailable", "error": type(exc).__name__}


def handle(args: dict[str, Any] | str, **_kwargs: Any) -> str:
    if isinstance(args, str):
        payload: dict[str, Any] = {"operation": "search", "query": args}
    else:
        payload = dict(args or {})
    payload.setdefault("limit", 5)
    if payload.get("operation") == "search":
        payload.setdefault("dedupe", "file")
    return json.dumps(_request(payload), ensure_ascii=False, separators=(",", ":"))


def check_available() -> bool:
    try:
        with urlopen(f"{BASE_URL}/health", timeout=2) as response:
            return response.status == 200
    except Exception:
        return False


def register(ctx: Any) -> None:
    ctx.register_tool(
        name="feather_light",
        toolset="mithra-context",
        schema=SCHEMA,
        handler=handle,
        check_fn=check_available,
        description="Compact read-only Westpole archive retrieval",
        emoji="🪶",
    )

