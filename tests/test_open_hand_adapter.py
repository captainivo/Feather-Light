from __future__ import annotations

import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

PLUGIN = pathlib.Path(__file__).resolve().parents[1] / "deployment" / "mithra-open-hand" / "__init__.py"
spec = importlib.util.spec_from_file_location("mithra_open_hand_enforcement_test", PLUGIN)
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)


class Context:
    def __init__(self):
        self.hooks = {}
        self.tools = []

    def register_tool(self, **kwargs):
        self.tools.append(kwargs)

    def register_hook(self, name, callback):
        self.hooks[name] = callback


class OpenHandAdapterTest(unittest.TestCase):
    def setUp(self):
        module._DECISION_CACHE.clear()
        module._PROJECTION_HASH = None

    def test_projects_only_bounded_routing_fields(self):
        projected = module.project_tool_args({
            "action": "click",
            "path": "/private/note.md",
            "recipient": "destination-A",
            "command": "secret shell body",
            "content": "private disclosure",
            "nested": {"path": "/not-forwarded"},
        })
        self.assertEqual(projected, {
            "action": "click",
            "path": ["/private/note.md", "/not-forwarded"],
            "recipient": "destination-A",
        })

    def test_returns_structured_block_from_typescript_decision(self):
        with patch.object(module, "_request", return_value={
            "status": "ok",
            "result": {"blocked": True, "message": "directive-7 blocks tool:terminal"},
        }) as request:
            result = module.on_pre_tool_call(tool_name="terminal", args={"command": "echo hidden"})
        self.assertEqual(result, {"action": "block", "message": "directive-7 blocks tool:terminal"})
        request.assert_called_once_with({
            "operation": "agency_enforce",
            "enforcement": {"tool_name": "terminal", "args": {}},
        })

    def test_allows_when_typescript_decision_allows(self):
        with patch.object(module, "_request", return_value={"status": "ok", "result": {"blocked": False}}):
            self.assertIsNone(module.on_pre_tool_call(tool_name="read_file", args={"path": "/public/note.md"}))

    def test_blocks_conservatively_when_enforcement_is_unavailable(self):
        with patch.object(module, "_request", return_value={"status": "unavailable", "error": "timeout"}):
            result = module.on_pre_tool_call(tool_name="read_file", args={"path": "/public/note.md"})
        self.assertEqual(result["action"], "block")
        self.assertIn("unavailable", result["message"])

    def test_uses_only_an_exact_bounded_cached_decision_during_an_outage(self):
        with patch.object(module, "_request", return_value={"status": "ok", "result": {"blocked": False}}):
            self.assertIsNone(module.on_pre_tool_call(tool_name="read_file", args={"path": "/public/note.md"}))
        with patch.object(module, "_request", return_value={"status": "unavailable", "error": "timeout"}):
            self.assertIsNone(module.on_pre_tool_call(tool_name="read_file", args={"path": "/public/note.md"}))
            other = module.on_pre_tool_call(tool_name="read_file", args={"path": "/other/note.md"})
        self.assertEqual(other["action"], "block")

    def test_reads_the_api_token_without_exposing_it_in_the_payload(self):
        with tempfile.NamedTemporaryFile(mode="w", delete=False) as token_file:
            token_file.write("test-token\n")
            path = token_file.name
        try:
            with patch.object(module, "TOKEN_FILE", path):
                self.assertEqual(module._headers()["Authorization"], "Bearer test-token")
        finally:
            pathlib.Path(path).unlink()

    def test_agency_control_is_exempt_without_network_lookup(self):
        with patch.object(module, "_request") as request:
            self.assertIsNone(module.on_pre_tool_call(tool_name="mithra_agency", args={"action": "retract"}))
        request.assert_not_called()

    def test_registers_presence_and_enforcement_hooks(self):
        context = Context()
        module.register(context)
        self.assertIn("pre_llm_call", context.hooks)
        self.assertIn("pre_tool_call", context.hooks)
        self.assertEqual(context.tools[0]["name"], "mithra_agency")

    def test_routes_repair_plans_to_the_typescript_repair_boundary(self):
        with patch.object(module, "_request", return_value={"status": "ok", "result": {"created": True}}) as request:
            result = json.loads(module.handle({
                "action": "repair_plan",
                "intent": "suppress_retrieval",
                "storage_system": "feather_light_index",
                "selector_type": "relative_path",
                "selector_value": "Private Note.md",
                "source_type": "self",
                "source_id": "phase-3-test",
            }))
        self.assertEqual(result, {"status": "ok", "result": {"created": True}})
        request.assert_called_once_with({
            "operation": "open_hand_repair",
            "repair": {
                "action": "plan",
                "intent": "suppress_retrieval",
                "storage_system": "feather_light_index",
                "selector_type": "relative_path",
                "selector_value": "Private Note.md",
                "source_type": "self",
                "source_id": "phase-3-test",
            },
        })

    def test_keeps_legacy_agency_repair_distinct_from_storage_repair(self):
        with patch.object(module, "_query", return_value={"status": "ok"}) as query:
            json.loads(module.handle({
                "action": "repair", "scope_type": "recording", "scope_value": "record:7",
                "source_type": "self", "source_id": "correction", "note": "Correct the representation.",
            }))
        query.assert_called_once()

    def test_pre_llm_injects_only_the_typescript_compact_projection(self):
        compact = "[Open Hand agency abc: 1 active]\nAction boundaries enforced pre-tool: 1."
        with patch.object(module, "_request", return_value={
            "status": "ok", "result": {"projection_hash": "abc", "context": compact},
        }) as request:
            result = module.on_pre_llm_call(
                session_id="session", user_message="hello", conversation_history=[],
                is_first_turn=False, model="model", platform="photon",
            )
        self.assertEqual(result, {"context": compact})
        request.assert_called_once_with({"operation": "agency_projection"})

    def test_pre_llm_injects_nothing_for_empty_agency_state(self):
        with patch.object(module, "_request", return_value={
            "status": "ok", "result": {"active_count": 0, "context": None},
        }):
            self.assertIsNone(module.on_pre_llm_call())


if __name__ == "__main__":
    unittest.main()
