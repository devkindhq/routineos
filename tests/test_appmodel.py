import copy
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "skills", "routineos", "scripts"))

import appmodel  # noqa: E402


def valid():
    return {
        "app": {"id": "inbox-watch", "title": "Inbox watch", "status": "not live"},
        "routine": [
            {
                "name": "scan",
                "connectors": ["gmail"],
                "hosts": ["api.example.com"],
                "writes": ["reports"],
            }
        ],
        "collection": [{"name": "reports", "writer": "scan"}],
        "integration": [
            {"name": "gmail", "direction": "read", "gate": False, "hosts": ["api.example.com"]}
        ],
        "budget": {"max_runs_per_day": 4},
        "deployed": {"routine_ids": []},
    }


class DeliveryLintTests(unittest.TestCase):
    def app(self, **routine):
        app = valid()
        app["routine"][0].update(routine)
        return app

    def test_existing_app_without_delivery_fields_is_unchanged(self):
        self.assertEqual(appmodel.lint(valid()), [])
        self.assertEqual(appmodel.delivery(valid()["routine"][0]), "repo")

    def test_each_valid_mode_passes(self):
        self.assertEqual(appmodel.lint(self.app(delivery="repo", repo="acme/jobs")), [])
        self.assertEqual(appmodel.lint(self.app(delivery="repo", repo="acme/jobs", skill="scan-jobs")), [])
        self.assertEqual(appmodel.lint(self.app(delivery="account-skill", skill="scan-jobs")), [])
        self.assertEqual(appmodel.lint(self.app(delivery="inline")), [])

    def test_unknown_delivery_is_an_error(self):
        problems = appmodel.lint(self.app(delivery="carrier-pigeon"))
        self.assertEqual(len(problems), 1)
        self.assertIn("unknown delivery 'carrier-pigeon'", problems[0])
        self.assertTrue(problems[0].startswith("app.toml: "))

    def test_account_skill_without_skill_is_an_error(self):
        problems = appmodel.lint(self.app(delivery="account-skill"))
        self.assertEqual(len(problems), 1)
        self.assertIn("needs a skill name", problems[0])

    def test_repo_delivery_without_repo_is_an_error(self):
        problems = appmodel.lint(self.app(delivery="repo"))
        self.assertEqual(len(problems), 1)
        self.assertIn("needs a repo", problems[0])

    def test_deployed_repo_satisfies_repo_delivery(self):
        app = self.app(delivery="repo")
        app["deployed"]["repo"] = "acme/jobs"
        self.assertEqual(appmodel.lint(app), [])

    def test_bad_skill_name_is_an_error(self):
        problems = appmodel.lint(self.app(delivery="inline", skill="../etc"))
        self.assertEqual(len(problems), 1)
        self.assertIn("skill must be", problems[0])


class SkillFileLintTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.d = self.tmp.name

    def skill(self, text, base="skills", name="scan-jobs"):
        folder = os.path.join(self.d, base, name)
        os.makedirs(folder)
        with open(os.path.join(folder, "SKILL.md"), "w", encoding="utf-8") as fh:
            fh.write(text)

    def app(self, mode="account-skill"):
        app = valid()
        app["routine"][0].update(delivery=mode, skill="scan-jobs", repo="acme/jobs")
        return app

    def test_allowed_keys_pass(self):
        self.skill("---\nname: scan-jobs\ndescription: Scan jobs.\nlicense: MIT\nmetadata:\n  v: 1\nallowed-tools: Bash\n---\nBody\n")
        self.assertEqual(appmodel.skill_problems(self.app(), self.d), [])

    def test_extra_key_in_account_skill_is_an_error(self):
        self.skill("---\nname: scan-jobs\ndescription: Scan.\ndisable-model-invocation: true\n---\n")
        problems = appmodel.skill_problems(self.app(), self.d)
        self.assertEqual(len(problems), 1)
        self.assertIn("disable-model-invocation", problems[0])
        self.assertIn("skills/scan-jobs/SKILL.md", problems[0])

    def test_extra_key_in_repo_skill_is_allowed(self):
        self.skill("---\nname: scan-jobs\ndescription: Scan.\ndisable-model-invocation: true\n---\n", base=".claude/skills")
        self.assertEqual(appmodel.skill_problems(self.app("repo"), self.d), [])

    def test_description_over_limit_is_an_error(self):
        self.skill("---\nname: scan-jobs\ndescription: " + "x" * 1537 + "\n---\n", base=".claude/skills")
        problems = appmodel.skill_problems(self.app("repo"), self.d)
        self.assertEqual(len(problems), 1)
        self.assertIn("1,537", problems[0])

    def test_description_at_limit_passes_and_folded_lines_count(self):
        self.skill("---\nname: scan-jobs\ndescription: " + "x" * 1536 + "\n---\n")
        self.assertEqual(appmodel.skill_problems(self.app(), self.d), [])

    def test_folded_description_lines_are_joined(self):
        self.skill("---\nname: scan-jobs\ndescription: >\n  " + "a" * 800 + "\n  " + "b" * 800 + "\n---\n")
        self.assertEqual(len(appmodel.skill_problems(self.app(), self.d)), 1)

    def test_missing_skill_file_is_not_checked(self):
        self.assertEqual(appmodel.skill_problems(self.app(), self.d), [])


class LintTests(unittest.TestCase):
    def test_valid_manifest_has_no_problems(self):
        self.assertEqual(appmodel.lint(valid()), [])

    def test_routine_uses_undeclared_integration(self):
        app = valid()
        app["routine"][0]["connectors"] = ["gmail", "slack"]
        problems = appmodel.lint(app)
        self.assertEqual(len(problems), 1)
        self.assertIn("slack", problems[0])
        self.assertIn("not declared", problems[0])
        self.assertTrue(problems[0].startswith("app.toml: "))

    def test_routine_writes_collection_it_does_not_own(self):
        app = valid()
        app["routine"][0]["writes"] = ["state"]
        app["routine"].append({"name": "other", "writes": []})
        app["collection"].append({"name": "state", "writer": "other"})
        problems = appmodel.lint(app)
        self.assertTrue(any("does not own" in p for p in problems))

    def test_two_writers_for_one_collection(self):
        app = valid()
        app["collection"].append({"name": "reports", "writer": "other"})
        problems = appmodel.lint(app)
        self.assertTrue(any("more than one writer" in p for p in problems))

    def test_write_integration_without_gate(self):
        app = valid()
        app["integration"][0]["direction"] = "write"
        app["integration"][0]["gate"] = False
        problems = appmodel.lint(app)
        self.assertTrue(any("gate" in p for p in problems))
        app["integration"][0]["gate"] = True
        self.assertEqual(appmodel.lint(app), [])

    def test_secret_in_env_var_is_rejected(self):
        app = valid()
        app["secret"] = [{"name": "TOKEN", "where": "env-var"}]
        problems = appmodel.lint(app)
        self.assertTrue(any("never" in p for p in problems))

    def test_secret_shaped_value_is_rejected_and_not_echoed(self):
        for secret in ("sk-" + "A" * 30, "AKIA" + "B" * 16, "AIza" + "C" * 35, "ya29." + "D" * 25):
            app = valid()
            app["routine"][0]["hosts"] = ["api.example.com", secret]
            problems = appmodel.lint(app)
            self.assertTrue(problems, secret)
            self.assertTrue(any("routine[0].hosts[1]" in p for p in problems))
            for p in problems:
                self.assertNotIn(secret, p)

    def test_live_status_needs_deployed_ids(self):
        app = valid()
        app["app"]["status"] = "live, not yet tested"
        problems = appmodel.lint(app)
        self.assertTrue(any("deployed" in p for p in problems))

    def test_missing_budget_is_a_problem(self):
        app = valid()
        del app["budget"]
        problems = appmodel.lint(app)
        self.assertTrue(any("budget" in p for p in problems))

    def test_lint_does_not_mutate(self):
        app = valid()
        before = copy.deepcopy(app)
        appmodel.lint(app)
        self.assertEqual(app, before)


class DeriveStatusTests(unittest.TestCase):
    def test_derive_status_three_values(self):
        app = valid()
        self.assertEqual(appmodel.derive_status(app, False), "not live")
        app["deployed"]["routine_ids"] = ["r1"]
        self.assertEqual(appmodel.derive_status(app, False), "live, not yet tested")
        self.assertEqual(appmodel.derive_status(app, True), "live and tested")
        app["app"]["status"] = "retired"
        self.assertEqual(appmodel.derive_status(app, True), "retired")


class LoadTests(unittest.TestCase):
    def _write(self, text):
        d = tempfile.mkdtemp()
        path = os.path.join(d, "app.toml")
        with open(path, "w") as fh:
            fh.write(text)
        return path

    def test_load_errors(self):
        with self.assertRaises(appmodel.AppError):
            appmodel.load("/nonexistent/app.toml")
        with self.assertRaises(appmodel.AppError):
            appmodel.load(self._write("[app\nid = "))
        with self.assertRaises(appmodel.AppError):
            appmodel.load(self._write('[app]\ntitle = "x"\nstatus = "not live"\n'))

    def test_load_valid(self):
        path = self._write('[app]\nid = "a"\ntitle = "A"\nstatus = "not live"\n')
        self.assertEqual(appmodel.load(path)["app"]["id"], "a")


class EnvironmentLintTests(unittest.TestCase):
    def lint(self, env):
        app = valid()
        app["environment"] = env
        return appmodel.lint(app)

    def test_app_without_environment_still_lints(self):
        self.assertEqual(appmodel.lint(valid()), [])

    def test_full_valid_environment_lints_clean(self):
        env = {"name": "Default", "network": "limited", "allowed_domains": ["boards.example.com", "*.example.org"],
               "setup_script": False, "env_vars": ["LOG_LEVEL", "_X1"], "shared": True}
        self.assertEqual(self.lint(env), [])

    def test_each_network_level_is_accepted(self):
        for level in ("none", "trusted", "limited", "full", "custom"):
            self.assertEqual(self.lint({"network": level}), [], level)

    def test_unknown_network_level_is_refused(self):
        problems = self.lint({"network": "open"})
        self.assertEqual(len(problems), 1)
        self.assertIn("[environment].network must be one of none, trusted, limited, full, custom", problems[0])

    def test_wrong_types_are_refused(self):
        problems = self.lint({"name": "", "setup_script": "no", "shared": 1, "allowed_domains": "a.com",
                              "env_vars": "LOG"})
        for needle in (".name must be text", ".setup_script must be true or false", ".shared must be true or false",
                       ".allowed_domains must be a list", ".env_vars must be a list"):
            self.assertTrue(any(needle in p for p in problems), needle)

    def test_environment_must_be_a_table(self):
        self.assertIn("app.toml: [environment] must be a table", self.lint("Default"))

    def test_env_var_with_a_value_is_refused_without_echoing_it(self):
        value = "hunter2-very-private"
        problems = self.lint({"env_vars": ["LOG_LEVEL", f"API_TOKEN={value}"]})
        self.assertEqual(problems, ["app.toml: [environment].env_vars[1]: names only, never values; remove the value"])
        self.assertNotIn(value, " ".join(problems))

    def test_routine_tools_must_be_a_list_of_names(self):
        app = valid()
        app["routine"][0]["tools"] = "Bash"
        self.assertIn("app.toml: routine 'scan': tools must be a list of tool names", appmodel.lint(app))
        app["routine"][0]["tools"] = ["Bash", "Read"]
        self.assertEqual(appmodel.lint(app), [])


if __name__ == "__main__":
    unittest.main()
