"""End-to-end for the raw React page sample routine S1 to S7 (spec 18): lint, preview, approval-gated build, compile."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from test_desk_components_custom import bundle_desk, desk_raw, desk_registry, main, read, routineos  # noqa: E402,F401

FIXTURE = os.path.join(HERE, "desk_fixtures", "raw-pages")
PAGES = ["s1-listing", "s2-detail", "s2-detail-section", "s3-dashboard", "s4-form", "s5-board", "s6-settings", "s7-errors"]


def copy_fixture():
    d = tempfile.mkdtemp()
    shutil.rmtree(d)
    shutil.copytree(FIXTURE, d)
    return d


class RawSampleRoutineTest(unittest.TestCase):
    def test_fixture_has_every_sample_page(self):
        for cid in PAGES:
            self.assertTrue(os.path.isfile(os.path.join(FIXTURE, "desk", "components", cid, "component.json")), cid)
            self.assertTrue(os.path.isfile(os.path.join(FIXTURE, "desk", "components", cid, cid + ".jsx")), cid)

    def test_lint_is_clean(self):
        self.assertEqual(desk_registry.lint_routine_only(routineos.SKILL_ROOT, FIXTURE), [])

    def test_every_page_is_raw_and_uses_an_icon(self):
        for cid in PAGES:
            d = os.path.join(FIXTURE, "desk", "components", cid)
            m = json.loads(read(os.path.join(d, "component.json")))
            self.assertIs(m.get("raw"), True, cid)
            self.assertEqual(m["kind"], "custom", cid)
            self.assertIn("@tabler/icons-react", desk_raw.compile_page(d).specifiers, cid)

    def test_demo_snapshot_has_about_thirty_tasks(self):
        snap = json.loads(read(os.path.join(FIXTURE, "demo", "desk-demo.json")))
        tasks = [k for k, v in snap.items() if k.startswith("entities/task--") and v["data"]["type"] == "task"]
        self.assertGreaterEqual(len(tasks), 28)
        self.assertLessEqual(len(tasks), 32)

    def test_preview_writes_a_thunk_per_page(self):
        out = tempfile.mkdtemp()
        code, text, _ = main("desk", "preview", "--routine", FIXTURE, "--out", out)
        self.assertEqual(code, 0, text)
        html = read(os.path.join(out, "index.html"))
        for cid in PAGES:
            self.assertIn('window.DESK_PAGES["%s"] = function (DESK_LIB)' % cid, html, cid)
        self.assertTrue(os.path.isfile(os.path.join(out, "snapshot.json")))

    def test_build_refuses_before_approval_then_builds(self):
        d = copy_fixture()
        with self.assertRaises(routineos.DeskPageError) as cm:
            routineos.desk_page("W", routine_dir=d)
        for cid in PAGES:
            self.assertIn(cid, str(cm.exception))
        desk_registry.write_approvals(d, desk_registry.extension_rows(d))
        self.assertEqual(desk_registry.unapproved_extensions(d), [])
        html = routineos.desk_page("W", routine_dir=d)
        for cid in PAGES:
            self.assertIn('window.DESK_PAGES["%s"]' % cid, html, cid)

    def test_each_compiled_page_parses(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("node not on PATH")
        tmp = tempfile.mkdtemp()
        for cid in PAGES:
            compiled = desk_raw.compile_page(os.path.join(FIXTURE, "desk", "components", cid))
            self.assertEqual(compiled.problems, [], cid)
            path = os.path.join(tmp, cid + ".js")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write("function thunk(DESK_LIB) {\n" + compiled.js + "\n}\n")
            run = subprocess.run([node, "--check", path], capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, cid + ": " + run.stderr)


if __name__ == "__main__":
    unittest.main()
