"""routineos desk: components, modules, module add view and lint (spec 4.7)."""
import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "skills", "routineos", "scripts"))

import routineos  # noqa: E402


def main(*argv):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = routineos.main(list(argv))
    return code, out.getvalue(), err.getvalue()


class DeskCli(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.routine = os.path.join(self.tmp, "watch")
        code, out, err = main("new", "watch", "--from-template", "jobs-watch", "--dir", self.routine)
        self.assertEqual(code, 0, out + err)
        self.defn_path = os.path.join(self.routine, "definition.json")

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def read_defn(self):
        with open(self.defn_path, encoding="utf-8") as f:
            return f.read()

    def test_components_json_lists_button(self):
        code, out, _ = main("desk", "components", "--json")
        self.assertEqual(code, 0)
        ids = [c["id"] for c in json.loads(out)["components"]]
        self.assertIn("button", ids)

    def test_components_markdown_is_the_generated_block(self):
        code, out, _ = main("desk", "components", "--markdown")
        self.assertEqual(code, 0)
        self.assertIn("### button", out)
        self.assertIn("| `label` | text | yes |", out)

    def test_modules_lists_pages_then_routine_modules(self):
        code, out, err = main("desk", "module", "add", "view", "remote-week", "--routine", self.routine,
                              "--type", "role", "--label", "Remote this week")
        self.assertEqual(code, 0, out + err)
        code, out, _ = main("desk", "modules", "--routine", self.routine, "--json")
        self.assertEqual(code, 0)
        ids = [m["id"] for m in json.loads(out)]
        self.assertEqual(ids[0], "today")
        self.assertEqual(ids[-1], "remote-week")
        self.assertEqual(len(ids), 9)
        code, out, _ = main("desk", "modules", "--routine", self.routine)
        lines = out.strip().splitlines()
        self.assertTrue(lines[0].startswith("today"))
        self.assertTrue(lines[-1].startswith("remote-week"))

    def test_module_add_writes_definition(self):
        code, out, err = main("desk", "module", "add", "view", "remote-week", "--routine", self.routine,
                              "--type", "role", "--label", "Remote this week")
        self.assertEqual(code, 0, out + err)
        text = self.read_defn()
        self.assertTrue(text.endswith("}\n"))
        defn = json.loads(text)
        self.assertEqual(defn["desk"]["modules"][0]["view"], {"type": "role"})
        self.assertEqual(defn["desk"]["modules"][0]["label"], "Remote this week")
        self.assertEqual(text, json.dumps(defn, indent=2) + "\n")

    def test_module_add_label_defaults_to_id(self):
        code, _, _ = main("desk", "module", "add", "view", "senior", "--routine", self.routine, "--type", "role")
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(self.read_defn())["desk"]["modules"][0]["label"], "senior")

    def test_module_add_refuses_bad_id(self):
        before = self.read_defn()
        code, out, _ = main("desk", "module", "add", "view", "send-x", "--routine", self.routine, "--type", "role")
        self.assertEqual(code, 1)
        self.assertIn("desk module 'send-x': the id contains a word learning never touches", out)
        self.assertEqual(self.read_defn(), before)

    def test_module_add_refuses_unknown_type(self):
        before = self.read_defn()
        code, out, _ = main("desk", "module", "add", "view", "x1", "--routine", self.routine, "--type", "nope")
        self.assertEqual(code, 1)
        self.assertIn("nope", out)
        self.assertEqual(self.read_defn(), before)

    def test_module_add_without_definition_is_usage_error(self):
        os.remove(self.defn_path)
        code, _, err = main("desk", "module", "add", "view", "x1", "--routine", self.routine, "--type", "role")
        self.assertEqual(code, 2)
        self.assertIn("definition.json", err)

    def test_desk_lint_clean_and_dirty(self):
        code, out, _ = main("desk", "lint", "--routine", self.routine)
        self.assertEqual(code, 0, out)
        defn = json.loads(self.read_defn())
        defn["desk"] = {"modules": [{"id": "x1", "kind": "view", "label": "X", "view": {"type": "role"},
                                     "script": "alert(1)"}]}
        with open(self.defn_path, "w", encoding="utf-8") as f:
            f.write(json.dumps(defn, indent=2) + "\n")
        code, out, _ = main("desk", "lint", "--routine", self.routine)
        self.assertEqual(code, 1)
        self.assertIn("desk module 'x1'", out)
        self.assertIn("script", out)

    def lint_from(self, cwd, *argv):
        import desk_registry
        orig, here = desk_registry.lint, os.getcwd()
        desk_registry.lint = lambda root, routine=None: ["registry.json: planted problem"]
        os.chdir(cwd)
        try:
            return main("lint", *argv)
        finally:
            os.chdir(here)
            desk_registry.lint = orig

    def test_routineos_lint_runs_registry_lint(self):
        # Run inside the plugin repo, the lint includes the skill-root registry lint.
        code, out, _ = self.lint_from(ROOT, self.routine)
        self.assertEqual(code, 1)
        self.assertIn("registry.json: planted problem", out)

    def test_routineos_lint_outside_the_plugin_repo_skips_the_registry_lint(self):
        code, out, _ = self.lint_from(self.tmp, self.routine)
        self.assertEqual(code, 0, out)
        self.assertNotIn("planted problem", out)

    def test_routineos_lint_outside_the_plugin_repo_still_lints_custom_components(self):
        src = os.path.join(ROOT, "tests", "desk_fixtures", "components", "banned-code-eval", "salary-band")
        shutil.copytree(src, os.path.join(self.routine, "desk", "components", "salary-band"))
        code, out, _ = self.lint_from(self.tmp, self.routine)
        self.assertEqual(code, 1, out)
        self.assertIn("salary-band", out)
        self.assertNotIn("planted problem", out)


SKILL = os.path.join(ROOT, "skills", "routineos")
REGISTRY = os.path.join("assets", "desk", "components", "registry.json")
DOC = os.path.join("references", "desk-components.md")
UI = os.path.join("assets", "desk", "app", "componentUi.js")


class DeskRegistry(unittest.TestCase):
    """components/registry.json describes the Desk by id and purpose; its lint and the generated reference block."""

    def setUp(self):
        import desk_registry
        self.dr = desk_registry
        self.tmp = tempfile.mkdtemp()
        for rel in (REGISTRY, DOC, UI):
            os.makedirs(os.path.dirname(os.path.join(self.tmp, rel)), exist_ok=True)
            shutil.copy(os.path.join(SKILL, rel), os.path.join(self.tmp, rel))

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def edit(self, fn, regenerate=True):
        """Change the temp registry with fn, then rebuild the generated block so only the check under test fails."""
        path = os.path.join(self.tmp, REGISTRY)
        with open(path, encoding="utf-8") as f:
            reg = json.load(f)
        fn(reg)
        with open(path, "w", encoding="utf-8") as f:
            f.write(json.dumps(reg, indent=2) + "\n")
        if regenerate:
            doc = os.path.join(self.tmp, DOC)
            with open(doc, encoding="utf-8") as f:
                text = f.read()
            head = text[:text.index(self.dr.GEN_START) + len(self.dr.GEN_START)]
            tail = text[text.index(self.dr.GEN_END):]
            with open(doc, "w", encoding="utf-8") as f:
                f.write(head + "\n" + self.dr.markdown(self.dr.load(self.tmp)) + "\n" + tail)

    def test_registry_is_clean(self):
        self.assertEqual(self.dr.lint(SKILL), [])
        self.assertEqual(self.dr.lint(self.tmp), [])

    def test_no_web_awesome_left_in_the_registry(self):
        reg = self.dr.load(SKILL)
        self.assertEqual(sorted(reg), ["components", "version"])
        for c in reg["components"]:
            self.assertNotIn("wa", c, c["id"])
            self.assertNotIn("fallback", c, c["id"])

    def test_core_and_page_entries(self):
        ids = {c["id"]: c for c in self.dr.load(SKILL)["components"]}
        for core in ("button", "badge", "agent-badge", "chip", "table", "comment-thread"):
            self.assertEqual(ids[core]["kind"], "core")
        for page in ("today", "approvals", "workers", "runs", "history", "settings", "browse", "entity"):
            self.assertEqual(ids[page]["kind"], "page")
            self.assertNotIn("factory", ids[page])

    def test_a_registry_wa_key_or_header_is_refused(self):
        self.edit(lambda r: r.update(extra="1"))
        self.assertEqual(self.dr.lint(self.tmp), ["registry.json: unknown key 'extra'"])
        self.edit(lambda r: r.pop("extra"))
        self.edit(lambda r: r["components"][0].update(wa=["x"]))
        self.assertEqual(self.dr.lint(self.tmp), ["component 'button': unknown key 'wa'"])

    def test_schema_bad_id_and_duplicate(self):
        self.edit(lambda r: r["components"].append({"id": "Bad Id", "kind": "core", "summary": "A thing.", "props": {},
                                                    "since": "0.10.0"}))
        problems = self.dr.lint(self.tmp)
        self.assertEqual(len(problems), 1, problems)
        self.assertIn("component 'Bad Id'", problems[0])

    def test_duplicate_id(self):
        self.edit(lambda r: r["components"].append(dict(r["components"][0])))
        self.assertEqual(self.dr.lint(self.tmp), ["component 'button': declared more than once"])

    def test_summary_copy(self):
        self.edit(lambda r: r["components"][0].update(summary="A smart button."))
        self.assertEqual(self.dr.lint(self.tmp), ["component 'button' summary: 'smart' is not Desk copy"])

    def test_choice_not_enum(self):
        self.edit(lambda r: r["components"][1]["props"].update(tone={"type": "enum", "choices": ["ok"]}))
        problems = self.dr.lint(self.tmp)
        self.assertEqual(len(problems), 1, problems)
        self.assertIn("prop 'tone'", problems[0])
        self.assertIn("'enum'", problems[0])

    def test_factory_must_be_a_component_ui_helper(self):
        self.edit(lambda r: r["components"][0].update(factory="pill"))
        self.assertEqual(self.dr.lint(self.tmp),
                         ["component 'button': factory 'pill' is not a helper componentUi() gives a custom component"])

    def test_generated_block_stale(self):
        self.edit(lambda r: r["components"][0].update(summary="A clickable action."), regenerate=False)
        self.assertEqual(self.dr.lint(self.tmp), ["references/desk-components.md: the generated block is stale; "
                                                  "run routineos desk components --markdown"])

    def test_markdown_lists_props_and_use(self):
        md = self.dr.markdown(self.dr.load(SKILL))
        self.assertIn("| `tone` | choice: ok, warn, fail, pur, accent, neutral | no |", md)
        self.assertIn("Use: `ui.button(...)` in a custom component", md)
        self.assertIn("Use: the `today` default module.", md)


class BundleSplit(DeskCli):
    def test_routine_bundle_split(self):
        code, out, err = main("bundle", "--routine", self.routine, "--split")
        self.assertEqual(code, 0, out + err)
        folder = os.path.join(self.routine, "dashboard", "artifact")
        with open(os.path.join(folder, "index.html"), encoding="utf-8") as fh:
            index = fh.read()
        self.assertIn('"workspace"', index)
        self.assertIn("Split mode is gone; wrote one file.", out)
        self.assertEqual(sorted(os.listdir(folder)), ["files.json", "index.html"])
        with open(os.path.join(folder, "files.json"), encoding="utf-8") as fh:
            self.assertEqual(json.load(fh), ["index.html"])

    def test_routine_bundle_split_carries_components(self):
        src = os.path.join(ROOT, "tests", "desk_fixtures", "components", "good", "salary-band")
        shutil.copytree(src, os.path.join(self.routine, "desk", "components", "salary-band"))
        code, out, err = main("bundle", "--routine", self.routine, "--split")
        self.assertEqual(code, 0, out + err)
        with open(os.path.join(self.routine, "dashboard", "artifact", "index.html"), encoding="utf-8") as fh:
            self.assertIn("component_salary_band", fh.read())

    def test_split_needs_a_routine(self):
        code, _out, err = main("bundle", "--split")
        self.assertEqual(code, 2)
        self.assertIn("--split needs --routine", err)

    def test_routine_bundle_single_equals_desk_page(self):  # M1
        code, out, err = main("bundle", "--routine", self.routine)
        self.assertEqual(code, 0, out + err)
        with open(os.path.join(self.routine, "dashboard", "index.html"), encoding="utf-8") as fh:
            self.assertEqual(fh.read(), routineos.desk_page(routineos._workspace_name(self.routine), routine_dir=self.routine))


if __name__ == "__main__":
    unittest.main()
