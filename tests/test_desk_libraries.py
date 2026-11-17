"""The Desk library registry (desk/libraries.json) and its Python reader, desk_libs (spec 16)."""
import copy
import json
import os
import re
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "skills", "routineos", "scripts"))

import desk_libs  # noqa: E402

PACKAGE_JSON = os.path.join(ROOT, "skills", "routineos", "assets", "desk", "package.json")
KEYS = {"specifier", "package", "version", "provides", "exports", "gzip_cost", "licence", "raise_reason"}
OPTIONAL = {"css", "provider"}
SPECIFIERS = {"react", "@mantine/core", "@mantine/hooks", "@mantine/charts", "@mantine/notifications",
              "mantine-datatable", "@tabler/icons-react", "@mantine/dates", "dayjs"}
ICONS = "@tabler/icons-react"


class RegistryTests(unittest.TestCase):
    def setUp(self):
        self.entries = desk_libs.load_libraries()
        self.by_spec = {e["specifier"]: e for e in self.entries}

    def test_registry_entries_complete(self):
        specs = [e["specifier"] for e in self.entries]
        self.assertEqual(len(specs), len(set(specs)))
        for e in self.entries:
            keys = set(e)
            self.assertTrue(KEYS <= keys, e["specifier"])
            self.assertFalse(keys - KEYS - OPTIONAL, e["specifier"])
            self.assertIn(e["licence"], desk_libs.LICENCES)
            self.assertTrue(e["raise_reason"].strip())
            self.assertEqual(set(e["gzip_cost"]), {"bytes", "measured"})

    def test_registry_specifiers(self):
        self.assertEqual(set(self.by_spec), SPECIFIERS)

    def test_versions_match_package_json(self):
        with open(PACKAGE_JSON, encoding="utf-8") as fh:
            pkg = json.load(fh)
        self.assertEqual(desk_libs.check_libraries(self.entries, pkg), [])
        bad = copy.deepcopy(self.entries)
        for e in bad:
            if e["specifier"] == "@mantine/core":
                e["version"] = "9.0.0"
        problems = desk_libs.check_libraries(bad, pkg)
        self.assertEqual(len(problems), 1)
        self.assertIn("@mantine/core", problems[0])
        self.assertEqual(desk_libs.versions(self.entries)["@mantine/core"], self.by_spec["@mantine/core"]["version"])

    def test_icon_subset(self):
        names = self.by_spec[ICONS]["exports"]
        self.assertIsInstance(names, list)
        self.assertEqual(names, sorted(set(names)))
        self.assertTrue(250 <= len(names) <= 320, len(names))
        for n in names:
            self.assertRegex(n, r"^Icon[A-Z][A-Za-z0-9]*$")
        for e in self.entries:
            if e["specifier"] != ICONS:
                self.assertEqual(e["exports"], "all", e["specifier"])

    def test_dates_entry(self):
        e = self.by_spec["@mantine/dates"]
        self.assertEqual(e["css"], "@mantine/dates/styles.css")
        self.assertEqual(e["provider"], "DatesProvider")

    def test_load_exports_missing_file_is_empty(self):
        self.assertEqual(desk_libs.load_exports(os.path.join(ROOT, "no-such-lib-exports.json")), {})

    def test_export_manifest_current(self):  # T-B7: the committed manifest matches the registry
        with open(desk_libs.EXPORTS_JSON, encoding="utf-8") as fh:
            raw = json.load(fh)
        self.assertEqual(set(raw), {"version", "exports"})
        self.assertEqual(raw["version"], 1)
        exports = desk_libs.load_exports()
        self.assertEqual(exports, raw["exports"])
        self.assertEqual(set(exports), set(self.by_spec))
        self.assertEqual(exports[ICONS], self.by_spec[ICONS]["exports"])
        for spec, names in exports.items():
            self.assertEqual(names, sorted(set(names)), spec)
            for n in names:
                self.assertRegex(n, r"^[A-Za-z_$][A-Za-z0-9_$]*$", spec)
        for name in ("Button", "Modal", "Tabs"):
            self.assertIn(name, exports["@mantine/core"])
        self.assertIn("default", exports["dayjs"])
        self.assertIn("useState", exports["react"])
        self.assertIn("DatesProvider", exports["@mantine/dates"])

    def test_load_exports_rejects_bad_shape(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "lib-exports.json")
            for text in ('{"react": ["useState"]}', '{"version": 2, "exports": {}}', '[]'):
                with open(p, "w", encoding="utf-8") as fh:
                    fh.write(text)
                with self.assertRaises(desk_libs.LibraryError, msg=text):
                    desk_libs.load_exports(p)
            with open(p, "w", encoding="utf-8") as fh:
                fh.write('{"version": 1, "exports": {"dayjs": ["default"]}}')
            self.assertEqual(desk_libs.load_exports(p), {"dayjs": ["default"]})

    def test_hash_inputs_cover_the_registry(self):
        import bundle_desk
        self.assertIn("libraries.json", bundle_desk.HASH_FILES)
        self.assertIn("libraries.json", bundle_desk.BLUEPRINT_FILES)
        with open(os.path.join(os.path.dirname(PACKAGE_JSON), "vite.config.js"), encoding="utf-8") as fh:
            self.assertRegex(fh.read(), r'const HASH_FILES = \[[^\]]*"libraries\.json"')

    def test_load_libraries_rejects_bad_file(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "libraries.json")
            with open(p, "w", encoding="utf-8") as fh:
                fh.write("{}")
            with self.assertRaises(desk_libs.LibraryError):
                desk_libs.load_libraries(p)


if __name__ == "__main__":
    unittest.main()
