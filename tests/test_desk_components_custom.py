"""Custom field cell components: lint, scaffold, copy, per-routine bundle and pack refusal (spec 4.6)."""
import contextlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(os.path.dirname(HERE), "skills", "routineos")
sys.path.insert(0, os.path.join(ROOT, "scripts"))
sys.path.insert(0, HERE)

import bundle_desk  # noqa: E402
import desk_registry  # noqa: E402
import pack  # noqa: E402
import routineos  # noqa: E402
from pack_fixtures import minimal_pack  # noqa: E402

FIXTURES = os.path.join(HERE, "desk_fixtures", "components")
GOOD = os.path.join(FIXTURES, "good", "salary-band")

DEFN = {
    "version": 1,
    "label": "Test",
    "types": {
        "job": {
            "label": "Job", "plural": "Jobs", "identity": "field:title",
            "fields": {"title": {"label": "Title", "type": "text"}, "salary": {"label": "Salary", "type": "text"}},
        }
    },
}


def main(*argv):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = routineos.main(list(argv))
    return code, out.getvalue(), err.getvalue()


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def component_scripts(html):
    """The bodies of the classic scripts that hold one custom component each, in page order."""
    return [m.group(1) for m in re.finditer(r"<script>\n(.*?)</script>", html, re.S) if "/* desk/components/" in m.group(1)]


def page(components=None):
    """The committed page filled as desk_page fills it, with these (id, factory, text) components in the given order."""
    js = [bundle_desk.component_js(*c) for c in components or []]
    return bundle_desk.inject(read(os.path.join(ROOT, "assets", "desk", "index.html")), {"store": "db", "workspace": "W"},
                              bundle_desk.plugin_version(), js)


class Tmp(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def comp(self, manifest=None, js=None, src=GOOD):
        """A copy of a component folder with its manifest patched and its .js replaced."""
        d = os.path.join(self.tmp, "c", "salary-band")
        shutil.rmtree(d, ignore_errors=True)
        shutil.copytree(src, d)
        if manifest is not None:
            m = json.loads(read(os.path.join(d, "component.json")))
            for k, v in manifest.items():
                if v is None:
                    m.pop(k, None)
                else:
                    m[k] = v
            write(os.path.join(d, "component.json"), json.dumps(m, indent=2) + "\n")
        if js is not None:
            write(os.path.join(d, "salary-band.js"), js)
        return d

    def routine(self, name="watch"):
        """A routine scaffolded from the jobs-watch template."""
        d = os.path.join(self.tmp, name)
        code, out, err = main("new", name, "--from-template", "jobs-watch", "--dir", d)
        self.assertEqual(code, 0, out + err)
        return d

    def add_component(self, routine, src=GOOD):
        shutil.copytree(src, os.path.join(routine, "desk", "components", os.path.basename(src)))


class ComponentLint(Tmp):
    def assertOneProblem(self, problems, needle):
        self.assertEqual(len([p for p in problems if needle in p]), 1, problems)

    def test_good_component_clean(self):
        self.assertEqual(desk_registry.lint_component(GOOD, None), [])
        self.assertEqual(desk_registry.lint_component(GOOD, DEFN), [])

    def test_slot_must_be_a_known_slot(self):
        self.assertOneProblem(desk_registry.lint_component(self.comp({"slot": "widget"}), None), "slot")

    def test_legacy_wa_key_is_accepted_and_ignored(self):
        # Routines made before the Mantine Desk carry "wa" in component.json; the key is accepted and ignored.
        self.assertEqual(desk_registry.lint_component(self.comp({"wa": ["wa-button"]}), None), [])
        self.assertEqual(desk_registry.lint_component(self.comp({"wa": None}), None), [])

    def test_fallback_must_be_same(self):
        self.assertOneProblem(desk_registry.lint_component(self.comp({"fallback": "span"}), None), "fallback")

    def test_factory_name(self):
        problems = desk_registry.lint_component(self.comp({"factory": "salaryBand"}), None)
        self.assertTrue(any("component_salary_band" in p for p in problems), problems)

    def test_why_at_least_40_characters(self):
        self.assertOneProblem(desk_registry.lint_component(self.comp({"why": "Short reason."}), None), "why")
        self.assertOneProblem(desk_registry.lint_component(self.comp({"why": None}), None), "why")
        self.assertEqual(desk_registry.lint_component(self.comp({"why": "x" * 40}), None), [])

    def test_no_props_key(self):
        problems = desk_registry.lint_component(self.comp({"props": {"value": {"type": "text"}}}), None)
        self.assertOneProblem(problems, "no props")

    def test_id_matches_folder(self):
        self.assertOneProblem(desk_registry.lint_component(
            self.comp({"id": "other-band", "factory": "component_other_band"}), None), "folder")

    def test_exactly_one_top_level_function_with_the_factory_name(self):
        good_js = read(os.path.join(GOOD, "salary-band.js"))
        two = good_js + "\nfunction helper(x) {\n  return x;\n}\n"
        self.assertOneProblem(desk_registry.lint_component(self.comp(js=two), None), "exactly one")
        renamed = good_js.replace("function component_salary_band(", "function salaryBand(")
        self.assertOneProblem(desk_registry.lint_component(self.comp(js=renamed), None), "exactly one")
        missing = os.path.join(self.comp(), "salary-band.js")
        os.remove(missing)
        self.assertOneProblem(desk_registry.lint_component(os.path.dirname(missing), None), "salary-band.js")

    def test_banned_api_groups(self):
        cases = {
            "banned-html-sink": "innerHTML",
            "banned-code-eval": "eval",
            "banned-network": "fetch(",
            "banned-storage": "localStorage",
            "banned-event-handler": "on* handler",
            "banned-host": "claude.",
            "banned-url": "URL",
        }
        self.assertEqual(sorted(cases), sorted(n for n in os.listdir(FIXTURES) if n.startswith("banned-")))
        for name, needle in cases.items():
            with self.subTest(name):
                problems = desk_registry.lint_component(os.path.join(FIXTURES, name, "salary-band"), None)
                self.assertEqual(len(problems), 1, problems)
                self.assertIn(needle, problems[0])

    def test_every_banned_api_is_refused(self):
        good_js = read(os.path.join(GOOD, "salary-band.js"))
        lines = {
            "outerHTML": "var a = props.outerHTML;",
            "insertAdjacentHTML": "props.x.insertAdjacentHTML(1, 2);",
            "document.write": "document.write(1);",
            "createContextualFragment": "var r = props.createContextualFragment;",
            "DOMParser": "var p = new DOMParser();",
            "Function(": "var f = Function(1);",
            "import(": "var m = import(props.x);",
            "XMLHttpRequest": "var x = new XMLHttpRequest();",
            "WebSocket": "var w = new WebSocket(props.x);",
            "sessionStorage": "var s = sessionStorage;",
            "setAttribute(\"on": "props.x.setAttribute(\"onclick\", props.y);",
        }
        for needle, line in lines.items():
            with self.subTest(needle):
                js = good_js.replace("  var v = props.value || {};\n", "  var v = props.value || {};\n  " + line + "\n")
                problems = desk_registry.lint_component(self.comp(js=js), None)
                self.assertTrue(any(needle in p for p in problems), problems)

    def test_text_regex_bypasses_refused(self):
        """The lint is a guard against mistakes, not the security boundary; these known bypasses still fail it."""
        good_js = read(os.path.join(GOOD, "salary-band.js"))
        lines = {
            "computed member access": 'var a = ui.el("span"); a["inner" + "HTML"] = String(v.min);',
            "computed member access ": 'var b = ui.el("span"); b["on" + "click"] = props.x;',
            "script": 'var u = "java" + "script:" + String(v.min);',
            "iframe": 'var f = ui.el("iframe");',
            "object": 'var o = ui.el("object");',
            "embed": 'var e = ui.el("embed");',
            "srcdoc": 'var d = ui.el("span", { "srcdoc": props.x });',
            "on* key": 'var k = ui.el("span", { "onclick": props.x });',
            "on* key ": 'var k = ui.el("span", { onclick: props.x });',
        }
        for needle, line in lines.items():
            with self.subTest(line):
                js = good_js.replace("  var v = props.value || {};\n", "  var v = props.value || {};\n  " + line + "\n")
                problems = desk_registry.lint_component(self.comp(js=js), None)
                self.assertTrue(any(needle.strip() in p for p in problems), problems)

    def test_plain_index_and_on_words_still_allowed(self):
        good_js = read(os.path.join(GOOD, "salary-band.js"))
        js = good_js.replace("  var v = props.value || {};\n",
                             '  var v = props.value || {};\n  var first = [1, 2][0]; var w = props.record["title"];'
                             ' var t = "one"; var n = ui.el("span", {}, "on hold");\n')
        self.assertEqual(desk_registry.lint_component(self.comp(js=js), None), [])

    def test_markdown_only_marked_option_allowed_but_other_on_keys_refused(self):
        good_js = read(os.path.join(GOOD, "salary-band.js"))
        line = '  var m = ui.markdown(String(v.min), { marks: ["a"], onlyMarked: true });\n'
        js = good_js.replace("  var v = props.value || {};\n", "  var v = props.value || {};\n" + line)
        self.assertEqual(desk_registry.lint_component(self.comp(js=js), None), [])
        for key in ("onclick", "onlyclick", "onlyMarkedX", "onMarked"):
            with self.subTest(key):
                bad = good_js.replace("  var v = props.value || {};\n",
                                      "  var v = props.value || {};\n  var k = ui.el(\"span\", { %s: props.x });\n" % key)
                problems = desk_registry.lint_component(self.comp(js=bad), None)
                self.assertTrue(any("on* key" in p for p in problems), problems)

    def test_html_sinks_are_banned_apis(self):
        names = [name for name, _ in desk_registry.BANNED_APIS]
        for sink in desk_registry.HTML_SINKS:
            self.assertIn(sink, names)

    def test_literal_naming_the_routine_refused(self):
        js = read(os.path.join(GOOD, "salary-band.js")).replace(
            "  var v = props.value || {};\n", "  var v = props.record[\"salary\"] || {};\n")
        problems = desk_registry.lint_component(self.comp(js=js), DEFN)
        self.assertOneProblem(problems, '"salary"')
        self.assertEqual(desk_registry.lint_component(self.comp(js=js), None), [])
        js = read(os.path.join(GOOD, "salary-band.js")).replace("\"band\"", "\"job\"")
        self.assertOneProblem(desk_registry.lint_component(self.comp(js=js), DEFN), '"job"')
        defn = dict(DEFN, views=[{"id": "v1", "type": "job", "name": "V", "filters": {"source": "board"}}])
        js = read(os.path.join(GOOD, "salary-band.js")).replace("\"band\"", "\"board\"")
        self.assertOneProblem(desk_registry.lint_component(self.comp(js=js), defn), '"board"')

    def test_top_level_code_other_than_the_function_refused(self):
        good_js = read(os.path.join(GOOD, "salary-band.js"))
        cases = {
            "const": good_js + "const el = 1;\n",
            "shadow": good_js + "var renderBrowse = function () { return 1; };\n",
            "before": "var x = 1;\n" + good_js,
            "escape": good_js + "})(); (function () {\n",
            "property": good_js + "component_salary_band.x = 1;\n",
        }
        for name, js in cases.items():
            with self.subTest(name):
                problems = desk_registry.lint_component(self.comp(js=js), None, parse=False)
                self.assertTrue(any("top-level" in p for p in problems), problems)
        tail = good_js + "/* a closing note */\n// and a line comment\n;\n"
        self.assertEqual(desk_registry.lint_component(self.comp(js=tail), None, parse=False), [])
        tricky = good_js.replace("  var v = props.value || {};\n",
                                 '  var v = props.value || {};\n  var s = "}" + \'{\' + `}${String(v.min)}{`;'
                                 ' var r = /[}{]/.test(s);\n')
        self.assertEqual(desk_registry.lint_component(self.comp(js=tricky), None, parse=False), [])

    def test_core_and_host_identifiers_refused(self):
        good_js = read(os.path.join(GOOD, "salary-band.js"))
        lines = {
            "constructor": "var f = ui.el.constructor;",
            "Reflect": "var g = Reflect.ownKeys(props);",
            "navigator": "var n = navigator.language;",
            "location": "var l = location.hash;",
            "document": "var d = document.title;",
            "globalThis": "var t = globalThis.name;",
            "window": "var w = window.name;",
            "Function": "var h = Function.prototype;",
            "eval": "var e = eval;",
            "importScripts": "importScripts(props.x);",
        }
        for needle, line in lines.items():
            with self.subTest(needle):
                js = good_js.replace("  var v = props.value || {};\n", "  var v = props.value || {};\n  " + line + "\n")
                problems = desk_registry.lint_component(self.comp(js=js), None, parse=False)
                self.assertTrue(any(needle in p for p in problems), problems)

    def test_global_aliases_and_bare_claude_refused(self):
        good_js = read(os.path.join(GOOD, "salary-band.js"))
        lines = {
            "self": "var g = self;",
            "top": "var g = top.name;",
            "parent": "var g = parent;",
            "frames": "var g = frames.length;",
            "opener": "var g = opener;",
            "claude": "var c = claude; var u = c.use;",
        }
        for needle, line in lines.items():
            with self.subTest(needle):
                js = good_js.replace("  var v = props.value || {};\n", "  var v = props.value || {};\n  " + line + "\n")
                problems = desk_registry.lint_component(self.comp(js=js), None, parse=False)
                self.assertTrue(any("names " + needle + "," in p for p in problems), problems)
        # The same words as property names or object keys are fine.
        fine = good_js.replace("  var v = props.value || {};\n",
                               "  var v = props.value || {};\n  var b = { top: props.top, parent: v.parent, self: 1 };\n")
        self.assertEqual(desk_registry.lint_component(self.comp(js=fine), None, parse=False), [])

    @unittest.skipUnless(shutil.which("node"), "node is not on PATH")
    def test_parse_error_refused(self):
        js = read(os.path.join(GOOD, "salary-band.js")).replace('"band-empty" }, "-")', '"band-empty" }, "-"')
        problems = desk_registry.lint_component(self.comp(js=js), None)
        self.assertTrue(any("does not parse" in p for p in problems), problems)
        self.assertEqual(desk_registry.lint_component(GOOD, None), [])

    def test_parse_check_skipped_with_a_note_without_node(self):
        err = io.StringIO()
        with mock.patch.object(desk_registry.shutil, "which", return_value=None), contextlib.redirect_stderr(err):
            self.assertEqual(desk_registry.lint_component(GOOD, None), [])
        self.assertIn("node is not on PATH", err.getvalue())
        self.assertIn("parse check skipped", err.getvalue())


class RoutineComponents(Tmp):
    def test_custom_components_listed(self):
        r = self.routine()
        self.assertEqual(desk_registry.custom_components(r), [])
        self.add_component(r)
        comps = desk_registry.custom_components(r)
        self.assertEqual([(c["id"], c["factory"]) for c in comps], [("salary-band", "component_salary_band")])
        self.assertEqual(comps[0]["path"], os.path.join(r, "desk", "components", "salary-band"))

    def test_load_merges_custom_entries(self):
        r = self.routine()
        self.add_component(r)
        core = desk_registry.load(ROOT)
        merged = desk_registry.load(ROOT, r)
        self.assertEqual(len(merged["components"]), len(core["components"]) + 1)
        entry = merged["components"][-1]
        self.assertEqual((entry["id"], entry["kind"]), ("salary-band", "custom"))
        self.assertNotIn("wa", entry)
        self.assertNotIn("salary-band", [c["id"] for c in desk_registry.load(ROOT)["components"]])

    def test_routine_lint_clean_with_component(self):
        r = self.routine()
        self.add_component(r)
        self.assertEqual(desk_registry.lint(ROOT, r), [])

    def test_desk_lint_passes_a_component_with_a_legacy_wa_key(self):
        r = self.routine()
        d = os.path.join(r, "desk", "components", "salary-band")
        shutil.copytree(self.comp({"wa": ["wa-button"]}), d)
        code, out, _ = main("desk", "lint", "--routine", r)
        self.assertEqual(code, 0, out)

    def test_routine_lint_reports_component_problems(self):
        r = self.routine()
        self.add_component(r, os.path.join(FIXTURES, "banned-network", "salary-band"))
        problems = desk_registry.lint(ROOT, r)
        self.assertEqual(len(problems), 1, problems)
        self.assertIn("fetch(", problems[0])

    def test_custom_id_cannot_take_a_core_id(self):
        r = self.routine()
        d = os.path.join(r, "desk", "components", "badge")
        shutil.copytree(GOOD, d)
        os.rename(os.path.join(d, "salary-band.js"), os.path.join(d, "badge.js"))
        m = json.loads(read(os.path.join(d, "component.json")))
        m.update(id="badge", factory="component_badge")
        write(os.path.join(d, "component.json"), json.dumps(m))
        write(os.path.join(d, "badge.js"), read(os.path.join(d, "badge.js")).replace("component_salary_band", "component_badge"))
        problems = desk_registry.lint(ROOT, r)
        self.assertTrue(any("badge" in p and "core" in p for p in problems), problems)

    def test_fields_must_name_an_existing_component(self):
        r = self.routine()
        code, out, err = main("desk", "module", "add", "view", "remote-week", "--routine", r, "--type", "role")
        self.assertEqual(code, 0, out + err)
        path = os.path.join(r, "definition.json")
        defn = json.loads(read(path))
        defn["desk"]["modules"][0]["fields"] = {"salary_max": "salary-band"}
        write(path, json.dumps(defn, indent=2) + "\n")
        problems = desk_registry.lint(ROOT, r)
        self.assertEqual(len(problems), 1, problems)
        self.assertIn("salary-band", problems[0])
        self.add_component(r)
        self.assertEqual(desk_registry.lint(ROOT, r), [])


class Scaffold(Tmp):
    def test_scaffold_fails_until_why_filled(self):
        r = self.routine()
        code, out, err = main("desk", "component", "new", "salary-band", "--routine", r)
        self.assertEqual(code, 0, out + err)
        d = os.path.join(r, "desk", "components", "salary-band")
        self.assertTrue(os.path.isfile(os.path.join(d, "salary-band.js")))
        self.assertNotIn("wa", json.loads(read(os.path.join(d, "component.json"))))
        code, out, _ = main("desk", "lint", "--routine", r)
        self.assertEqual(code, 1)
        self.assertIn("why", out)
        self.assertEqual(len([line for line in out.splitlines() if line.startswith("FAIL")]), 1, out)
        m = json.loads(read(os.path.join(d, "component.json")))
        m["why"] = "The default cell text cannot show a range of two numbers."
        write(os.path.join(d, "component.json"), json.dumps(m, indent=2) + "\n")
        code, out, _ = main("desk", "lint", "--routine", r)
        self.assertEqual(code, 0, out)

    def test_scaffold_refuses_bad_or_taken_ids(self):
        r = self.routine()
        self.assertEqual(main("desk", "component", "new", "Bad Id", "--routine", r)[0], 2)
        self.assertEqual(main("desk", "component", "new", "badge", "--routine", r)[0], 2)
        self.assertEqual(main("desk", "component", "new", "salary-band", "--routine", r)[0], 0)
        self.assertEqual(main("desk", "component", "new", "salary-band", "--routine", r)[0], 2)

    def test_copy_clean(self):
        a, b = self.routine("a"), self.routine("b")
        self.add_component(a)
        code, out, err = main("desk", "component", "copy", "salary-band", "--from", a, "--to", b)
        self.assertEqual(code, 0, out + err)
        self.assertEqual(read(os.path.join(b, "desk", "components", "salary-band", "salary-band.js")),
                         read(os.path.join(GOOD, "salary-band.js")))

    def test_copy_lints_target(self):
        a, b = self.routine("a"), self.routine("b")
        self.add_component(a)
        path = os.path.join(b, "definition.json")
        defn = json.loads(read(path))
        defn["types"]["role"]["fields"]["band"] = {"label": "Band", "type": "text"}
        write(path, json.dumps(defn, indent=2) + "\n")
        code, out, _ = main("desk", "component", "copy", "salary-band", "--from", a, "--to", b)
        self.assertEqual(code, 1)
        self.assertIn('"band"', out)

    def test_copy_refuses_missing_source_and_existing_target(self):
        a, b = self.routine("a"), self.routine("b")
        self.assertEqual(main("desk", "component", "copy", "salary-band", "--from", a, "--to", b)[0], 2)
        self.add_component(a)
        self.add_component(b)
        self.assertEqual(main("desk", "component", "copy", "salary-band", "--from", a, "--to", b)[0], 2)


class RoutineBundle(Tmp):
    def dashboard(self, r):
        return os.path.join(r, "dashboard", "index.html")

    def test_no_components_byte_identical(self):
        r = self.routine()
        self.assertEqual(routineos.desk_page("W", routine_dir=r), routineos.desk_page("W"))
        os.remove(self.dashboard(r))
        code, out, err = main("bundle", "--routine", r)
        self.assertEqual(code, 0, out + err)
        self.assertEqual(read(self.dashboard(r)), routineos.desk_page("watch"))

    def test_workspace_name_from_routine_toml(self):
        r = self.routine()
        toml = read(os.path.join(r, "routine.toml"))
        self.assertIn("[workspace]", toml)
        write(os.path.join(r, "routine.toml"), toml.replace("[workspace]\n", "[workspace]\nname = \"Hiring board\"\n", 1))
        code, out, err = main("bundle", "--routine", r)
        self.assertEqual(code, 0, out + err)
        self.assertEqual(read(self.dashboard(r)), routineos.desk_page("Hiring board"))

    def test_bundle_with_components_does_not_fail_on_plugin_registry_state(self):
        r = self.routine()
        self.add_component(r)
        orig = desk_registry.lint
        desk_registry.lint = lambda root, routine=None: ["registry.json: planted problem"]
        try:
            html = routineos.desk_page("W", routine_dir=r)
        finally:
            desk_registry.lint = orig
        self.assertIn("salary-band", html)

    def test_components_bundled_and_mapped(self):
        r = self.routine()
        self.add_component(r)
        code, out, err = main("bundle", "--routine", r)
        self.assertEqual(code, 0, out + err)
        html = read(self.dashboard(r))
        self.assertEqual(html, routineos.desk_page("watch", routine_dir=r))
        fn = "function component_salary_band("
        register = '(window.DESK_COMPONENTS = window.DESK_COMPONENTS || Object.create(null))["salary-band"] = component_salary_band;'
        self.assertEqual(html.count(fn), 1)
        self.assertEqual(html.count(register), 1)
        # Each component sits in its own classic script before the core script, so it shares no scope with the core.
        own = component_scripts(html)
        self.assertEqual(len(own), 1)
        self.assertIn(fn, own[0])
        self.assertIn(register, own[0])
        self.assertNotIn("/* src/", own[0])
        self.assertLess(html.index(register), html.index('<script type="module"'))
        self.assertNotIn("DESK_COMPONENTS = {", html)
        self.assertIn('"workspace": "watch"', html)

    def named(self, routine, cid):
        """The good fixture copied into routine as component cid."""
        d = os.path.join(routine, "desk", "components", cid)
        shutil.copytree(GOOD, d)
        fn = desk_registry.factory_name(cid)
        m = json.loads(read(os.path.join(d, "component.json")))
        m.update(id=cid, factory=fn)
        write(os.path.join(d, "component.json"), json.dumps(m, indent=2) + "\n")
        js = read(os.path.join(d, "salary-band.js")).replace("component_salary_band", fn)
        os.remove(os.path.join(d, "salary-band.js"))
        write(os.path.join(d, cid + ".js"), js)

    def test_component_order_is_by_id(self):
        r = self.routine()
        self.named(r, "b-two")
        self.named(r, "a-one")
        own = component_scripts(routineos.desk_page("W", routine_dir=r))
        self.assertEqual(len(own), 2)
        self.assertIn('["a-one"] = component_a_one;', own[0])
        self.assertIn('["b-two"] = component_b_two;', own[1])

    @unittest.skipUnless(shutil.which("node"), "node is not on PATH")
    def test_a_broken_component_parses_apart_from_the_core(self):
        good = read(os.path.join(GOOD, "salary-band.js"))
        comps = [("salary-band", "component_salary_band", good),
                 ("broken-one", "component_broken_one", "function component_broken_one(ctx, props, ui) {\n  return (;\n}\n"),
                 ("shadow-el", "component_shadow_el", "function component_shadow_el(ctx, props, ui) { return null; }\nconst el = 1;\n")]
        html = page(comps)
        core = re.findall(r'<script type="module"[^>]*>(.*?)</script>', html, re.S)
        self.assertEqual(len(core), 1)
        checks = {}
        for name, body, ext in [("core", core[0], ".mjs")] + [(c[0], s, ".js") for c in comps for s in component_scripts(html)
                                                               if f"/* desk/components/{c[0]}/" in s]:
            path = os.path.join(self.tmp, name + ext)
            write(path, body)
            checks[name] = subprocess.run(["node", "--check", path], capture_output=True).returncode
        self.assertEqual(checks, {"core": 0, "salary-band": 0, "broken-one": 1, "shadow-el": 0})

    def test_build_refuses_unsafe_component_text(self):
        with self.assertRaises(bundle_desk.BundleError):
            page([("a-one", "component_a_one", "var x = '</script>';")])
        with self.assertRaises(bundle_desk.BundleError):
            page([("a-one", "alert(1); component_a_one", "function component_a_one() {}")])

    def test_build_refuses_html_comment_and_script_open(self):
        for text in ('var x = "<!--";', 'var x = "<script>";', 'var x = "<!--<SCRIPT>";', "var x = '<ScRiPt';"):
            with self.subTest(text):
                with self.assertRaises(bundle_desk.BundleError):
                    page([("a-one", "component_a_one", "function component_a_one() { " + text + " }")])

    def test_bad_component_refused(self):
        r = self.routine()
        self.add_component(r, os.path.join(FIXTURES, "banned-network", "salary-band"))
        before = read(self.dashboard(r))
        code, out, _ = main("bundle", "--routine", r)
        self.assertEqual(code, 1)
        self.assertIn("fetch(", out)
        self.assertEqual(read(self.dashboard(r)), before)
        with self.assertRaises(routineos.DeskPageError):
            routineos.desk_page("watch", routine_dir=r)

    def test_new_and_install_pass_target(self):
        target = os.path.join(self.tmp, "fresh")
        with mock.patch.object(routineos, "desk_page", wraps=routineos.desk_page) as spy:
            code, out, err = main("new", "fresh", "--from-template", "jobs-watch", "--dir", target)
        self.assertEqual(code, 0, out + err)
        spy.assert_called_once_with("fresh", routine_dir=target)
        self.assertEqual(read(self.dashboard(target)), routineos.desk_page("fresh"))

        pack_path = os.path.join(self.tmp, "p.json")
        write(pack_path, json.dumps(minimal_pack()))
        installed = os.path.join(self.tmp, "installed")
        with mock.patch.object(routineos, "desk_page", wraps=routineos.desk_page) as spy:
            code, out, err = main("pack", "install", pack_path, "--dir", installed)
        self.assertEqual(code, 0, out + err)
        spy.assert_called_once_with("demo-watch", routine_dir=installed)
        self.assertEqual(read(self.dashboard(installed)), routineos.desk_page("demo-watch"))

    def test_core_bundle_unchanged(self):
        core = read(os.path.join(ROOT, "assets", "desk", "index.html"))
        self.assertEqual(page(), routineos.desk_page("W"))
        self.assertEqual(page(None), page([]))
        self.assertNotIn("DESK_COMPONENTS = ", core)

    def test_bundle_routine_needs_a_routine_folder(self):
        code, _, _ = main("bundle", "--routine", os.path.join(self.tmp, "nope"))
        self.assertEqual(code, 2)
        code, _, _ = main("bundle", "--routine", self.routine(), "--check")
        self.assertEqual(code, 2)


class PackRefusal(unittest.TestCase):
    MESSAGE = ("packs carry module JSON, not component code; copy the component with "
               "`routineos desk component copy` or propose it for the core registry")

    def problems(self, files):
        p = minimal_pack()
        p["files"] = files
        return pack.validate(p)

    def test_js_file_refused_with_message(self):
        problems = self.problems({"lib/readme.md": "x\n", "lib/cell.js": "function f() {}\n"})
        self.assertIn(f"files[1]: {self.MESSAGE}", problems)
        self.assertFalse(any(p.startswith("files[1]: path is not allowed") for p in problems), problems)

    def test_desk_components_path_refused_with_message(self):
        problems = self.problems({"desk/components/salary-band/component.json": "{}\n"})
        self.assertIn(f"files[0]: {self.MESSAGE}", problems)
        self.assertFalse(any("path is not allowed" in p for p in problems), problems)

    def test_other_bad_paths_keep_generic_message(self):
        problems = self.problems({"bin/run.sh": "echo\n"})
        self.assertIn("files[0]: path is not allowed; use lib/ or skills/ with a .py, .md, .json or .txt name", problems)
        self.assertFalse(any("component code" in p for p in problems), problems)

    def test_install_refuses_component_code(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp)
        p = minimal_pack()
        p["files"] = {"lib/cell.js": "function f() {}\n"}
        src = os.path.join(tmp, "p.json")
        write(src, json.dumps(p))
        code, out, _ = main("pack", "install", src, "--dir", os.path.join(tmp, "out"))
        self.assertEqual(code, 1)
        self.assertIn(self.MESSAGE, out)
        self.assertFalse(os.path.exists(os.path.join(tmp, "out")))


if __name__ == "__main__":
    unittest.main()
