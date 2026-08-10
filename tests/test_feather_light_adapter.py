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


if __name__ == "__main__":
    unittest.main()
