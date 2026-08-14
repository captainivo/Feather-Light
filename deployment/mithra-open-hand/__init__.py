"""Thin Hermes adapter for Feather-Light's TypeScript agency boundary."""
from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)
BASE_URL = os.environ.get("FEATHER_LIGHT_URL", "http://127.0.0.1:8765").rstrip("/")
TIMEOUT_SECONDS = 3
MAX_RESPONSE_BYTES = 65_536
TOKEN_FILE = os.path.expanduser(os.environ.get("FEATHER_LIGHT_TOKEN_FILE", "~/.config/feather-light/api-token"))
CACHE_TTL_SECONDS = max(1.0, min(float(os.environ.get("FEATHER_LIGHT_ENFORCEMENT_CACHE_TTL", "15")), 60.0))
_DECISION_CACHE: dict[str, tuple[float, dict[str, str] | None]] = {}
_PROJECTION_HASH: str | None = None
ENFORCEMENT_FIELDS = frozenset({
    "action", "operation", "path", "workdir", "url", "file", "filename", "source", "target",
    "source_path", "target_path", "from_path", "to_path", "recipient", "recipients", "to",
    "destination", "deliver", "chat_id", "channel", "peer", "phone", "email", "address",
})
FIELD_ALIASES = {
    "recipientid": "recipient", "recipient_id": "recipient",
    "chatid": "chat_id", "channelid": "channel", "channel_id": "channel",
    "filepath": "path", "file_path": "path", "work_dir": "workdir",
}


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
            "adopts_request_id": {
                "type": "string",
                "description": "Exact review receipt being explicitly adopted; the server also verifies the payload hash.",
            },
            "repair_id": {"type": "string"},
            "intent": {
                "type": "string",
                "enum": [
                    "correct_objective_error", "append_context", "change_interpretation",
                    "supersede", "retract", "suppress_retrieval", "delete",
                ],
            },
            "confirm_intent": {
                "type": "string",
                "enum": [
                    "correct_objective_error", "append_context", "change_interpretation",
                    "supersede", "retract", "suppress_retrieval", "delete",
                ],
            },
            "storage_system": {
                "type": "string",
                "enum": [
                    "feather_light_index", "agency_ledger", "aauthora_emotional", "notebook",
                    "hermes_memory", "honcho", "hermes_session", "provider", "backup", "canonical_archive",
                ],
            },
            "selector_type": {
                "type": "string",
                "enum": ["source_file_id", "relative_path", "section_id", "entity_id", "record_id", "session_id", "content_hash"],
            },
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
        headers=_headers(), method="POST",
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


def _influence_context(agency: dict[str, Any], session_id: str) -> dict[str, str]:
    canonical = json.dumps(agency, sort_keys=True, separators=(",", ":"))
    session_digest = hashlib.sha256((session_id or "local").encode("utf-8")).hexdigest()
    request_digest = hashlib.sha256(
        f"hermes-agency-v1:{session_digest}:{canonical}".encode("utf-8")
    ).hexdigest()
    context = {
        "request_id": f"hermes-agency:{request_digest}",
        "source_class": "mithra_explicit",
        "source_ref": f"hermes-session:{session_digest[:24]}",
    }
    adopts = agency.pop("adopts_request_id", None)
    if isinstance(adopts, str) and adopts.strip():
        context["adopts_request_id"] = adopts.strip()
    return context


def _query(agency: dict[str, Any], *, session_id: str = "") -> dict[str, Any]:
    if agency.get("action") == "state":
        return _request({"operation": "agency", "agency": agency})
    bounded = dict(agency)
    influence = _influence_context(bounded, session_id)
    return _request({"operation": "agency", "agency": bounded, "influence": influence})


def project_tool_args(args: Any) -> dict[str, Any]:
    if not isinstance(args, dict):
        return {}
    projected: dict[str, Any] = {}

    def add(key: str, value: Any) -> None:
        if key not in ENFORCEMENT_FIELDS or not isinstance(value, (str, int, float, bool)):
            return
        bounded = str(value)[:1000] if isinstance(value, str) else value
        prior = projected.get(key)
        if prior is None:
            projected[key] = bounded
        elif isinstance(prior, list):
            if len(prior) < 20:
                prior.append(bounded)
        else:
            projected[key] = [prior, bounded]

    def walk(value: Any, depth: int = 0) -> None:
        if depth > 4:
            return
        if isinstance(value, dict):
            for raw_key, child in list(value.items())[:50]:
                key_text = str(raw_key)
                key = FIELD_ALIASES.get(key_text.lower(), key_text)
                if isinstance(child, (str, int, float, bool)):
                    add(key, child)
                elif isinstance(child, list):
                    for item in child[:20]:
                        if isinstance(item, (str, int, float, bool)):
                            add(key, item)
                        else:
                            walk(item, depth + 1)
                else:
                    walk(child, depth + 1)

    walk(args)
    return projected


def _decision_key(tool_name: str, projected: dict[str, Any]) -> str:
    encoded = json.dumps([tool_name, projected], sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _cached_decision(key: str) -> tuple[bool, dict[str, str] | None]:
    cached = _DECISION_CACHE.get(key)
    if not cached:
        return False, None
    expires_at, decision = cached
    if expires_at < time.monotonic():
        _DECISION_CACHE.pop(key, None)
        return False, None
    return True, decision


def handle(args: dict[str, Any] | str, **kwargs: Any) -> str:
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
        response = _request({"operation": "open_hand_repair", "repair": repair})
        if response.get("status") == "ok" and repair["action"] not in {"state", "capabilities"}:
            _DECISION_CACHE.clear()
        return json.dumps(response, ensure_ascii=False, separators=(",", ":"))
    response = _query(agency, session_id=str(kwargs.get("session_id") or ""))
    if response.get("status") == "ok" and action != "state":
        _DECISION_CACHE.clear()
    return json.dumps(response, ensure_ascii=False, separators=(",", ":"))


def on_pre_llm_call(**_kwargs: Any) -> dict[str, str] | None:
    global _PROJECTION_HASH
    try:
        response = _request({"operation": "agency_projection"})
        result = response.get("result") if response.get("status") == "ok" else None
        if not isinstance(result, dict):
            return None
        projection_hash = result.get("projection_hash")
        if isinstance(projection_hash, str) and _PROJECTION_HASH not in {None, projection_hash}:
            _DECISION_CACHE.clear()
        if isinstance(projection_hash, str):
            _PROJECTION_HASH = projection_hash
        context = result.get("context")
        return {"context": context} if isinstance(context, str) and context else None
    except Exception as exc:
        logger.warning("Open Hand agency projection failed; explicit tool fallback remains available: %s", exc)
        return None


def on_pre_tool_call(**kwargs: Any) -> dict[str, str] | None:
    tool_name = str(kwargs.get("tool_name") or "").strip()
    if not tool_name or tool_name == "mithra_agency":
        return None
    projected = project_tool_args(kwargs.get("args"))
    key = _decision_key(tool_name, projected)
    try:
        response = _request({
            "operation": "agency_enforce",
            "enforcement": {"tool_name": tool_name, "args": projected},
        })
        result = response.get("result") if response.get("status") == "ok" else None
        if isinstance(result, dict):
            decision = None
            if result.get("blocked") is True:
                decision = {
                    "action": "block",
                    "message": str(result.get("message") or "An active Open Hand directive blocks this tool action."),
                }
            _DECISION_CACHE[key] = (time.monotonic() + CACHE_TTL_SECONDS, decision)
            return decision
        logger.error("Open Hand enforcement unavailable: %s", response.get("error"))
    except Exception as exc:
        logger.error("Open Hand enforcement failed: %s", exc)
    hit, cached = _cached_decision(key)
    if hit:
        logger.warning("Using a bounded cached Open Hand decision during an enforcement outage")
        return cached
    return {
        "action": "block",
        "message": "Open Hand enforcement is unavailable. The action is paused until Mithra's active boundaries can be checked; agency control remains available.",
    }


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
