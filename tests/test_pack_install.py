"""pack validate and pack install through the CLI."""
import json
import os
import stat
import subprocess
import sys
import tempfile
import tomllib
import unittest

from pack_fixtures import CLI, gated_pack, minimal_pack


def run(*args):
    return subprocess.run([sys.executable, CLI, *args], capture_output=True, text=True)


class InstallTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def write_pack(self, p, name="p.json"):
        path = os.path.join(self.d, name)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(p, fh)
        return path

    def test_validate_ok_and_problems(self):
        res = run("pack", "validate", self.write_pack(minimal_pack()))
        self.assertEqual(res.returncode, 0, res.stderr)
        bad = minimal_pack()
        bad["scripts"] = "x"
        res = run("pack", "validate", self.write_pack(bad, "bad.json"), "--json")
        self.assertEqual(res.returncode, 1)
        out = json.loads(res.stdout)
        self.assertFalse(out["ok"])
        self.assertTrue(any("scripts" in x for x in out["problems"]))

    def test_validate_unreadable_source_is_exit_2(self):
        self.assertEqual(run("pack", "validate", os.path.join(self.d, "missing.json")).returncode, 2)
        self.assertEqual(run("pack", "validate", "http://example.org/p.json").returncode, 2)

    def test_install_writes_a_folder_that_lints(self):
        target = os.path.join(self.d, "demo")
        res = run("pack", "install", self.write_pack(gated_pack()), "--dir", target)
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
        for f in ("routine.toml", "prompt.md", "README.md", "definition.json", "dashboard/index.html", "pack.json",
                  "skills/reply-style/SKILL.md", "lib/count.py"):
            self.assertTrue(os.path.isfile(os.path.join(target, f)), f)
        self.assertEqual(run("lint", target).returncode, 0)
        with open(os.path.join(target, "pack.json"), encoding="utf-8") as fh:
            meta = json.load(fh)
        self.assertNotIn("routine", meta)
        self.assertEqual(meta["id"], "demo-watch")
        with open(os.path.join(target, "dashboard", "index.html"), encoding="utf-8") as fh:
            self.assertIn('"workspace": "demo-watch"', fh.read())
        for root, _, files in os.walk(target):
            for f in files:
                mode = os.stat(os.path.join(root, f)).st_mode
                self.assertFalse(mode & (stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH), f)

    def test_desk_page_escapes_the_config_block(self):
        sys.path.insert(0, os.path.dirname(CLI))
        import routineos
        html = routineos.desk_page("</script><script>alert(1)</script>&")
        self.assertNotIn("</script><script>alert(1)", html)
        self.assertIn("\\u003c/script\\u003e", html)
        self.assertIn("\\u0026", html)

    def test_install_reports_connectors(self):
        target = os.path.join(self.d, "demo")
        res = run("pack", "install", self.write_pack(gated_pack()), "--dir", target)
        out = res.stdout
        for text in ("Required", "Optional", "Web fetch", "Mail", "Outlook", "approve", "Add a mail connector.",
                     "Nothing was connected for you"):
            self.assertIn(text, out)

    def test_install_json_report(self):
        target = os.path.join(self.d, "demo")
        res = run("pack", "install", self.write_pack(gated_pack()), "--dir", target, "--json")
        self.assertEqual(res.returncode, 0, res.stderr)
        out = json.loads(res.stdout)
        self.assertEqual(out["installed"], target)
        self.assertEqual(out["lint"], [])
        self.assertEqual([c["id"] for c in out["connectors"]["required"]], ["web"])
        self.assertEqual([c["id"] for c in out["connectors"]["optional"]], ["mail"])
        self.assertEqual(out["connectors"]["optional"][0]["stages"], ["approve"])

    def test_existing_target_is_left_alone(self):
        target = os.path.join(self.d, "demo")
        os.makedirs(target)
        with open(os.path.join(target, "keep.txt"), "w") as fh:
            fh.write("mine")
        res = run("pack", "install", self.write_pack(minimal_pack()), "--dir", target)
        self.assertEqual(res.returncode, 2)
        self.assertEqual(os.listdir(target), ["keep.txt"])

    def test_invalid_pack_writes_nothing(self):
        bad = minimal_pack()
        bad["files"] = {"lib/../escape.py": "x"}
        target = os.path.join(self.d, "demo")
        res = run("pack", "install", self.write_pack(bad), "--dir", target)
        self.assertEqual(res.returncode, 1)
        self.assertEqual(sorted(os.listdir(self.d)), ["p.json"])

    def test_failure_halfway_leaves_no_temp_folder(self):
        sys.path.insert(0, os.path.dirname(CLI))
        import pack
        target = os.path.join(self.d, "demo")

        def broken_desk(name):
            raise OSError("disk full")
        with self.assertRaises(OSError):
            pack.install(minimal_pack(), target, desk_html=broken_desk)
        self.assertEqual(os.listdir(self.d), [])

    def test_rename_keeps_the_template_id(self):
        target = os.path.join(self.d, "mine")
        res = run("pack", "install", self.write_pack(minimal_pack()), "--dir", target, "--name", "my-watch")
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
        with open(os.path.join(target, "routine.toml"), "rb") as fh:
            cfg = tomllib.load(fh)
        self.assertEqual(cfg["routine"]["name"], "my-watch")
        self.assertEqual(cfg["workspace"]["template"], "demo-watch")
        with open(os.path.join(target, "pack.json"), encoding="utf-8") as fh:
            self.assertEqual(json.load(fh)["id"], "my-watch")

    def test_bad_rename_is_refused(self):
        res = run("pack", "install", self.write_pack(minimal_pack()), "--dir", os.path.join(self.d, "x"),
                  "--name", "Bad Name")
        self.assertEqual(res.returncode, 2)

    def test_default_target_is_the_id(self):
        path = self.write_pack(minimal_pack())
        res = subprocess.run([sys.executable, CLI, "pack", "install", path], capture_output=True, text=True,
                             cwd=self.d)
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertTrue(os.path.isfile(os.path.join(self.d, "demo-watch", "routine.toml")))


if __name__ == "__main__":
    unittest.main()
