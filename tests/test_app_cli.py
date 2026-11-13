import datetime
import os
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, "skills", "routineos", "scripts", "routineos.py")
sys.path.insert(0, os.path.dirname(SCRIPT))

import appmodel  # noqa: E402


def run(*args, cwd=None):
    return subprocess.run([sys.executable, SCRIPT, *args], capture_output=True, text=True, cwd=cwd)


def read(path):
    with open(path, "rb") as fh:
        return fh.read()


class AppCliTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.d = self.tmp.name

    def scaffold(self, name="x", typ="serverless"):
        r = run("new", name, "--type", typ, cwd=self.d)
        self.assertEqual(r.returncode, 0, r.stderr)
        return os.path.join(self.d, name)

    def test_v0_folder_lint_output_unchanged(self):
        x = self.scaffold()
        r = run("lint", x)
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout, "ok: no problems\n")

    def test_app_init_creates_three_files_and_lint_flags_missing_prompt_lines(self):
        x = self.scaffold()
        r = run("app-init", x)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("created app.toml", r.stdout)
        for f in ("app.toml", "risks.md", "CHANGELOG.md"):
            self.assertTrue(os.path.getsize(os.path.join(x, f)) > 0, f)
        app = appmodel.load(os.path.join(x, "app.toml"))
        self.assertEqual(app["app"]["status"], "not live")
        self.assertEqual(app["routine"][0]["name"], "x")
        self.assertEqual(app["routine"][0]["schedule"], "0 22 * * 1-5")
        self.assertEqual(app["routine"][0]["type"], "serverless")
        self.assertEqual(appmodel.lint(app), [])
        r = run("lint", x)
        self.assertEqual(r.returncode, 1)
        self.assertIn("FAIL", r.stdout)
        self.assertIn("state/verified", r.stdout)
        self.assertIn("state/budget", r.stdout)

    def test_lint_passes_when_prompt_has_state_lines(self):
        x = self.scaffold()
        run("app-init", x)
        with open(os.path.join(x, "prompt.md"), "a", encoding="utf-8") as fh:
            fh.write("\nRead state/verified. Update state/budget.\n")
        r = run("lint", x)
        self.assertEqual(r.returncode, 0, r.stdout)

    def test_app_init_refuses_to_overwrite(self):
        x = self.scaffold()
        self.assertEqual(run("app-init", x).returncode, 0)
        before = {f: read(os.path.join(x, f)) for f in ("app.toml", "risks.md", "CHANGELOG.md")}
        r = run("app-init", x)
        self.assertEqual(r.returncode, 2)
        self.assertIn("refusing", r.stderr)
        self.assertEqual(before, {f: read(os.path.join(x, f)) for f in before})

    def test_app_init_refuses_when_only_risks_md_exists(self):
        x = self.scaffold()
        p = os.path.join(x, "risks.md")
        with open(p, "w", encoding="utf-8") as fh:
            fh.write("mine\n")
        r = run("app-init", x)
        self.assertEqual(r.returncode, 2)
        self.assertEqual(read(p), b"mine\n")
        self.assertFalse(os.path.exists(os.path.join(x, "app.toml")))
        self.assertFalse(os.path.exists(os.path.join(x, "CHANGELOG.md")))

    def test_app_init_without_routine_toml_exits_2(self):
        r = run("app-init", self.d)
        self.assertEqual(r.returncode, 2)

    def test_lint_fails_on_empty_risks_md(self):
        x = self.scaffold()
        run("app-init", x)
        with open(os.path.join(x, "prompt.md"), "a", encoding="utf-8") as fh:
            fh.write("\nstate/verified\nstate/budget\n")
        open(os.path.join(x, "risks.md"), "w").close()
        r = run("lint", x)
        self.assertEqual(r.returncode, 1)
        self.assertIn("risks.md", r.stdout)

    def test_app_init_budget_matches_schedule(self):
        x = self.scaffold()
        run("app-init", x)
        app = appmodel.load(os.path.join(x, "app.toml"))
        self.assertEqual(app["budget"]["max_runs_per_day"], 1)

    def test_app_init_template_documents_optional_keys(self):
        x = self.scaffold()
        run("app-init", x)
        text = read(os.path.join(x, "app.toml")).decode()
        for key in ("timezone", "alert_channel", "host", "kind"):
            self.assertIn(key, text)
        for ch in (chr(0x2014), chr(0x2013)):
            self.assertNotIn(ch, text)

    def test_new_app_flag_writes_app_files(self):
        r = run("new", "y", "--type", "serverless", "--app", cwd=self.d)
        self.assertEqual(r.returncode, 0, r.stderr)
        y = os.path.join(self.d, "y")
        for f in ("app.toml", "risks.md", "CHANGELOG.md", "routine.toml", "prompt.md"):
            self.assertTrue(os.path.isfile(os.path.join(y, f)), f)
        self.assertTrue(os.path.isdir(os.path.join(y, "lib")))
        self.assertEqual(appmodel.load(os.path.join(y, "app.toml"))["routine"][0]["name"], "y")

    def test_new_with_app_flag_lints_clean(self):
        r = run("new", "z", "--type", "serverless", "--app", cwd=self.d)
        self.assertEqual(r.returncode, 0, r.stderr)
        z = os.path.join(self.d, "z")
        text = read(os.path.join(z, "prompt.md")).decode()
        self.assertIn("state/verified", text)
        self.assertIn("state/budget", text)
        lint = run("lint", z)
        self.assertEqual(lint.returncode, 0, lint.stdout + lint.stderr)

    def test_routine_dirs(self):
        import routineos
        self.assertEqual(routineos.routine_dirs(self.d), [self.d])
        for n in ("b", "a"):
            os.makedirs(os.path.join(self.d, "routines", n))
        open(os.path.join(self.d, "routines", "stray.txt"), "w").close()
        self.assertEqual(routineos.routine_dirs(self.d),
                         [os.path.join(self.d, "routines", "a"), os.path.join(self.d, "routines", "b")])


    def test_end_to_end_synthetic_app(self):
        r = run("new", "demo", "--type", "watch", "--app", cwd=self.d)
        self.assertEqual(r.returncode, 0, r.stderr)
        demo = os.path.join(self.d, "demo")
        self.assertEqual(run("lint", demo).returncode, 0)
        r = run("permissions", demo)
        self.assertEqual(r.returncode, 0, r.stderr)
        for h in ("Apps and hosts", "Connectors", "Schedule", "Environment and secrets",
                  "Store", "Budget", "First run", "Not yet checked"):
            self.assertIn(h, r.stdout)
        for cmd in (("platform", "check", demo), ("doctor", demo)):
            r = run(*cmd)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        path = os.path.join(demo, "app.toml")
        original = read(path).decode()
        live = original.replace('status = "not live"', 'status = "live, not yet tested"')
        self.assertNotEqual(live, original)
        with open(path, "w") as fh:
            fh.write(live)
        r = run("lint", demo)
        self.assertEqual(r.returncode, 1, r.stdout)
        self.assertIn("deployed", r.stdout)
        with open(path, "w") as fh:
            fh.write(live.replace("# [deployed]\n# routine_ids = []", '[deployed]\nroutine_ids = ["trig_example"]'))
        r = run("lint", demo)
        self.assertEqual(r.returncode, 0, r.stdout)

    def _app_with_prompt(self, name="q"):
        r = run("new", name, "--type", "serverless", "--app", cwd=self.d)
        self.assertEqual(r.returncode, 0, r.stderr)
        return os.path.join(self.d, name)

    def test_no_pycache_copied_into_app(self):
        src = os.path.join(os.path.dirname(SCRIPT), "..", "assets", "lib", "__pycache__")
        existed = os.path.isdir(src)
        os.makedirs(src, exist_ok=True)
        stray = os.path.join(src, "zz_test.cpython-313.pyc")
        with open(stray, "wb") as fh:
            fh.write(b"x")
        self.addCleanup(lambda: (os.remove(stray), None if existed else os.rmdir(src)))
        x = self._app_with_prompt("pc")
        self.assertFalse(os.path.exists(os.path.join(x, "lib", "__pycache__")))
        self.assertTrue(os.path.isfile(os.path.join(x, "lib", "budget.py")))

    def test_secret_in_other_files_is_flagged_by_file_and_line_not_value(self):
        value = "sk-" + "a1B2c3D4e5F6g7H8i9J0k1L2"
        x = self._app_with_prompt("sc")
        for rel in ("prompt.md", "routine.toml", os.path.join("lib", "extra.py")):
            path = os.path.join(x, rel)
            with open(path, "a", encoding="utf-8") as fh:
                fh.write(f"\nkey = '{value}'\n")
        r = run("lint", x)
        self.assertEqual(r.returncode, 1)
        for rel in ("prompt.md", "routine.toml", os.path.join("lib", "extra.py")):
            self.assertIn(rel + ":", r.stdout)
        self.assertNotIn(value, r.stdout + r.stderr)
        d = run("doctor", x)
        self.assertEqual(d.returncode, 1)
        self.assertNotIn(value, d.stdout + d.stderr)

    def test_pycache_is_not_scanned(self):
        value = "sk-" + "a1B2c3D4e5F6g7H8i9J0k1L2"
        x = self._app_with_prompt("pcs")
        os.makedirs(os.path.join(x, "lib", "__pycache__"))
        with open(os.path.join(x, "lib", "__pycache__", "a.py"), "w") as fh:
            fh.write(value)
        self.assertEqual(run("lint", x).returncode, 0)

    def test_permissions_refuses_on_secret_and_prints_no_value(self):
        value = "sk-" + "a1B2c3D4e5F6g7H8i9J0k1L2"
        x = self._app_with_prompt("pm")
        path = os.path.join(x, "app.toml")
        text = read(path).decode().replace('# hosts = []', 'hosts = ["%s"]' % value, 1)
        with open(path, "w") as fh:
            fh.write(text)
        r = run("permissions", x)
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(r.stdout, "")
        self.assertNotIn(value, r.stdout + r.stderr)
        self.assertIn("routine[0].hosts[0]", r.stderr)

    def test_permissions_refuses_on_secret_in_prompt(self):
        value = "sk-" + "a1B2c3D4e5F6g7H8i9J0k1L2"
        x = self._app_with_prompt("pm2")
        with open(os.path.join(x, "prompt.md"), "a") as fh:
            fh.write("\n" + value + "\n")
        r = run("permissions", x)
        self.assertNotEqual(r.returncode, 0)
        self.assertNotIn(value, r.stdout + r.stderr)

    def test_lint_flags_schedule_drift_and_fast_app_schedule(self):
        x = self._app_with_prompt("dr")
        path = os.path.join(x, "app.toml")
        text = read(path).decode().replace('schedule = "0 22 * * 1-5"', 'schedule = "*/30 * * * *"')
        self.assertNotEqual(text, read(path).decode())
        with open(path, "w") as fh:
            fh.write(text)
        r = run("lint", x)
        self.assertEqual(r.returncode, 1)
        self.assertIn("differs from routine.toml schedule", r.stdout)
        self.assertIn("1 hour", r.stdout)

    def test_lint_flags_routine_name_drift(self):
        x = self._app_with_prompt("nm")
        path = os.path.join(x, "app.toml")
        text = read(path).decode().replace('[[routine]]\nname = "nm"', '[[routine]]\nname = "other"')
        self.assertNotEqual(text, read(path).decode())
        with open(path, "w") as fh:
            fh.write(text)
        r = run("lint", x)
        self.assertEqual(r.returncode, 1)
        self.assertIn("differs from routine.toml name", r.stdout)

    def test_string_relies_on_and_string_cap_are_errors(self):
        x = self._app_with_prompt("ty")
        path = os.path.join(x, "app.toml")
        text = read(path).decode().replace('# relies_on = []', 'relies_on = "script-writes-store"')
        text = text.replace("max_runs_per_day = 1", 'max_runs_per_day = "four"')
        with open(path, "w") as fh:
            fh.write(text)
        r = run("lint", x)
        self.assertEqual(r.returncode, 1)
        self.assertIn("relies_on must be a list", r.stdout)
        self.assertIn("max_runs_per_day must be a whole number", r.stdout)
        self.assertNotEqual(run("platform", "check", x).returncode, 0)

    def test_template_documents_collection_relies_on_combo_and_utc(self):
        x = self._app_with_prompt("dc")
        text = read(os.path.join(x, "app.toml")).decode()
        for key in ("[[collection]]", "relies_on", "combo", "alert_channel", "UTC"):
            self.assertIn(key, text)
        self.assertEqual(run("lint", x).returncode, 0)

    def test_does_not_own_message_says_how_to_fix(self):
        import appmodel
        app = {"app": {"id": "a", "title": "A", "status": "not live"}, "budget": {"max_runs_per_day": 1},
               "routine": [{"name": "r", "schedule": "0 1 * * *", "writes": ["c"]}]}
        msg = [p for p in appmodel.lint(app) if "does not own" in p][0]
        self.assertIn("[[collection]]", msg)


class PlatformCliTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.d = self.tmp.name

    scaffold = AppCliTests.scaffold

    def reg(self, status="docs-stated", extra=""):
        # checked is today, so the record is never stale however long after this was written the tests run
        path = os.path.join(self.d, "reg.toml")
        with open(path, "w") as fh:
            fh.write('[[capability]]\nid = "cap-a"\nclaim = "c"\nstatus = "%s"\nsource = ["s"]\nchecked = "%s"\ntested = "t"\ndocs = "d"\n%s' % (status, datetime.date.today().isoformat(), extra))
        return path

    def app(self, relies="cap-a", name="x"):
        x = self.scaffold(name)
        run("app-init", x)
        path = os.path.join(x, "app.toml")
        text = read(path).decode().replace('[risks]\nfile = "risks.md"', '[risks]\nfile = "risks.md"\nrelies_on = ["%s"]' % relies)
        with open(path, "w") as fh:
            fh.write(text)
        return x

    def renv(self, path):
        return dict(os.environ, ROUTINEOS_REGISTRY=path)

    def runenv(self, reg, *args):
        import subprocess
        return subprocess.run([sys.executable, SCRIPT, *args], capture_output=True, text=True, env=self.renv(reg))

    def snapshot(self, docs):
        import json
        path = os.path.join(self.d, "snap.json")
        with open(path, "w") as fh:
            json.dump(docs, fh)
        return path

    def sized(self, n):
        import json
        base = len(json.dumps({"k": ""}, sort_keys=True, separators=(",", ":")))
        data = {"k": "a" * (n - base)}
        self.assertEqual(len(json.dumps(data, sort_keys=True, separators=(",", ":"))), n)
        return data

    def test_doctor_without_args_unchanged(self):
        r = run("doctor")
        self.assertEqual(r.returncode, 0)
        self.assertTrue(r.stdout.startswith("Python "))
        self.assertIn("tomllib: ok", r.stdout)
        self.assertEqual(len(r.stdout.splitlines()), 2)

    def test_doctor_docs_limit_boundaries(self):
        ok = self.snapshot({f"d{i}": {"version": 1, "data": {}} for i in range(25000)})
        self.assertEqual(run("doctor", "--docs", ok).returncode, 0)
        bad = self.snapshot({f"d{i}": {"version": 1, "data": {}} for i in range(25001)})
        r = run("doctor", "--docs", bad)
        self.assertEqual(r.returncode, 1)
        self.assertIn("25,000", r.stdout)
        ok = self.snapshot({"big": {"version": 1, "data": self.sized(262144)}})
        self.assertEqual(run("doctor", "--docs", ok).returncode, 0)
        bad = self.snapshot({"big": {"version": 1, "data": self.sized(262145)}})
        r = run("doctor", "--docs", bad)
        self.assertEqual(r.returncode, 1)
        self.assertIn("256 KiB", r.stdout)

    def test_doctor_missing_registry_is_one_line_not_traceback(self):
        r = self.runenv(os.path.join(self.d, "nope.toml"), "doctor", self.app())
        self.assertNotEqual(r.returncode, 0)
        self.assertNotIn("Traceback", r.stderr)
        self.assertEqual(len(r.stderr.strip().splitlines()), 1)

    def test_doctor_app_flags_broken_dependency_and_stray_secret_host(self):
        x = self.app()
        with open(os.path.join(x, "app.toml"), "a") as fh:
            fh.write('\n[[secret]]\nname = "k"\nwhere = "network-secret"\nhost = "api.example.com"\n')
        r = self.runenv(self.reg("broken"), "doctor", x)
        self.assertEqual(r.returncode, 1)
        self.assertIn("'cap-a' is broken", r.stdout)
        self.assertIn("api.example.com", r.stdout)

    def test_platform_check_exits_1_on_broken_dependency(self):
        x = self.app()
        r = self.runenv(self.reg("broken"), "platform", "check", x)
        self.assertEqual(r.returncode, 1)
        self.assertIn("cap-a  broken", r.stdout)
        r = self.runenv(self.reg("docs-stated"), "platform", "check", x)
        self.assertEqual(r.returncode, 0)
        self.assertIn("cap-a  docs-stated", r.stdout)

    def test_platform_check_unknown_id_exits_2_and_stale_printed(self):
        self.assertEqual(self.runenv(self.reg(), "platform", "check", self.app("nope", "n")).returncode, 2)
        path = self.reg()
        r = self.runenv(path, "platform", "check", self.app())
        self.assertNotIn("stale", r.stdout)
        with open(path, "w") as fh:
            fh.write('[[capability]]\nid = "cap-a"\nclaim = "c"\nstatus = "docs-stated"\nsource = ["s"]\nchecked = "2020-01-01"\n')
        r = self.runenv(path, "platform", "check", os.path.join(self.d, "x"))
        self.assertIn("stale: cap-a", r.stdout)

    def test_platform_list_filters_by_status(self):
        path = self.reg()
        with open(path, "a") as fh:
            fh.write('\n[[capability]]\nid = "cap-b"\nclaim = "c"\nstatus = "unverified"\nchecked = "2026-10-29"\n')
        r = self.runenv(path, "platform", "list", "--status", "unverified")
        self.assertEqual(r.stdout.splitlines(), ["cap-b  unverified  2026-10-29"])
        self.assertEqual(len(self.runenv(path, "platform", "list").stdout.splitlines()), 2)

    def set_routine_line(self, x, line):
        path = os.path.join(x, "app.toml")
        text = read(path).decode().replace('# delivery = "repo"', line, 1)
        with open(path, "w") as fh:
            fh.write(text)

    def test_template_documents_delivery_fields_and_lints_unchanged(self):
        x = self.app()
        text = read(os.path.join(x, "app.toml")).decode()
        for field in ('# delivery = "repo"', "# repo =", "# skill ="):
            self.assertIn(field, text)
        app = appmodel.load(os.path.join(x, "app.toml"))
        self.assertNotIn("delivery", app["routine"][0])
        self.assertEqual(appmodel.lint(app), [])

    def test_lint_flags_each_delivery_error_through_the_cli(self):
        for line, want in (('delivery = "pigeon"', "unknown delivery"),
                           ('delivery = "account-skill"', "needs a skill name"),
                           ('delivery = "repo"', "needs a repo")):
            x = self.app(name="d" + str(abs(hash(line)) % 10000))
            self.set_routine_line(x, line)
            with open(os.path.join(x, "prompt.md"), "a") as fh:
                fh.write("\nstate/verified state/budget\n")
            r = run("lint", x)
            self.assertEqual(r.returncode, 1, line)
            self.assertIn(want, r.stdout)

    def test_lint_flags_bad_uploaded_skill_frontmatter_through_the_cli(self):
        x = self.app()
        self.set_routine_line(x, 'delivery = "account-skill"\nskill = "scan"')
        with open(os.path.join(x, "prompt.md"), "a") as fh:
            fh.write("\nstate/verified state/budget\n")
        os.makedirs(os.path.join(x, "skills", "scan"))
        with open(os.path.join(x, "skills", "scan", "SKILL.md"), "w") as fh:
            fh.write("---\nname: scan\ndescription: d\nargument-hint: x\n---\n")
        r = run("lint", x)
        self.assertEqual(r.returncode, 1)
        self.assertIn("argument-hint", r.stdout)

    def test_permissions_shows_delivery_and_repo_less_item(self):
        x = self.app()
        self.set_routine_line(x, 'delivery = "inline"')
        r = self.runenv(self.reg(), "permissions", x)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("inline prompt", r.stdout)
        self.assertIn("repo-less-routine: unverified", r.stdout)
        r = run("permissions", x)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn("repo-less-routine", r.stdout.split("Not yet checked")[1])

    def test_doctor_reports_delivery_per_routine_and_flags_repo_less(self):
        x = self.app()
        r = self.runenv(self.reg(), "doctor", x)
        self.assertIn("delivery: x: repo\n", r.stdout)
        self.assertNotIn("repo-less-routine", r.stdout)
        self.set_routine_line(x, 'delivery = "account-skill"\nskill = "scan"')
        r = self.runenv(self.reg(), "doctor", x)
        self.assertIn("delivery: x: account skill scan (unverified: repo-less-routine", r.stdout)
        r = run("doctor", x)
        self.assertIn("delivery: x: account skill scan\n", r.stdout)

    def test_doctor_drops_the_flag_once_tested(self):
        x = self.app()
        self.set_routine_line(x, 'delivery = "inline"')
        path = os.path.join(x, "app.toml")
        text = read(path).decode().replace('status = "not live"', 'status = "live and tested"').replace(
            "# routine_ids = []", "routine_ids = []").replace("# [deployed]", "[deployed]")
        text = text.replace("[deployed]\nroutine_ids = []", '[deployed]\nroutine_ids = ["trig_1"]')
        with open(path, "w") as fh:
            fh.write(text)
        r = run("doctor", x)
        self.assertIn("delivery: x: inline prompt\n", r.stdout)
        self.assertNotIn("unverified: repo-less-routine", r.stdout)

    def test_permissions_prints_sections(self):
        x = self.app()
        r = self.runenv(self.reg(), "permissions", x)
        self.assertEqual(r.returncode, 0, r.stderr)
        for h in ("Apps and hosts", "Schedule", "Store", "Budget", "Not yet checked"):
            self.assertIn(h, r.stdout)
        self.assertEqual(run("permissions", self.d).returncode, 2)

    def test_lint_multi_routine_layout_without_root_routine_toml(self):
        x = self.scaffold("m")
        sub = os.path.join(x, "routines")
        os.makedirs(sub)
        os.rename(os.path.join(x, "routine.toml"), os.path.join(sub, "routine.toml.tmp"))
        os.makedirs(os.path.join(sub, "a"))
        os.rename(os.path.join(sub, "routine.toml.tmp"), os.path.join(sub, "a", "routine.toml"))
        os.rename(os.path.join(x, "prompt.md"), os.path.join(sub, "a", "prompt.md"))
        r = run("lint", x)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main()
