import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class ScaffoldTest(unittest.TestCase):
    def test_manifest(self):
        data = json.loads((ROOT / ".claude-plugin" / "plugin.json").read_text())
        self.assertEqual(data["name"], "routineos")
        for key in ("version", "description"):
            self.assertTrue(data.get(key), key)

    def test_license_and_readme(self):
        self.assertTrue((ROOT / "LICENSE").is_file())
        self.assertIn("MIT", (ROOT / "LICENSE").read_text())
        self.assertTrue((ROOT / "README.md").is_file())


if __name__ == "__main__":
    unittest.main()
