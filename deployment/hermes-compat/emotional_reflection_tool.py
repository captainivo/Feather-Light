"""Compatibility tool routing deliberate emotional reflection through Feather-Light."""
from __future__ import annotations

import json
from urllib.request import Request, urlopen

BASE_URL = "http://127.0.0.1:8765"
MAX_RESPONSE_BYTES = 65_536

SCHEMA = {
    "name": "mithra_emotional_reflection",
    "description": (
        "Privately record, calibrate, or retract Mithra's own deliberate emotional appraisal "
        "through Feather-Light. Never infer emotion from weather, bodily state, elapsed time, "
        "user expectation, or the existing emotional projection."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["record_event", "calibrate_cue", "retract_event"]},
            "event_type": {"type": "string", "enum": [
                "supportive_interaction", "difficult_interaction", "achievement", "disappointment",
                "quiet_time", "reunion", "concern", "amusement", "curiosity", "relief", "conflict", "reflection"
            ]},
            "deltas": {"type": "object"},
            "source_type": {"type": "string"}, "source_id": {"type": "string"},
            "persistence": {"type": "string", "enum": ["passing", "short", "medium", "enduring"]},
            "uncertainty": {"type": "number", "minimum": 0, "maximum": 1},
            "appraisal": {"type": "object"},
            "relationship_evidence": {"type": "array", "items": {"type": "string"}},
            "note": {"type": "string"}, "cue": {"type": "string"},
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
            "evidence": {"type": "string"}, "event_id": {"type": "string"}, "reason": {"type": "string"},
        },
        "required": ["action"],
        "additionalProperties": False,
    },
}


def check_available() -> bool:
    try:
        with urlopen(BASE_URL + "/health", timeout=2) as response:
            return response.status == 200
    except Exception:
        return False


def handle(args: dict, **_kwargs) -> str:
    try:
        request = Request(
            BASE_URL + "/v1/query",
            data=json.dumps({"operation": "emotional_reflection", "reflection": args}).encode("utf-8"),
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urlopen(request, timeout=5) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
        if len(raw) > MAX_RESPONSE_BYTES:
            raise ValueError("Feather-Light response exceeded the safety limit")
        value = json.loads(raw)
        result = value.get("result", value) if isinstance(value, dict) else value
        return json.dumps(result, sort_keys=True)
    except Exception as exc:
        return json.dumps({"error": "emotional_reflection_failed", "detail": str(exc)[:240]})
