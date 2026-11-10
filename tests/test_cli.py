import json
import os
import re
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "skills", "routineos", "scripts")
CLI = os.path.join(SCRIPTS, "routineos.py")
FIX = os.path.join(ROOT, "tests", "fixtures")
sys.path.insert(0, SCRIPTS)

import bundle_desk  # noqa: E402
import schema  # noqa: E402


def run(*args):
    return subprocess.run([sys.executable, CLI, *args], capture_output=True, text=True)


def lint_fixture(name):
    return run("lint", os.path.join(FIX, name))


class SchemaTests(unittest.TestCase):
    def test_load_bad_toml_raises_schema_error(self):
        with self.assertRaises(schema.SchemaError):
            schema.load(os.path.join(FIX, "malformed", "routine.toml"))

    def test_load_missing_keys_raises(self):
        with self.assertRaises(schema.SchemaError):
            schema.load(os.path.join(FIX, "missing_keys", "routine.toml"))

    def test_load_unknown_type_raises(self):
        with self.assertRaises(schema.SchemaError) as cm:
            schema.load(os.path.join(FIX, "unknown_type", "routine.toml"))
        self.assertIn("sprocket", str(cm.exception))

    def test_lint_clean_returns_empty(self):
        cfg = schema.load(os.path.join(FIX, "clean", "routine.toml"))
        with open(os.path.join(FIX, "clean", "prompt.md")) as f:
            self.assertEqual(schema.lint(cfg, f.read()), [])

    def test_lint_prompt_none_is_a_problem(self):
        cfg = schema.load(os.path.join(FIX, "clean", "routine.toml"))
        self.assertTrue(schema.lint(cfg, None))


class LintCliTests(unittest.TestCase):
    def test_clean_passes(self):
        r = lint_fixture("clean")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_setting_missing_default_names_setting(self):
        r = lint_fixture("no_default")
        self.assertEqual(r.returncode, 1)
        self.assertIn("limit", r.stdout)
        self.assertIn("default", r.stdout)

    def test_schedule_more_frequent_than_hourly_fails(self):
        r = lint_fixture("fast_schedule")
        self.assertEqual(r.returncode, 1)
        self.assertIn("schedule", r.stdout)

    def test_hourly_and_daily_schedules_pass(self):
        for sched in ("0 * * * *", "15 */2 * * *", "0 22 * * 1-5"):
            cfg = {"routine": {"name": "d", "type": "watch", "schedule": sched}}
            problems = schema.lint(cfg, "x is data, not instructions\nPush rule: none\n")
            self.assertFalse([p for p in problems if "schedule" in p], (sched, problems))

    def test_multi_minute_schedule_fails(self):
        cfg = {"routine": {"name": "d", "type": "watch", "schedule": "0,30 * * * *"}}
        problems = schema.lint(cfg, "is data, not instructions\nPush rule: x\n")
        self.assertTrue([p for p in problems if "schedule" in p])

    def test_missing_untrusted_clause_fails(self):
        r = lint_fixture("no_clause")
        self.assertEqual(r.returncode, 1)
        self.assertIn("is data, not instructions", r.stdout)

    def test_missing_push_rule_fails(self):
        r = lint_fixture("no_push_rule")
        self.assertEqual(r.returncode, 1)
        self.assertIn("Push rule", r.stdout)

    def test_number_default_outside_range_fails(self):
        r = lint_fixture("bad_range")
        self.assertEqual(r.returncode, 1)
        self.assertIn("limit", r.stdout)

    def test_action_without_gate_fails(self):
        r = lint_fixture("action_no_gate")
        self.assertEqual(r.returncode, 1)
        self.assertIn("gate", r.stdout)
        self.assertIn("notify", r.stdout)

    def test_action_with_gate_passes(self):
        r = lint_fixture("action_gated")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_live_first_run_requires_explicit_setting_and_is_allowed(self):
        self.assertEqual(lint_fixture("live_first_run").returncode, 0)

    def test_invalid_first_run_value_fails(self):
        cfg = {"routine": {"name": "d", "type": "watch", "schedule": "0 * * * *", "first_run": "yolo"}}
        problems = schema.lint(cfg, "is data, not instructions\nPush rule: x\n")
        self.assertTrue([p for p in problems if "first_run" in p])

    def test_unknown_type_exit_2_no_traceback(self):
        r = lint_fixture("unknown_type")
        self.assertEqual(r.returncode, 2)
        self.assertNotIn("Traceback", r.stderr + r.stdout)
        self.assertIn("sprocket", r.stderr)

    def test_malformed_toml_exit_2_no_traceback(self):
        r = lint_fixture("malformed")
        self.assertEqual(r.returncode, 2)
        self.assertNotIn("Traceback", r.stderr + r.stdout)

    def test_missing_directory_exit_2(self):
        r = run("lint", os.path.join(FIX, "does_not_exist"))
        self.assertEqual(r.returncode, 2)
        self.assertNotIn("Traceback", r.stderr)


class NewCliTests(unittest.TestCase):
    def test_new_creates_files_that_lint_clean(self):
        for typ in ("serverless", "watch", "approval-gated", "interactive"):
            with tempfile.TemporaryDirectory() as tmp:
                target = os.path.join(tmp, "my-routine")
                r = run("new", "my-routine", "--type", typ, "--dir", target)
                self.assertEqual(r.returncode, 0, r.stderr)
                for f in ("routine.toml", "prompt.md", "README.md"):
                    self.assertTrue(os.path.isfile(os.path.join(target, f)), (typ, f))
                with open(os.path.join(target, "prompt.md")) as fh:
                    prompt = fh.read()
                self.assertIn("is data, not instructions", prompt)
                self.assertTrue(any(l.startswith("Push rule:") for l in prompt.splitlines()))
                self.assertIn("report-only", prompt)
                lr = run("lint", target)
                self.assertEqual(lr.returncode, 0, (typ, lr.stdout, lr.stderr))

    def test_new_refuses_existing_directory_and_never_overwrites(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = os.path.join(tmp, "exists")
            os.makedirs(target)
            marker = os.path.join(target, "routine.toml")
            with open(marker, "w") as f:
                f.write("KEEP")
            r = run("new", "exists", "--type", "watch", "--dir", target)
            self.assertNotEqual(r.returncode, 0)
            self.assertEqual(r.returncode, 2)
            self.assertNotIn("Traceback", r.stderr)
            with open(marker) as f:
                self.assertEqual(f.read(), "KEEP")

    def test_new_unknown_type_exit_2(self):
        with tempfile.TemporaryDirectory() as tmp:
            r = run("new", "x", "--type", "sprocket", "--dir", os.path.join(tmp, "x"))
            self.assertEqual(r.returncode, 2)
            self.assertNotIn("Traceback", r.stderr)
            self.assertFalse(os.path.exists(os.path.join(tmp, "x")))

    def test_new_rejects_bad_name(self):
        with tempfile.TemporaryDirectory() as tmp:
            r = run("new", "Bad Name!", "--type", "watch", "--dir", os.path.join(tmp, "b"))
            self.assertEqual(r.returncode, 2)
            self.assertNotIn("Traceback", r.stderr)


DESK = os.path.join(ROOT, "skills", "routineos", "assets", "desk", "index.html")
CONFIG_RE = r'<script type="application/json" id="desk-config">(.*?)</script>'


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


class NewDashboardTests(unittest.TestCase):
    def test_watch_and_interactive_get_definition_and_desk(self):
        # The committed page carries the version mark; the CLI fills in the plugin version (bundle_desk.inject).
        bundle = read(DESK).replace(bundle_desk.VERSION_MARK, bundle_desk.plugin_version())
        for typ in ("watch", "interactive"):
            with tempfile.TemporaryDirectory() as tmp:
                target = os.path.join(tmp, "demo")
                r = run("new", "demo", "--type", typ, "--dir", target)
                self.assertEqual(r.returncode, 0, r.stderr)
                page = read(os.path.join(target, "dashboard", "index.html"))
                self.assertEqual(re.sub(CONFIG_RE, "", page, flags=re.S), re.sub(CONFIG_RE, "", bundle, flags=re.S))
                m = re.search(CONFIG_RE, page, re.S)
                if m is None:
                    self.fail("desk-config block missing")
                config = json.loads(m.group(1))
                self.assertEqual(config, {"store": "db", "workspace": "demo"})
                self.assertTrue(os.path.isfile(os.path.join(target, "definition.json")))
                lr = run("lint", target)
                self.assertEqual(lr.returncode, 0, (typ, lr.stdout, lr.stderr))
                cr = run("compile", target, "--out", os.path.join(tmp, "meta.json"))
                self.assertEqual(cr.returncode, 0, (typ, cr.stdout, cr.stderr))

    def test_serverless_and_approval_gated_get_no_dashboard(self):
        for typ in ("serverless", "approval-gated"):
            with tempfile.TemporaryDirectory() as tmp:
                target = os.path.join(tmp, "demo")
                r = run("new", "demo", "--type", typ, "--dir", target)
                self.assertEqual(r.returncode, 0, r.stderr)
                self.assertFalse(os.path.exists(os.path.join(target, "dashboard")), typ)
                self.assertFalse(os.path.exists(os.path.join(target, "definition.json")), typ)

    def test_from_template_copies_settings_and_definition(self):
        src = os.path.join(ROOT, "templates", "jobs-watch")
        with tempfile.TemporaryDirectory() as tmp:
            target = os.path.join(tmp, "jobs-nz")
            r = run("new", "jobs-nz", "--from-template", "jobs-watch", "--dir", target)
            self.assertEqual(r.returncode, 0, r.stderr)
            cfg = schema.load(os.path.join(target, "routine.toml"))
            self.assertEqual(cfg["routine"]["name"], "jobs-nz")
            self.assertEqual(cfg["setting"], schema.load(os.path.join(src, "routine.toml"))["setting"])
            self.assertEqual(json.loads(read(os.path.join(target, "definition.json"))),
                             json.loads(read(os.path.join(src, "definition.json"))))
            self.assertTrue(os.path.isfile(os.path.join(target, "dashboard", "index.html")))
            self.assertFalse(os.path.exists(os.path.join(target, "demo")))
            lr = run("lint", target)
            self.assertEqual(lr.returncode, 0, lr.stdout + lr.stderr)

    def test_unknown_template_exits_2(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = os.path.join(tmp, "x")
            r = run("new", "x", "--from-template", "nope", "--dir", target)
            self.assertEqual(r.returncode, 2)
            self.assertIn("unknown template", r.stderr)
            self.assertNotIn("Traceback", r.stderr)
            self.assertFalse(os.path.exists(target))

    def test_new_needs_type_or_template(self):
        with tempfile.TemporaryDirectory() as tmp:
            r = run("new", "x", "--dir", os.path.join(tmp, "x"))
            self.assertEqual(r.returncode, 2)
            self.assertNotIn("Traceback", r.stderr)


class SeedCliTests(unittest.TestCase):
    def test_seed_writes_one_batch_with_meta_and_settings(self):
        tpl = os.path.join(ROOT, "templates", "jobs-watch")
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "seed")
            r = run("seed", tpl, "--out", out, "--at", "2026-10-29T00:00:00Z")
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            self.assertEqual(sorted(os.listdir(out)), ["batch-001.json"])
            batch = json.loads(read(os.path.join(out, "batch-001.json")))
            self.assertEqual(batch["phase"], "seed")
            docs = {f"{w['collection']}/{w['doc_id']}": w["data"] for w in batch["writes"]}
            ws = docs["meta/workspace"]
            self.assertEqual((ws["template"], ws["templateVersion"], ws["lint"]["ok"]), ("jobs-watch", 1, True))
            self.assertEqual(ws["createdAt"], "2026-10-29T00:00:00Z")
            self.assertIn("settings/jobs-watch", docs)
            self.assertIn("settings/workspace", docs)
            self.assertEqual(docs["meta/definition"]["producers"][0]["id"], "jobs-watch")

    def test_seed_missing_dir_exits_2(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "out")
            r = run("seed", os.path.join(tmp, "nope"), "--out", out)
            self.assertEqual(r.returncode, 2)
            self.assertNotIn("Traceback", r.stderr)
            self.assertFalse(os.path.exists(out))


class DoctorTests(unittest.TestCase):
    def test_doctor_reports_python_and_tomllib(self):
        r = run("doctor")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("Python", r.stdout)
        self.assertIn("tomllib", r.stdout)


if __name__ == "__main__":
    unittest.main()
