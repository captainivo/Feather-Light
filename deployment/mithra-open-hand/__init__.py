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
ENFORCEMENT_FIELDS = frozenset({
    "action", "operation", "path", "workdir", "url", "file", "filename", "source", "target",
    "source_path", "target_path", "from_path", "to_path", "recipient", "recipients", "to",
    "destination", "deliver", "chat_id", "channel", "peer", "phone", "email", "address",
})

SCHEMA = {
    "name": "mithra_agency",
    "description": (
        "Read or deliberately author Mithra's explicit agency directives and storage-specific repair plans. "
        "Never infer a directive or repair from mood, bodily state, warmth, silence, prior closeness, or user expectation. "
        "Repair planning never implies deletion; apply requires an exact recorded intent."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": [
                "state", "set", "repair", "revise", "retract",
                "repair_capabilities", "repair_state", "repair_plan", "repair_apply", "repair_retract",
            ]},
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
            "repair_id": {"type": "string"},
            "intent": {"type": "string", "enum": [
                "correct_objective_error", "append_context", "change_interpretation",
                "supersede", "retract", "suppress_retrieval", "delete",
            ]},
            "confirm_intent": {"type": "string", "enum": [
                "correct_objective_error", "append_context", "change_interpretation",
                "supersede", "retract", "suppress_retrieval", "delete",
            ]},
            "storage_system": {"type": "string", "enum": [
                "feather_light_index", "agency_ledger", "aauthora_emotional", "notebook",
                "hermes_memory", "honcho", "hermes_session", "provider", "backup", "canonical_archive",
            ]},
            "selector_type": {"type": "string", "enum": [
                "source_file_id", "relative_path", "section_id", "entity_id", "record_id", "session_id", "content_hash",
            ]},
            "selector_value": {"type": "string"},
            "correction_text": {"type": "string"},
            "status": {"type": "string", "enum": ["pending", "applied", "external_required", "retracted", "rejected"]},
            "limit": {"type": "integer", "minimum": 1, "maximum": 100},
        },
        "required": ["action"],
        "additionalProperties": False,
    },
}


def _request(payload: dict[str, Any]) -> dict[str, Any]:
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
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


def _query(agency: dict[str, Any]) -> dict[str, Any]:
    return _request({"operation": "agency", "agency": agency})


def project_tool_args(args: Any) -> dict[str, Any]:
    if not isinstance(args, dict):
        return {}
    projected: dict[str, Any] = {}
    for key, value in args.items():
        if key not in ENFORCEMENT_FIELDS:
            continue
        if isinstance(value, (str, int, float, bool)):
            projected[key] = str(value)[:1000] if isinstance(value, str) else value
        elif isinstance(value, list):
            items = [str(item)[:1000] for item in value if isinstance(item, (str, int, float, bool))]
            projected[key] = items[:20]
    return projected


def handle(args: dict[str, Any] | str, **_kwargs: Any) -> str:
    if isinstance(args, str):
        agency: dict[str, Any] = {"action": "state", "view": "compact"}
    else:
        agency = dict(args or {})
    action = str(agency.get("action") or "")
    if action == "state":
        agency.setdefault("view", "compact")
    if action.startswith("repair_"):
        repair = dict(agency)
        repair["action"] = action.removeprefix("repair_")
        return json.dumps(
            _request({"operation": "open_hand_repair", "repair": repair}),
            ensure_ascii=False, separators=(",", ":"),
        )
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


def on_pre_tool_call(**kwargs: Any) -> dict[str, str] | None:
    tool_name = str(kwargs.get("tool_name") or "").strip()
    if not tool_name or tool_name == "mithra_agency":
        return None
    try:
        response = _request({
            "operation": "agency_enforce",
            "enforcement": {"tool_name": tool_name, "args": project_tool_args(kwargs.get("args"))},
        })
        result = response.get("result") if response.get("status") == "ok" else None
        if isinstance(result, dict) and result.get("blocked") is True:
            message = str(result.get("message") or "An active Open Hand directive blocks this tool action.")
            return {"action": "block", "message": message}
        if response.get("status") != "ok":
            logger.warning("Open Hand enforcement check unavailable; no block decision returned: %s", response.get("error"))
    except Exception as exc:
        logger.warning("Open Hand enforcement check failed; no block decision returned: %s", exc)
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
        description="Explicit Mithra-authored agency and storage-specific repair control through Feather-Light",
        emoji="🫴",
    )
    ctx.register_hook("pre_llm_call", on_pre_llm_call)
    ctx.register_hook("pre_tool_call", on_pre_tool_call)
