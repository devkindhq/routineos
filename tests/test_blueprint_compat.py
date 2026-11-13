"""Backward compatibility: routines, packs and Desks without a Blueprint behave as they did at 0.11.1.

compat_baseline.json was captured from the 0.11.1 release. A failure here is a real regression:
fix the code, never the baseline. The Desk hash drops the desk-src-hash meta line and the plugin version string."""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "skills", "routineos", "scripts")
SCRIPT = os.path.join(SCRIPTS, "routineos.py")
sys.path.insert(0, SCRIPTS)
sys.path.insert(0, os.path.join(ROOT, "tests"))

import pack  # noqa: E402
import pack_fixtures  # noqa: E402

FIX = os.path.join(ROOT, "tests", "fixtures")
BP = os.path.join(FIX, "blueprint")
TEMPLATES = os.path.join(ROOT, "templates")
CATALOG = os.path.join(ROOT, "catalog")


def load(name):
    with open(os.path.join(BP, name), encoding="utf-8") as fh:
        return json.load(fh)


LINT_BASE = load("lint_baseline.json")
COMPAT = load("compat_baseline.json")


def run(*args):
    return subprocess.run([sys.executable, SCRIPT, *args], capture_output=True, text=True, cwd=ROOT)


def routine_templates():
    return sorted(n for n in os.listdir(TEMPLATES) if os.path.isfile(os.path.join(TEMPLATES, n, "routine.toml")))


class CompatTests(unittest.TestCase):
    def test_all_templates_render(self):
        names = routine_templates()
        self.assertEqual(len(names), 12)
        for n in names:
            with self.subTest(template=n):
                r = run("blueprint", f"templates/{n}", "--json")
                self.assertEqual(r.returncode, 0, r.stderr)
                self.assertEqual(json.loads(r.stdout)["format"], "routineos.blueprint.v1")

    def test_all_templates_lint_byte_identical(self):
        for n in sorted(k for k in LINT_BASE if not k.startswith("_")):
            with self.subTest(template=n):
                r = run("lint", f"templates/{n}")
                self.assertEqual((r.stdout, r.returncode), (LINT_BASE[n]["stdout"], LINT_BASE[n]["code"]))

    def test_all_fixture_folders_lint_byte_identical(self):
        on_disk = sorted(n for n in os.listdir(FIX) if os.path.isfile(os.path.join(FIX, n, "routine.toml")))
        self.assertEqual(on_disk, sorted(COMPAT["lint_fixtures"]))
        for n in on_disk:
            with self.subTest(fixture=n):
                r = run("lint", f"tests/fixtures/{n}")
                self.assertEqual((r.stdout, r.returncode), (COMPAT["lint_fixtures"][n]["stdout"], COMPAT["lint_fixtures"][n]["code"]))

    def test_old_packs_validate(self):
        packs = [pack_fixtures.minimal_pack(), pack_fixtures.gated_pack()]
        for n in sorted(os.listdir(CATALOG)):
            if n.endswith(".json") and n != "index.json":
                with open(os.path.join(CATALOG, n), "rb") as fh:
                    packs.append(pack.parse(fh.read()))
        self.assertGreaterEqual(len(packs), 14)
        for p in packs:
            with self.subTest(pack=p.get("id")):
                self.assertEqual(pack.validate(p), [])

    def test_pack_export_has_no_blueprint_key_and_matches_base(self):
        for n, base in sorted(COMPAT["pack_export"].items()):
            with self.subTest(template=n):
                r = run("pack", "export", f"templates/{n}")
                self.assertEqual(r.returncode, base["code"])
                if r.returncode == 0:
                    self.assertNotIn("blueprint", json.loads(r.stdout))
                self.assertEqual(hashlib.sha256(r.stdout.encode()).hexdigest(), base["sha256"])

    def test_old_app_with_unknown_tables_loads(self):
        app = os.path.join(BP, "app_zzz")
        r = run("blueprint", app, "--json")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("routine:one", {n["id"] for n in json.loads(r.stdout)["nodes"]})
        self.assertNotIn("Traceback", run("lint", app).stderr)

    def test_desk_pages_without_blueprint_unchanged(self):
        ver = json.load(open(os.path.join(ROOT, ".claude-plugin", "plugin.json"), encoding="utf-8"))["version"]
        for n, base in sorted(COMPAT["desk_sha256"].items()):
            if base is None:
                continue
            with self.subTest(template=n):
                d = os.path.join(TEMPLATES, n)
                dash = os.path.join(d, "dashboard")
                self.assertFalse(os.path.exists(dash))
                try:
                    r = run("bundle", "--routine", d)
                    if isinstance(base, dict):
                        self.assertEqual((r.returncode, r.stdout), (base["code"], base["stdout"]))
                        continue
                    self.assertEqual(r.returncode, 0, r.stdout)
                    with open(os.path.join(dash, "index.html"), encoding="utf-8") as fh:
                        text = fh.read()
                finally:
                    shutil.rmtree(dash, ignore_errors=True)
                text = re.sub(r'<meta name="desk-src-hash"[^>]*>\n?', "", text).replace(ver, "VERSION")
                self.assertEqual(hashlib.sha256(text.encode()).hexdigest(), base)

    def test_no_blueprint_no_warn(self):
        for n in routine_templates():
            with self.subTest(template=n):
                self.assertNotIn("WARN", run("lint", f"templates/{n}").stdout)


if __name__ == "__main__":
    unittest.main()
