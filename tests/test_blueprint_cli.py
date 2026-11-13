import json
import os
import pty
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, "skills", "routineos", "scripts", "routineos.py")
sys.path.insert(0, os.path.dirname(SCRIPT))

import blueprint  # noqa: E402

FIX = os.path.join(ROOT, "tests", "fixtures", "blueprint")
AUTH = os.path.join(FIX, "authored")
BASELINE = os.path.join(FIX, "lint_baseline.json")


def run(*args, cwd=ROOT, stdin=None):
    return subprocess.run([sys.executable, SCRIPT, *args], capture_output=True, text=True, cwd=cwd, stdin=stdin)


def read(path):
    with open(path, "rb") as fh:
        return fh.read()


def snapshot(d):
    out = {}
    for base, _, files in os.walk(d):
        for f in files:
            p = os.path.join(base, f)
            out[os.path.relpath(p, d)] = read(p)
    return out


def run_tty(args, typed):
    """Run the CLI with stdin and stdout on a pseudo terminal, typing the given text. Returns (code, terminal output)."""
    master, slave = pty.openpty()
    proc = subprocess.Popen([sys.executable, SCRIPT, *args], stdin=slave, stdout=slave, stderr=subprocess.PIPE, cwd=ROOT, text=True)
    os.close(slave)
    chunks = []

    def pump():
        try:
            while True:
                data = os.read(master, 4096)
                if not data:
                    break
                chunks.append(data)
        except OSError:
            pass

    reader = threading.Thread(target=pump, daemon=True)
    reader.start()
    os.write(master, typed.encode())
    _, err = proc.communicate(timeout=60)
    reader.join(5)
    os.close(master)
    return proc.returncode, b"".join(chunks).decode(errors="replace"), err


class Base(unittest.TestCase):
    def copy(self, src=AUTH):
        t = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, t, True)
        d = os.path.join(t, "x")
        shutil.copytree(src, d)
        return d


class SummaryTests(Base):
    def test_summary_golden(self):
        r = run("blueprint", AUTH)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout, read(os.path.join(AUTH, "summary.golden.txt")).decode())

    def test_summary_exit_0_with_gaps(self):
        d = self.copy()
        with open(os.path.join(d, "routine.toml"), "a", encoding="utf-8") as fh:
            fh.write('\n[[requirement]]\nid = "orphan"\ntext = "Nothing serves this"\nserved_by = []\n')
        r = run("blueprint", d)
        self.assertEqual(r.returncode, 0)
        self.assertIn("orphan: GAP", r.stdout)
        self.assertIn("fresh: covered", r.stdout)

    def test_json_is_graph(self):
        r = run("blueprint", AUTH, "--json")
        self.assertEqual(r.returncode, 0)
        g = json.loads(r.stdout)
        self.assertEqual(g["format"], "routineos.blueprint.v1")
        for n in g["nodes"]:
            for k in ("x", "y", "position"):
                self.assertNotIn(k, n)

    def test_json_for_template_matches_golden(self):
        r = run("blueprint", "templates/watch", "--json")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout, read(os.path.join(FIX, "golden", "watch.graph.json")).decode())

    def test_folder_named_approve_is_a_dir(self):
        t = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, t, True)
        shutil.copytree(AUTH, os.path.join(t, "approve"))
        r = run("blueprint", "./approve", cwd=t)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("Blueprint: authored", r.stdout)

    def test_bad_first_word_exits_2(self):
        r = run("blueprint", "bogus", AUTH)
        self.assertEqual(r.returncode, 2)


class ApproveTests(Base):
    def test_approve_without_tty_refuses_and_writes_nothing(self):
        d = self.copy()
        before = snapshot(d)
        r = run("blueprint", "approve", d, stdin=subprocess.DEVNULL)
        self.assertEqual(r.returncode, 2)
        self.assertIn("needs an interactive terminal", r.stderr)
        self.assertIn("! routineos blueprint approve", r.stderr)
        self.assertEqual(snapshot(d), before)

    def test_approve_with_tty_records(self):
        d = self.copy()
        code, out, err = run_tty(["blueprint", "approve", d], "Ada\napprove\n")
        self.assertEqual(code, 0, out + err)
        text = read(os.path.join(d, "routine.toml")).decode()
        self.assertIn("[approval]", text)
        self.assertIn("version = 1\n", text)
        self.assertIn('approved_by = "Ada"', text)
        self.assertIn(f'date = "{datetime.date.today().isoformat()}"', text)
        self.assertIn(f'hash = "{blueprint.graph_hash(blueprint.derive(d))}"', text)

    def test_approve_wrong_word_aborts(self):
        d = self.copy()
        before = snapshot(d)
        code, out, err = run_tty(["blueprint", "approve", d], "Ada\nyes\n")
        self.assertEqual(code, 1, out + err)
        self.assertEqual(snapshot(d), before)

    def test_approve_preserves_other_bytes(self):
        d = self.copy()
        path = os.path.join(d, "routine.toml")
        orig = read(path).decode()
        orig = "# kept comment\n\n" + orig
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(orig)
        self.assertTrue(orig.endswith("\n"))
        code, out, err = run_tty(["blueprint", "approve", d], "Ada\napprove\n")
        self.assertEqual(code, 0, out + err)
        first = read(path).decode()
        h = blueprint.graph_hash(blueprint.derive(d))
        block = blueprint.approval_block(1, datetime.date.today().isoformat(), h, "Ada")
        self.assertEqual(first, orig + "\n" + block)
        code, out, err = run_tty(["blueprint", "approve", d], "Grace\napprove\n")
        self.assertEqual(code, 0, out + err)
        second = read(path).decode()
        self.assertEqual(second, orig + "\n" + blueprint.approval_block(2, datetime.date.today().isoformat(), h, "Grace"))

    def test_write_approval_keeps_tables_after_the_approval(self):
        d = self.copy()
        path = os.path.join(d, "routine.toml")
        with open(path, "a", encoding="utf-8") as fh:
            fh.write('\n[approval]\nversion = 1\ndate = "2020-01-01"\nhash = "sha256:old"\napproved_by = "X"\n\n[extra]\nk = 1\n')
        blueprint.write_approval(path, blueprint.approval_block(2, "2026-11-13", "sha256:new", "Y"))
        text = read(path).decode()
        self.assertIn('hash = "sha256:new"\napproved_by = "Y"\n\n[extra]\nk = 1\n', text)
        self.assertEqual(text.count("[approval]"), 1)
        self.assertNotIn("sha256:old", text)

    def test_approve_app_writes_to_app_toml(self):
        d = self.copy(os.path.join(FIX, "app_authored"))
        code, out, err = run_tty(["blueprint", "approve", d], "Ada\napprove\n")
        self.assertEqual(code, 0, out + err)
        self.assertIn("[approval]", read(os.path.join(d, "app.toml")).decode())
        self.assertNotIn("[approval]", read(os.path.join(d, "routines", "one", "routine.toml")).decode())


class RedactionAndFileTests(Base):
    def test_secret_like_text_is_redacted_in_all_three_outputs(self):
        d = self.copy()
        value = "sk-" + "a1B2c3D4e5F6g7H8i9J0k1L2"
        path = os.path.join(d, "routine.toml")
        text = read(path).decode().replace("Pages are checked every morning", f"Pages use {value}").replace("Build the Worker.", f"Use {value}")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text)
        self.assertNotIn(value, run("blueprint", d, "--json").stdout)
        self.assertIn("[redacted]", run("blueprint", d, "--json").stdout)
        self.assertNotIn(value, run("blueprint", d).stdout)
        code, out, err = run_tty(["blueprint", "approve", d], "Ada\nno\n")
        self.assertEqual(code, 1)
        self.assertNotIn(value, out)
        self.assertIn("approving", out)

    def test_app_approval_never_overwrites_a_routine_approval(self):
        d = self.copy(os.path.join(FIX, "app_authored"))
        rt = os.path.join(d, "routines", "one", "routine.toml")
        with open(rt, "a", encoding="utf-8") as fh:
            fh.write('\n[approval]\nversion = 1\ndate = "2020-01-01"\nhash = "sha256:old"\napproved_by = "X"\n')
        code, out, err = run_tty(["blueprint", "approve", d], "Ada\napprove\n")
        self.assertEqual(code, 0, out + err)
        # an app's approval lives in app.toml; a routine's own approval is left alone
        self.assertIn('approved_by = "Ada"', read(os.path.join(d, "app.toml")).decode())
        self.assertIn("sha256:old", read(rt).decode())

    def test_write_approval_header_spacing(self):
        t = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, t, True)
        path = os.path.join(t, "a.toml")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write('[x]\na = 1\n\n[ approval ]\nversion = 1\n\n[approval_x]\nb = 2\n[[approvals]]\nc = 3\n')
        blueprint.write_approval(path, blueprint.approval_block(2, "2026-11-13", "sha256:n", "Y"))
        text = read(path).decode()
        self.assertNotIn("[ approval ]", text)
        self.assertEqual(text.count("[approval]\n"), 1)
        self.assertIn("[approval_x]\nb = 2\n[[approvals]]\nc = 3\n", text)
        self.assertIn("approved_by = \"Y\"\n\n[approval_x]", text)
        # a file that is not valid TOML (here [approval] and [[approval]] together) is refused and left as it is
        bad = '[approval]\nversion = 1\n[[approval]]\nc = 3\n'
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(bad)
        with self.assertRaises(blueprint.BlueprintError):
            blueprint.write_approval(path, blueprint.approval_block(2, "2026-11-13", "sha256:n", "Y"))
        self.assertEqual(read(path).decode(), bad)


class CheckTests(Base):
    def approve(self, d):
        code, out, err = run_tty(["blueprint", "approve", d], "Ada\napprove\n")
        self.assertEqual(code, 0, out + err)

    def test_check_matches_then_drifts(self):
        d = self.copy()
        self.approve(d)
        r = run("blueprint", "check", d)
        self.assertEqual(r.returncode, 0)
        self.assertIn("matches", r.stdout)
        path = os.path.join(d, "routine.toml")
        text = read(path).decode()
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text.replace('needs = "Build the Worker."', 'needs = "Build it soon."'))
        r = run("blueprint", "check", d)
        self.assertEqual(r.returncode, 0, r.stdout)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text.replace("Pages are checked every morning", "Pages are checked every evening"))
        r = run("blueprint", "check", d)
        self.assertEqual(r.returncode, 1)
        self.assertIn("drift", r.stdout)

    def test_check_without_approval_exits_1(self):
        r = run("blueprint", "check", AUTH)
        self.assertEqual(r.returncode, 1)
        self.assertIn("not approved", r.stdout)


class LintAndPermissionTests(Base):
    def test_lint_output_unchanged_for_every_template(self):
        with open(BASELINE, encoding="utf-8") as fh:
            base = json.load(fh)
        names = sorted(n for n in base if not n.startswith("_"))
        self.assertEqual(names, sorted(os.listdir(os.path.join(ROOT, "templates"))))
        for name in names:
            with self.subTest(template=name):
                r = run("lint", f"templates/{name}")
                self.assertEqual((r.stdout, r.returncode), (base[name]["stdout"], base[name]["code"]))

    def test_lint_warns_but_keeps_exit(self):
        r = run("lint", AUTH)
        self.assertEqual(r.returncode, 0)
        lines = r.stdout.splitlines()
        self.assertTrue(lines[0].startswith("WARN blueprint: "), r.stdout)
        self.assertEqual(lines[-1], "ok: no problems")
        self.assertFalse(any(ln.startswith("FAIL") for ln in lines))

    def test_lint_fail_lines_come_before_warn_lines(self):
        r = run("lint", os.path.join(FIX, "app_authored"))
        self.assertEqual(r.returncode, 1)
        kinds = [ln.split(" ", 1)[0] for ln in r.stdout.splitlines()]
        self.assertIn("FAIL", kinds)
        self.assertIn("WARN", kinds)
        self.assertLess(max(i for i, k in enumerate(kinds) if k == "FAIL"), min(i for i, k in enumerate(kinds) if k == "WARN"))
        self.assertNotIn("ok: no problems", r.stdout)

    def test_app_warnings_once_for_multi_routine_app(self):
        d = self.copy(os.path.join(FIX, "app_authored"))
        two = os.path.join(d, "routines", "two")
        shutil.copytree(os.path.join(d, "routines", "one"), two)
        with open(os.path.join(two, "routine.toml"), encoding="utf-8") as fh:
            body = fh.read()
        with open(os.path.join(two, "routine.toml"), "w", encoding="utf-8") as fh:
            fh.write(body.replace('name = "one"', 'name = "two"'))
        r = run("lint", d)
        self.assertEqual(r.stdout.count("requirement 'no-spam'"), 1, r.stdout)

    def test_permissions_unchanged_without_blueprint(self):
        with open(BASELINE, encoding="utf-8") as fh:
            base = json.load(fh)["_permissions_app_plain"]
        r = run("permissions", os.path.join(FIX, "app_plain"))
        self.assertEqual((r.stdout, r.returncode), (base["stdout"], base["code"]))

    def test_permissions_section_golden(self):
        d = os.path.join(FIX, "app_authored")
        r = run("permissions", d)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout, read(os.path.join(d, "permissions.golden.txt")).decode())
        self.assertIn("\n\nBlueprint\n", r.stdout)


if __name__ == "__main__":
    unittest.main()
