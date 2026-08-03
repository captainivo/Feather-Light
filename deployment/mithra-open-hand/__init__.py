"""Thin Hermes adapter for Feather-Light's TypeScript agency boundary."""
from __future__ import annotations

import json
import logging
import os
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)
BASE_URL = os.environ.get("FEATHER_LIGHT_URL", "http://127.0.0.1:8765").rstrip("/")
TIMEOUT_SECONDS = 3
MAX_RESPONSE_BYTES = 65_536

SCHEMA = {
    "name": "mithra_agency",
    "description": (
        "Read or deliberately author Mithra's explicit agency directives. Never infer or create "
        "a directive from mood, bodily state, warmth, silence, prior closeness, or user expectation."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["state", "set", "repair", "revise", "retract"]},
            "view": {"type": "string", "enum": ["compact", "full"]},
            "directive_id": {"type": "string"},
            "kind": {
                "type": "string",
                "enum": ["refusal", "pause", "withdrawal", "correction", "explicit_permission"],
            },
            "scope_type": {
                "type": "string",
                "enum": ["conversation", "topic", "tool_action", "recording", "contact", "disclosure", "resource"],
            },
            "scope_value": {"type": "string"},
            "source_type": {"type": "string"},
            "source_id": {"type": "string"},
            "expires_at": {"type": "string", "description": "Optional timezone-aware ISO-8601 expiry."},
            "note": {"type": "string", "description": "Optional; justification is never required."},
            "idempotency_key": {"type": "string"},
        },
        "required": ["action"],
        "additionalProperties": False,
    },
}


def _query(agency: dict[str, Any]) -> dict[str, Any]:
    body = json.dumps({"operation": "agency", "agency": agency}, separators=(",", ":")).encode("utf-8")
    request = Request(
        f"{BASE_URL}/v1/query", data=body,
        headers={"Content-Type": "application/json"}, method="POST",
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
            return value if isinstance(value, dict) else {"status": "unavailable", "error": f"HTTP {exc.code}"}
        except Exception:
            return {"status": "unavailable", "error": f"HTTP {exc.code}"}
    except (URLError, TimeoutError, OSError) as exc:
        return {"status": "unavailable", "error": type(exc).__name__}


def handle(args: dict[str, Any] | str, **_kwargs: Any) -> str:
    if isinstance(args, str):
        agency: dict[str, Any] = {"action": "state", "view": "compact"}
    else:
        agency = dict(args or {})
    if agency.get("action") == "state":
        agency.setdefault("view", "compact")
    return json.dumps(_query(agency), ensure_ascii=False, separators=(",", ":"))


def render_context(state: dict[str, Any]) -> str | None:
    if int(state.get("active_count") or 0) <= 0:
        return None
    directives = state.get("active_directives")
    if not isinstance(directives, list):
        return None
    lines = [
        "[Mithra-authored active agency state — authoritative for this interaction]",
        "These choices are explicit, not inferred. Do not bargain with, soften, or reinterpret refusal, pause, or withdrawal.",
        "Prior closeness creates no present permission. A later explicit revision governs an earlier choice.",
    ]
    for item in directives[:20]:
        if not isinstance(item, dict):
            continue
        line = (
            f"- directive={item.get('id')} kind={item.get('kind')} "
            f"scope={item.get('scope_type')}:{item.get('scope_value')} revision={item.get('revision')}"
        )
        if item.get("expires_at"):
            line += f" expires_at={item['expires_at']}"
        lines.append(line)
        if item.get("note"):
            lines.append(f"  note: {item['note']}")
    return "\n".join(lines)


def on_pre_llm_call(**_kwargs: Any) -> dict[str, str] | None:
    try:
        response = _query({"action": "state", "view": "full"})
        result = response.get("result") if response.get("status") == "ok" else None
        if not isinstance(result, dict):
            return None
        context = render_context(result)
        return {"context": context} if context else None
    except Exception as exc:
        logger.warning("Open Hand agency-state prefetch failed; explicit tool fallback remains available: %s", exc)
        return None


def check_available() -> bool:
    try:
        with urlopen(f"{BASE_URL}/health", timeout=2) as response:
            return response.status == 200
    except Exception:
        return False


def register(ctx: Any) -> None:
    ctx.register_tool(
        name="mithra_agency",
        toolset="mithra-context",
        schema=SCHEMA,
        handler=handle,
        check_fn=check_available,
        description="Explicit Mithra-authored agency state through Feather-Light",
        emoji="🫴",
    )
    ctx.register_hook("pre_llm_call", on_pre_llm_call)
