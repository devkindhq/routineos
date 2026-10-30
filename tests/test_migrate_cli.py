"""routineos migrate through the CLI: every fixture converts, validates, installs and lints. No network."""
import contextlib
import glob
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

from pack_fixtures import CLI

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURES = os.path.join(ROOT, "tests", "fixtures", "migrate")
N8N = sorted(glob.glob(os.path.join(FIXTURES, "n8n", "*.json")))
WINDMILL = sorted(glob.glob(os.path.join(FIXTURES, "windmill", "*.json")))
CONCEPTS = os.path.join(ROOT, "skills", "routineos", "registry", "migrate-concepts.json")


def run(*args):
    return subprocess.run([sys.executable, CLI, *args], capture_output=True, text=True)


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def needs_wheres(plan_json):
    return [x["where"] for x in plan_json.get("issues", []) if x["level"] in ("needs-person", "unmapped")
            and x.get("where")]


class MigrateCliTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def out(self, name="out"):
        return os.path.join(self.d, name)

    def test_fixtures_are_present(self):
        self.assertGreaterEqual(len(N8N), 8)
        self.assertGreaterEqual(len(WINDMILL), 2)

    def check_fixture(self, tool, path):
        name = os.path.basename(path)
        out = self.out(name)
        res = run("migrate", tool, path, "--out", out)
        self.assertIn(res.returncode, (0, 1), f"{name}: {res.stdout}{res.stderr}")
        self.assertEqual(sorted(os.listdir(out)), ["MIGRATION.md", "pack.json"], name)
        pack_path = os.path.join(out, "pack.json")
        val = run("pack", "validate", pack_path)
        self.assertEqual(val.returncode, 0, f"{name}: {val.stdout}{val.stderr}")
        target = os.path.join(self.d, "ws-" + name)
        inst = run("pack", "install", pack_path, "--dir", target)
        self.assertEqual(inst.returncode, 0, f"{name}: {inst.stdout}{inst.stderr}")
        lint = run("lint", target)
        self.assertEqual(lint.returncode, 0, f"{name}: {lint.stdout}{lint.stderr}")
        plan = run("migrate", "plan", tool, path)
        self.assertEqual(plan.returncode, 0, plan.stderr)
        report = read(os.path.join(out, "MIGRATION.md"))
        wheres = needs_wheres(json.loads(plan.stdout))
        for where in wheres:
            self.assertIn(where, report, f"{name}: MIGRATION.md does not name {where}")
        section = report.split("## Needs a person", 1)[1].split("\n## ", 1)[0]
        has_needs = any(line.startswith("- ") for line in section.splitlines())
        self.assertEqual(res.returncode, 1 if has_needs else 0, name)
        if wheres:
            self.assertEqual(res.returncode, 1, name)
            self.assertIn("need a person", res.stderr)
        return res

    def test_every_n8n_fixture_converts_installs_and_lints(self):
        for path in N8N:
            with self.subTest(fixture=os.path.basename(path)):
                self.check_fixture("n8n", path)

    def test_every_windmill_fixture_converts_installs_and_lints(self):
        for path in WINDMILL:
            with self.subTest(fixture=os.path.basename(path)):
                self.check_fixture("windmill", path)

    def test_exit_zero_when_nothing_needs_a_person(self):
        res = run("migrate", "n8n", os.path.join(FIXTURES, "n8n", "control-flow.json"), "--out", self.out())
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
        self.assertEqual(res.stderr, "")
        self.assertIn(self.out(), res.stdout)

    def test_exit_one_when_a_person_is_needed(self):
        res = run("migrate", "n8n", os.path.join(FIXTURES, "n8n", "webhook-code-respond.json"), "--out", self.out())
        self.assertEqual(res.returncode, 1)
        self.assertIn("need a person", res.stderr)
        self.assertTrue(os.path.isfile(os.path.join(self.out(), "pack.json")))

    def test_id_overrides_the_plan_id(self):
        res = run("migrate", "n8n", os.path.join(FIXTURES, "n8n", "control-flow.json"), "--out", self.out(),
                  "--id", "my-routine")
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertEqual(json.loads(read(os.path.join(self.out(), "pack.json")))["id"], "my-routine")
        bad = run("migrate", "n8n", os.path.join(FIXTURES, "n8n", "control-flow.json"), "--out", self.out("b"),
                  "--id", "Bad Id")
        self.assertEqual(bad.returncode, 2)
        self.assertFalse(os.path.exists(self.out("b")))

    def test_non_empty_out_is_refused_and_left_alone(self):
        os.makedirs(self.out())
        keep = os.path.join(self.out(), "keep.txt")
        with open(keep, "w", encoding="utf-8") as fh:
            fh.write("mine")
        res = run("migrate", "n8n", os.path.join(FIXTURES, "n8n", "control-flow.json"), "--out", self.out())
        self.assertEqual(res.returncode, 2)
        self.assertIn("refusing to overwrite", res.stderr)
        self.assertEqual(os.listdir(self.out()), ["keep.txt"])
        self.assertEqual(read(keep), "mine")

    def test_empty_out_folder_is_accepted(self):
        os.makedirs(self.out())
        res = run("migrate", "n8n", os.path.join(FIXTURES, "n8n", "control-flow.json"), "--out", self.out())
        self.assertEqual(res.returncode, 0, res.stderr)

    def test_plan_then_steps_gives_identical_pack_bytes(self):
        for tool, path in [("n8n", p) for p in N8N] + [("windmill", p) for p in WINDMILL]:
            with self.subTest(fixture=os.path.basename(path)):
                name = os.path.basename(path)
                plan_file = os.path.join(self.d, name + ".plan.json")
                res = run("migrate", "plan", tool, path, "--out", plan_file)
                self.assertEqual(res.returncode, 0, res.stderr)
                self.assertEqual(json.loads(read(plan_file))["format"], "routineos.migration.v1")
                a, b = self.out("a-" + name), self.out("b-" + name)
                run("migrate", tool, path, "--out", a)
                res = run("migrate", "steps", plan_file, "--out", b)
                self.assertIn(res.returncode, (0, 1), res.stdout + res.stderr)
                for f in ("pack.json", "MIGRATION.md"):
                    with open(os.path.join(a, f), "rb") as fa, open(os.path.join(b, f), "rb") as fb:
                        self.assertEqual(fa.read(), fb.read(), f"{name} {f}")

    def plan_of(self, tool="n8n", name="control-flow.json", *flags):
        path = os.path.join(FIXTURES, tool, name)
        res = run("migrate", "plan", tool, path, *flags)
        self.assertEqual(res.returncode, 0, res.stderr)
        return json.loads(res.stdout)

    def test_local_sources_are_untrusted_by_default(self):
        for tool, name in (("n8n", "control-flow.json"), ("windmill", "minimal.json")):
            with self.subTest(tool=tool):
                self.assertIs(self.plan_of(tool, name)["source"].get("untrusted"), True)
                res = run("migrate", tool, os.path.join(FIXTURES, tool, name), "--out", self.out(tool))
                self.assertIn(res.returncode, (0, 1), res.stderr)
                self.assertIn("Read before you install", read(os.path.join(self.out(tool), "MIGRATION.md")))

    def test_trusted_opts_out_for_n8n_and_windmill(self):
        for tool, name in (("n8n", "control-flow.json"), ("windmill", "minimal.json")):
            with self.subTest(tool=tool):
                self.assertFalse(self.plan_of(tool, name, "--trusted")["source"].get("untrusted"))
                res = run("migrate", tool, os.path.join(FIXTURES, tool, name), "--out", self.out(tool), "--trusted")
                self.assertIn(res.returncode, (0, 1), res.stderr)
                self.assertNotIn("Read before you install", read(os.path.join(self.out(tool), "MIGRATION.md")))

    def test_steps_is_untrusted_unless_trusted(self):
        plan = self.plan_of("n8n", "control-flow.json", "--trusted")
        plan_file = os.path.join(self.d, "p.json")
        with open(plan_file, "w", encoding="utf-8") as fh:
            json.dump(plan, fh)
        res = run("migrate", "steps", plan_file, "--out", self.out("a"))
        self.assertIn(res.returncode, (0, 1), res.stderr)
        self.assertIn("Read before you install", read(os.path.join(self.out("a"), "MIGRATION.md")))
        res = run("migrate", "steps", plan_file, "--out", self.out("b"), "--trusted")
        self.assertIn(res.returncode, (0, 1), res.stderr)
        self.assertNotIn("Read before you install", read(os.path.join(self.out("b"), "MIGRATION.md")))

    def test_trusted_clears_an_untrusted_plan_in_steps(self):
        plan_file = os.path.join(self.d, "p.json")
        run("migrate", "plan", "n8n", os.path.join(FIXTURES, "n8n", "control-flow.json"), "--out", plan_file)
        self.assertIs(json.loads(read(plan_file))["source"]["untrusted"], True)
        res = run("migrate", "steps", plan_file, "--out", self.out(), "--trusted")
        self.assertIn(res.returncode, (0, 1), res.stderr)
        self.assertNotIn("Read before you install", read(os.path.join(self.out(), "MIGRATION.md")))

    def test_trusted_is_refused_for_a_url(self):
        res = run("migrate", "n8n", "https://example.invalid/wf.json", "--out", self.out(), "--trusted")
        self.assertEqual(res.returncode, 2)
        self.assertIn("trusted", res.stderr)
        self.assertFalse(os.path.exists(self.out()))

    def test_fetch_has_no_trusted_flag(self):
        res = run("migrate", "fetch", "123", "--out", self.out(), "--trusted")
        self.assertEqual(res.returncode, 2)

    def steps_exit(self, *issues, out="out"):
        plan = self.plan_of("n8n", "control-flow.json")
        plan["issues"] = list(issues)
        plan_file = os.path.join(self.d, "issues.json")
        with open(plan_file, "w", encoding="utf-8") as fh:
            json.dump(plan, fh)
        return run("migrate", "steps", plan_file, "--out", self.out(out))

    def test_exit_code_follows_issue_levels_not_report_text(self):
        res = self.steps_exit({"level": "setup", "where": "credentials", "message": "Connect the account."},
                              {"level": "info", "where": "settings", "message": "A note."},
                              {"level": "unverified", "where": "settings", "message": "Check this."})
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
        self.assertEqual(res.stderr, "")
        res = self.steps_exit({"level": "needs-person", "where": "settings", "message": "Decide this."}, out="two")
        self.assertEqual(res.returncode, 1)
        self.assertIn("1 issues need a person", res.stderr)

    def test_unmapped_issue_exits_one(self):
        res = self.steps_exit({"level": "unmapped", "where": "settings", "message": "Nothing matches."})
        self.assertEqual(res.returncode, 1)

    def test_plan_out_refuses_an_existing_file(self):
        target = os.path.join(self.d, "plan.json")
        with open(target, "w", encoding="utf-8") as fh:
            fh.write("keep me")
        res = run("migrate", "plan", "n8n", os.path.join(FIXTURES, "n8n", "control-flow.json"), "--out", target)
        self.assertEqual(res.returncode, 2)
        self.assertIn("already exists", res.stderr)
        self.assertEqual(read(target), "keep me")
        res = run("migrate", "plan", "n8n", os.path.join(FIXTURES, "n8n", "control-flow.json"), "--out", target,
                  "--force")
        self.assertEqual(res.returncode, 2)

    def test_plan_prints_to_stdout_without_writing(self):
        res = run("migrate", "plan", "n8n", os.path.join(FIXTURES, "n8n", "control-flow.json"))
        self.assertEqual(res.returncode, 0)
        self.assertEqual(json.loads(res.stdout)["format"], "routineos.migration.v1")

    def test_steps_refuses_a_bad_plan(self):
        bad = os.path.join(self.d, "bad.json")
        with open(bad, "w", encoding="utf-8") as fh:
            json.dump({"format": "routineos.migration.v1", "steps": "x"}, fh)
        res = run("migrate", "steps", bad, "--out", self.out())
        self.assertEqual(res.returncode, 2)
        self.assertFalse(os.path.exists(self.out()))
        notjson = os.path.join(self.d, "notjson.json")
        with open(notjson, "w", encoding="utf-8") as fh:
            fh.write("{nope")
        self.assertEqual(run("migrate", "steps", notjson, "--out", self.out()).returncode, 2)

    def test_windmill_yaml_is_refused(self):
        yml = os.path.join(self.d, "flow.yaml")
        with open(yml, "w", encoding="utf-8") as fh:
            fh.write("summary: A flow\nvalue:\n  modules: []\n")
        res = run("migrate", "windmill", yml, "--out", self.out())
        self.assertEqual(res.returncode, 2)
        self.assertIn("YAML", res.stderr)
        self.assertFalse(os.path.exists(self.out()))

    def test_missing_file_and_non_https_url_are_exit_two(self):
        res = run("migrate", "n8n", os.path.join(self.d, "missing.json"), "--out", self.out())
        self.assertEqual(res.returncode, 2)
        res = run("migrate", "n8n", "http://example.org/w.json", "--out", self.out())
        self.assertEqual(res.returncode, 2)
        self.assertIn("https", res.stderr)
        self.assertFalse(os.path.exists(self.out()))
        res = run("migrate", "windmill", "https://example.org/f.json", "--out", self.out())
        self.assertEqual(res.returncode, 2)

    def test_oversized_source_is_refused(self):
        big = os.path.join(self.d, "big.json")
        with open(big, "w", encoding="utf-8") as fh:
            fh.write(" " * (2 * 1024 * 1024 + 1))
        res = run("migrate", "n8n", big, "--out", self.out())
        self.assertEqual(res.returncode, 2)
        self.assertIn("limit", res.stderr)

    def test_fetch_refuses_a_non_numeric_id_without_network(self):
        res = run("migrate", "fetch", "abc", "--out", self.out())
        self.assertEqual(res.returncode, 2)
        self.assertIn("digits", res.stderr)
        self.assertFalse(os.path.exists(self.out()))

    def test_search_refuses_an_empty_query_without_network(self):
        self.assertEqual(run("migrate", "search", "  ").returncode, 2)

    def test_concepts_json_lists_every_concept(self):
        res = run("migrate", "concepts", "--json")
        self.assertEqual(res.returncode, 0, res.stderr)
        data = json.loads(res.stdout)
        ids = {c["id"] for c in data["concepts"]}
        self.assertEqual(ids, {c["id"] for c in json.loads(read(CONCEPTS))["concepts"]})
        self.assertIn("step.code", ids)
        plain = run("migrate", "concepts")
        self.assertEqual(plain.returncode, 0)
        for cid in ids:
            self.assertIn(cid, plain.stdout)

    def test_help_names_every_subcommand(self):
        res = run("migrate", "--help")
        self.assertEqual(res.returncode, 0)
        for word in ("n8n", "windmill", "steps", "plan", "search", "fetch", "concepts"):
            self.assertIn(word, res.stdout)


if __name__ == "__main__":
    unittest.main()


sys.path.insert(0, os.path.dirname(CLI))
import routineos  # noqa: E402
import migrate_n8n  # noqa: E402
import migrate_windmill  # noqa: E402


class InternalErrorBackstop(unittest.TestCase):
    def call(self, *argv):
        err, out = io.StringIO(), io.StringIO()
        with contextlib.redirect_stderr(err), contextlib.redirect_stdout(out):
            code = routineos.main(list(argv))
        return code, err.getvalue()

    def test_a_parser_crash_is_exit_two_without_a_traceback(self):
        with tempfile.TemporaryDirectory() as d:
            for tool, mod, name in (("n8n", migrate_n8n, "control-flow.json"),
                                    ("windmill", migrate_windmill, "minimal.json")):
                with self.subTest(tool=tool), mock.patch.object(mod, "parse", side_effect=TypeError("boom")):
                    out = os.path.join(d, tool)
                    code, err = self.call("migrate", tool, os.path.join(FIXTURES, tool, name), "--out", out)
                    self.assertEqual(code, 2)
                    self.assertEqual(err.strip(), "error: this workflow could not be converted "
                                                  "(internal error: TypeError)")
                    self.assertNotIn("Traceback", err)
                    self.assertNotIn("boom", err)
                    self.assertFalse(os.path.exists(out))

    def test_plan_also_has_the_backstop(self):
        with mock.patch.object(migrate_n8n, "parse", side_effect=KeyError("k")):
            code, err = self.call("migrate", "plan", "n8n", os.path.join(FIXTURES, "n8n", "control-flow.json"))
        self.assertEqual(code, 2)
        self.assertIn("internal error: KeyError", err)


class UrlShown(unittest.TestCase):
    def test_scheme_host_and_a_short_path_are_kept(self):
        self.assertEqual(routineos._migrate_url_shown("https://example.com/flows/daily.json?x=1#f"),
                         "https://example.com/flows/daily.json")

    def test_user_info_is_dropped(self):
        self.assertEqual(routineos._migrate_url_shown("https://user:pw" + chr(64) + "example.com/a"), "https://example.com/a")

    def test_a_token_like_segment_drops_the_whole_path(self):
        tok = "abcdefghij0123456789"
        self.assertEqual(len(tok), 20)
        for path in (f"/hook/{tok}/flow.json", f"/{tok}", "/x/" + "A_b-" * 6):
            with self.subTest(path=path):
                self.assertEqual(routineos._migrate_url_shown("https://example.com" + path), "https://example.com")

    def test_nineteen_characters_is_kept(self):
        self.assertEqual(routineos._migrate_url_shown("https://example.com/" + "a" * 19), "https://example.com/" + "a" * 19)

    def test_secret_shaped_values_in_the_path_are_cleaned(self):
        shown = routineos._migrate_url_shown("https://example.com/a/me" + chr(64) + "example.org/f")
        self.assertNotIn("example.org", shown)
        self.assertIn("[removed]", shown)
