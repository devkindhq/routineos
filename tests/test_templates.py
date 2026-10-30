import json
import os
import subprocess
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLI = os.path.join(ROOT, "skills", "routineos", "scripts", "routineos.py")
WATCH = os.path.join(ROOT, "templates", "watch")
JOBS = os.path.join(ROOT, "templates", "jobs-watch")


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def lint(path):
    return subprocess.run([sys.executable, CLI, "lint", path], capture_output=True, text=True)


class TemplateLearningTests(unittest.TestCase):
    def test_templates_carry_the_default_learning_block(self):
        sys.path.insert(0, os.path.dirname(CLI))
        import routineos
        for tdir in (WATCH, JOBS):
            defn = json.loads(read(os.path.join(tdir, "definition.json")))
            self.assertEqual(defn.get("learning"), routineos.DEFINITION_TEMPLATE["learning"], tdir)

    def test_watch_keeps_inbox_off(self):
        self.assertIs(json.loads(read(os.path.join(WATCH, "definition.json")))["inbox"], False)


class WatchTemplateTests(unittest.TestCase):
    def test_lint_passes(self):
        r = lint(WATCH)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_readme_exists(self):
        self.assertTrue(os.path.isfile(os.path.join(WATCH, "README.md")))

    def test_has_core_settings(self):
        text = read(os.path.join(WATCH, "routine.toml"))
        for name in ("sources", "lookback_days", "max_items"):
            self.assertIn(f'name = "{name}"', text)

    def test_old_dashboard_is_retired(self):
        self.assertFalse(os.path.exists(os.path.join(WATCH, "dashboard")))
        self.assertNotIn("dashboard/seed.json", read(os.path.join(WATCH, "README.md")))


class JobsWatchTemplateTests(unittest.TestCase):
    def test_template_and_demo_producers_lint(self):
        for d in (JOBS, os.path.join(JOBS, "demo", "producers", "content-radar"),
                  os.path.join(JOBS, "demo", "producers", "lead-signals")):
            r = lint(d)
            self.assertEqual(r.returncode, 0, d + "\n" + r.stdout + r.stderr)

    def test_settings_and_gate(self):
        text = read(os.path.join(JOBS, "routine.toml"))
        for name in ("markets", "title_keywords", "excluded_companies", "excluded_title_words", "lookback_days", "max_inbox_per_run"):
            self.assertIn(f'name = "{name}"', text)
        self.assertIn('template = "jobs-watch"', text)
        self.assertRegex(text, r"\[gate\]\nenabled = true\ntransport = \"email\"\ntimeout_hours = 48")

    def test_excluded_title_words_filters_role_titles(self):
        text = read(os.path.join(JOBS, "routine.toml"))
        self.assertRegex(text, r'name = "excluded_title_words"\ntype = "list"\nrole = "exclude"')
        self.assertIn('example = "intern"', text)
        flt = json.loads(read(os.path.join(JOBS, "definition.json")))["types"]["role"]["settingFilters"]
        self.assertIn({"setting": "excluded_title_words", "field": "title"}, flt)

    def test_company_identity_matches_lead_signals(self):
        jw = json.loads(read(os.path.join(JOBS, "definition.json")))["types"]["company"]
        ls = json.loads(read(os.path.join(JOBS, "demo", "producers", "lead-signals", "definition.json")))["types"]["company"]
        self.assertEqual((jw["identity"], jw["merge"]), (ls["identity"], ls["merge"]))
        self.assertEqual({k: v["type"] for k, v in jw["fields"].items()}, {k: v["type"] for k, v in ls["fields"].items()})

    def test_demo_producers_are_labelled_demo(self):
        for name in ("content-radar", "lead-signals"):
            self.assertIn("(demo)", read(os.path.join(JOBS, "demo", "producers", name, "README.md")))

    def test_prompt_is_read_only(self):
        prompt = read(os.path.join(JOBS, "prompt.md"))
        self.assertIn("Push rule: report-only. Never send, post, push or delete anything.", prompt)
        self.assertIn("Never write `settings/`", prompt)


class ComingSoonTests(unittest.TestCase):
    def test_stubs(self):
        for name in ("approval-gated", "digest", "tracker"):
            text = read(os.path.join(ROOT, "templates", "coming-soon", name, "README.md"))
            self.assertIn("coming soon", text.lower())
            self.assertIn("Components", text)


class PackTemplateTests(unittest.TestCase):
    """jobs-watch and watch ship as packs: they export, validate and round-trip."""

    def setUp(self):
        sys.path.insert(0, os.path.join(ROOT, "skills", "routineos", "scripts"))
        import pack
        import routineos
        self.pack, self.desk = pack, routineos.desk_page

    def test_both_export_validate_and_round_trip(self):
        import tempfile
        for name in ("jobs-watch", "watch"):
            p = self.pack.export(os.path.join(ROOT, "templates", name))
            self.assertEqual(self.pack.validate(p), [], name)
            self.assertEqual(p["id"], name)
            self.assertEqual(p["maturity"], "piloted", name)
            self.assertNotIn("files", p, name)
            with tempfile.TemporaryDirectory() as d:
                target = os.path.join(d, name)
                self.pack.install(p, target, desk_html=self.desk)
                self.assertEqual(self.pack.export(target), p, name)
                self.assertFalse(os.path.exists(os.path.join(target, "demo")))

    def test_jobs_watch_declares_web_search_and_a_gate_stage(self):
        p = self.pack.export(os.path.join(ROOT, "templates", "jobs-watch"))
        by_id = {c["id"]: c for c in p["connectors"]}
        self.assertEqual(by_id["web-search"]["kind"], "builtin")
        self.assertTrue(by_id["web-search"]["required"])
        self.assertIn("gate", [s["kind"] for s in p["stages"]])
        kinds = [s["id"] for s in p["stages"]]
        self.assertLess(kinds.index("learn"), kinds.index("write"))

    def test_both_are_in_the_catalog(self):
        with open(os.path.join(ROOT, "catalog", "index.json"), encoding="utf-8") as fh:
            ids = [e["id"] for e in json.load(fh)["templates"]]
        self.assertIn("jobs-watch", ids)
        self.assertIn("watch", ids)


if __name__ == "__main__":
    unittest.main()
