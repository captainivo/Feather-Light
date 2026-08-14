"""Hermes adapter for the local Feather-Light API."""

from __future__ import annotations

import hashlib
import json
import os
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


BASE_URL = os.environ.get("FEATHER_LIGHT_URL", "http://127.0.0.1:8765").rstrip("/")
TIMEOUT_SECONDS = 5
MAX_RESPONSE_BYTES = 65_536
TOKEN_FILE = os.path.expanduser(os.environ.get("FEATHER_LIGHT_TOKEN_FILE", "~/.config/feather-light/api-token"))


def _headers() -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    try:
        with open(TOKEN_FILE, encoding="utf-8") as token_file:
            token = token_file.read().strip()
        if token:
            headers["Authorization"] = f"Bearer {token}"
    except FileNotFoundError:
        pass
    return headers

SCHEMA = {
    "name": "feather_light",
    "description": (
        "Search and inspect the canonical Westpole archive through compact, sourced, "
        "read-only records. Use for Aauthora people, places, things, lore facts, direct "
        "relationships, chronology, current weather/life state, and private deliberate "
        "emotional reflection. Request facts only when the brief entity record is insufficient."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "operation": {
                "type": "string",
                "enum": ["search", "get", "facts", "timeline", "status", "current_state", "emotional_reflection"],
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
            "view": {
                "type": "string",
                "enum": ["brief", "standard"],
                "description": "brief is the token-efficient default; standard includes full audit metadata.",
            },
            "dedupe": {
                "type": "string",
                "enum": ["file", "title", "content", "none"],
                "description": "Search duplicate handling; file is the compact default.",
            },
            "allSources": {
                "type": "boolean",
                "description": "For timeline only, include duplicate source occurrences.",
            },
            "recordConversation": {
                "type": "boolean",
                "description": "For current_state, record this conversation activity; defaults true.",
            },
            "scope": {
                "type": "string",
                "enum": ["weather", "summary", "full"],
                "description": "For current_state: weather is minimal, summary is the compact default, full is audit detail.",
            },
            "reflection": {
                "type": "object",
                "description": (
                    "For emotional_reflection: a deliberate record_event, calibrate_cue, or "
                    "retract_event payload. Never infer feelings from weather or bodily state."
                ),
            },
        },
        "required": ["operation"],
        "additionalProperties": False,
    },
}

INNER_SCHEMA = {
    "name": "mithra_inner",
    "description": (
        "Read Mithra's growth/private-reflection ledgers, submit a model suggestion for review, "
        "or deliberately author/adopt a first-person entry. Proposal mode can never write. "
        "Author and adopt are explicit self-authorship acts; never infer them from mood, silence, "
        "prior closeness, user preference, Honcho output, or a model-generated interpretation."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "ledger": {"type": "string", "enum": ["growth", "longing"]},
            "mode": {"type": "string", "enum": ["read", "propose", "author", "adopt"]},
            "entry": {"type": "object", "description": "Exact Feather-Light growth or longing action payload."},
            "adopts_request_id": {
                "type": "string",
                "description": "Required for adopt: the exact review receipt covering this unchanged entry payload.",
            },
        },
        "required": ["ledger", "mode", "entry"],
        "additionalProperties": False,
    },
}


def _request(payload: dict[str, Any]) -> dict[str, Any]:
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    request = Request(
        f"{BASE_URL}/v1/query",
        data=body,
        headers=_headers(),
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
    payload.setdefault("limit", 3)
    if payload.get("operation") in {"search", "get", "facts", "timeline"}:
        payload.setdefault("view", "brief")
    if payload.get("operation") == "search":
        payload.setdefault("dedupe", "file")
    if payload.get("operation") == "current_state":
        payload.setdefault("recordConversation", True)
        payload.setdefault("scope", "summary")
    return json.dumps(_request(payload), ensure_ascii=False, separators=(",", ":"))


def _inner_influence(payload: dict[str, Any], mode: str, session_id: str, adopts: str | None) -> dict[str, str]:
    session_digest = hashlib.sha256((session_id or "local").encode("utf-8")).hexdigest()
    canonical = json.dumps([mode, payload, adopts], sort_keys=True, separators=(",", ":"))
    request_digest = hashlib.sha256(
        f"hermes-inner-v1:{session_digest}:{canonical}".encode("utf-8")
    ).hexdigest()
    context = {
        "request_id": f"hermes-inner:{request_digest}",
        "source_class": "model_inference" if mode == "propose" else "mithra_explicit",
        "source_ref": f"hermes-session:{session_digest[:24]}",
    }
    if mode == "adopt" and adopts:
        context["adopts_request_id"] = adopts
    return context


def handle_inner(args: dict[str, Any] | str, **kwargs: Any) -> str:
    if not isinstance(args, dict):
        return json.dumps({"status": "invalid_request", "error": "structured arguments required"})
    ledger = str(args.get("ledger") or "")
    mode = str(args.get("mode") or "")
    entry = args.get("entry")
    if ledger not in {"growth", "longing"} or mode not in {"read", "propose", "author", "adopt"} or not isinstance(entry, dict):
        return json.dumps({"status": "invalid_request", "error": "invalid inner operation"})
    payload: dict[str, Any] = {"operation": ledger, ledger: dict(entry)}
    if mode == "read":
        return json.dumps(_request(payload), ensure_ascii=False, separators=(",", ":"))
    adopts = args.get("adopts_request_id")
    if mode == "adopt" and (not isinstance(adopts, str) or not adopts.strip()):
        return json.dumps({"status": "invalid_request", "error": "adopt requires adopts_request_id"})
    if mode != "adopt" and adopts is not None:
        return json.dumps({"status": "invalid_request", "error": "adopts_request_id is valid only in adopt mode"})
    payload["influence"] = _inner_influence(
        payload[ledger], mode, str(kwargs.get("session_id") or ""),
        adopts.strip() if isinstance(adopts, str) else None,
    )
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
    ctx.register_tool(
        name="mithra_inner",
        toolset="mithra-context",
        schema=INNER_SCHEMA,
        handler=handle_inner,
        check_fn=check_available,
        description="Proposal-aware growth and private-reflection authorship through Feather-Light",
        emoji="🕯️",
    )
