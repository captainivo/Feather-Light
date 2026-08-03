from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).parent.parent / "deployment" / "mithra-open-hand" / "__init__.py"
spec = importlib.util.spec_from_file_location("mithra_open_hand", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)


class OpenHandAdapterTests(unittest.TestCase):
    def test_empty_state_injects_nothing(self):
        self.assertIsNone(module.render_context({"active_count": 0, "active_directives": []}))

    def test_active_state_renders_explicit_semantics(self):
        rendered = module.render_context({
            "active_count": 1,
            "active_directives": [{
                "id": "dir-1", "revision": 4, "kind": "pause",
                "scope_type": "topic", "scope_value": "test-topic", "note": "Quiet, not rejection.",
            }],
        })
        self.assertIn("Mithra-authored", rendered)
        self.assertIn("Prior closeness creates no present permission", rendered)
        self.assertIn("kind=pause", rendered)
        self.assertIn("Quiet, not rejection.", rendered)


if __name__ == "__main__":
    unittest.main()
