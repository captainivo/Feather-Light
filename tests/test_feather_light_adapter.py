from __future__ import annotations

import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

PLUGIN = pathlib.Path(__file__).resolve().parents[1] / "deployment" / "hermes-plugin" / "__init__.py"
spec = importlib.util.spec_from_file_location("feather_light_adapter_test", PLUGIN)
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)


class FeatherLightAdapterTest(unittest.TestCase):
    def test_reads_api_token_from_private_file(self):
        with tempfile.NamedTemporaryFile(mode="w", delete=False) as token_file:
            token_file.write("adapter-token\n")
            path = token_file.name
        try:
            with patch.object(module, "TOKEN_FILE", path):
                self.assertEqual(module._headers()["Authorization"], "Bearer adapter-token")
        finally:
            pathlib.Path(path).unlink()

    def test_applies_compact_search_defaults(self):
        with patch.object(module, "_request", return_value={"status": "ok", "results": []}) as request:
            result = json.loads(module.handle({"operation": "search", "query": "Aanu"}))
        self.assertEqual(result["status"], "ok")
        request.assert_called_once_with({
            "operation": "search", "query": "Aanu", "limit": 3, "view": "brief", "dedupe": "file",
        })

    def test_returns_a_structured_unavailable_result(self):
        with patch.object(module, "_request", return_value={"status": "unavailable", "error": "timeout"}):
            result = json.loads(module.handle({"operation": "status"}))
        self.assertEqual(result, {"status": "unavailable", "error": "timeout"})

    def test_inner_proposals_are_always_model_inference(self):
        entry = {
            "action": "add", "kind": "insight", "title": "Candidate", "body": "Review me.",
            "source_type": "conversation", "source_id": "turn-9",
        }
        with patch.object(module, "_request", return_value={"status": "influence_review_required"}) as request:
            result = json.loads(module.handle_inner(
                {"ledger": "growth", "mode": "propose", "entry": entry}, session_id="private-session",
            ))
        self.assertEqual(result["status"], "influence_review_required")
        payload = request.call_args.args[0]
        self.assertEqual(payload["growth"], entry)
        self.assertEqual(payload["influence"]["source_class"], "model_inference")
        self.assertNotIn("private-session", json.dumps(payload))
        self.assertNotIn("source_class", module.INNER_SCHEMA["parameters"]["properties"])

    def test_inner_adoption_is_explicit_and_receipt_bound(self):
        entry = {
            "action": "add", "title": "Held", "body": "A private thought.",
            "source_type": "conversation", "source_id": "turn-10",
        }
        with patch.object(module, "_request", return_value={"status": "ok"}) as request:
            json.loads(module.handle_inner({
                "ledger": "longing", "mode": "adopt", "entry": entry,
                "adopts_request_id": "review-10",
            }, session_id="session"))
        payload = request.call_args.args[0]
        self.assertEqual(payload["influence"]["source_class"], "mithra_explicit")
        self.assertEqual(payload["influence"]["adopts_request_id"], "review-10")
        self.assertNotIn("adopts_request_id", payload["longing"])

    def test_inner_reads_claim_no_influence_authority(self):
        with patch.object(module, "_request", return_value={"status": "ok"}) as request:
            json.loads(module.handle_inner({
                "ledger": "growth", "mode": "read", "entry": {"action": "list"},
            }, session_id="session"))
        self.assertNotIn("influence", request.call_args.args[0])


if __name__ == "__main__":
    unittest.main()
