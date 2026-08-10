from __future__ import annotations

import importlib.util
import pathlib
import tempfile
import unittest
from unittest.mock import patch

PLUGIN = pathlib.Path(__file__).resolve().parents[1] / "deployment" / "hermes-compat" / "world_state_tool.py"
spec = importlib.util.spec_from_file_location("world_state_adapter_test", PLUGIN)
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)


class _Response:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, _limit=-1):
        return b'{"status":"ok"}'


class WorldStateAdapterTest(unittest.TestCase):
    def test_authenticates_current_state_queries(self):
        with tempfile.NamedTemporaryFile(mode="w", delete=False) as token_file:
            token_file.write("state-token\n")
            path = token_file.name
        captured = []

        def open_request(request, timeout):
            captured.append((request, timeout))
            return _Response()

        try:
            with patch.object(module, "TOKEN_FILE", path), patch.object(module, "urlopen", side_effect=open_request):
                self.assertEqual(module.fetch_compact_state(record_conversation=True), {"status": "ok"})
            self.assertEqual(captured[0][0].get_header("Authorization"), "Bearer state-token")
            self.assertEqual(captured[0][1], 5)
        finally:
            pathlib.Path(path).unlink()

    def test_rejects_oversized_responses(self):
        response = _Response()
        response.read = lambda _limit=-1: b"x" * (module.MAX_RESPONSE_BYTES + 1)
        with patch.object(module, "urlopen", return_value=response):
            with self.assertRaisesRegex(ValueError, "safety limit"):
                module.fetch_compact_state(record_conversation=False)


if __name__ == "__main__":
    unittest.main()
