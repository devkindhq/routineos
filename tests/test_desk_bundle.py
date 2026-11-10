"""The committed single-file Desk (desk/index.html, built by Vite) and the Python injection that turns it into a
routine's page: config block, plugin version, custom components."""
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

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "skills", "routineos", "scripts"))

import bundle_desk  # noqa: E402
import desk_registry  # noqa: E402
import routineos  # noqa: E402

DESK = os.path.join(ROOT, "skills", "routineos", "assets", "desk")
HTML = os.path.join(DESK, "index.html")
TEMPLATE = os.path.join(DESK, "index.template.html")
EM_DASH = chr(0x2014)
EMOJI = re.compile("[" + chr(0x1F300) + "-" + chr(0x1FAFF) + chr(0x2600) + "-" + chr(0x27BF) + chr(0x2B50) + "]")
BANNED_WORDS = ("ai-powered", "smart", "magic", "effortless", "unlock", "supercharge")
CONFIG_RE = re.compile(r'id="desk-config">([^<]*)</script>')
URL_RE = re.compile(r"https?://[^\s\"'<>)`\\]*")
# XML namespace names are identifiers, never fetched. The other two are strings inside the React and Mantine
# runtime (an error-page prefix and a docs link in a warning); nothing requests them. The last two are strings inside
# the marked Markdown lexer: the scheme it prepends to a bare www. link in text (the Desk draws only https links, so
# that link is never live) and the issue address in its error message.
URL_ALLOWED = ("http://www.w3.org/", "https://www.w3.org/")
URL_STRINGS = {"https://react.dev/errors/", "https://mantine.dev/theming/colors/#primary-color", "http://",
               "https://github.com/markedjs/marked."}
SYNTHETIC = ('<!doctype html><html><head><title>Desk</title></head><body><div id="root"></div>'
             '<script type="application/json" id="desk-config">{"store":"db"}</script>\n'
             '<!-- desk-components -->\n<script>var v = "__ROUTINEOS_VERSION__";</script>\n'
             '<script type="module">app()</script>\n</body></html>')


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def source_files(*tops):
    """The Desk's own source under desk/<top> (core, app), plus the Vite page template. The built page is not scanned:
    the React runtime it inlines legitimately names innerHTML."""
    paths = [TEMPLATE]
    for top in tops:
        for base, dirs, files in os.walk(os.path.join(DESK, top)):
            dirs[:] = sorted(d for d in dirs if not d.startswith("."))
            paths += [os.path.join(base, f) for f in sorted(files) if f.endswith((".js", ".jsx", ".html"))]
    return paths


def run_cli(*argv):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = routineos.main(list(argv))
    return code, out.getvalue(), err.getvalue()


class InjectTests(unittest.TestCase):
    def test_config_is_injected(self):
        html = bundle_desk.inject(SYNTHETIC, {"store": "db", "workspace": "W", "tour": True}, "1.2.3", [])
        self.assertEqual(json.loads(CONFIG_RE.search(html).group(1)), {"store": "db", "workspace": "W", "tour": True})

    def test_script_end_in_a_workspace_name_is_escaped(self):
        html = bundle_desk.inject(SYNTHETIC, {"store": "db", "workspace": "</script><b>&"}, "", [])
        self.assertEqual(json.loads(CONFIG_RE.search(html).group(1))["workspace"], "</script><b>&")
        self.assertEqual(html.count("</script>"), SYNTHETIC.count("</script>"))

    def test_version_mark_is_replaced(self):
        html = bundle_desk.inject(SYNTHETIC, {"store": "db"}, "1.2.3", [])
        self.assertNotIn(bundle_desk.VERSION_MARK, html)
        self.assertIn('var v = "1.2.3";', html)

    def test_a_version_that_could_break_out_is_refused(self):
        with self.assertRaises(bundle_desk.BundleError):
            bundle_desk.inject(SYNTHETIC, {"store": "db"}, '1"; alert(1)', [])

    def test_two_components_in_order_before_the_app_script(self):
        html = bundle_desk.inject(SYNTHETIC, {"store": "db"}, "", ["var first = 1;", "var second = 2;"])
        a, b = html.index("var first = 1;"), html.index("var second = 2;")
        self.assertLess(a, b)
        self.assertLess(b, html.index('<script type="module">'))
        self.assertEqual(html.count("<script>"), SYNTHETIC.count("<script>") + 2)

    def test_a_component_that_would_end_its_block_is_refused(self):
        for bad in ("x = '</script>';", "x = '<SCRIPT>';", "<!-- y"):
            with self.subTest(bad=bad), self.assertRaises(bundle_desk.BundleError):
                bundle_desk.inject(SYNTHETIC, {"store": "db"}, "", [bad])

    def test_a_page_without_the_config_block_is_refused(self):
        with self.assertRaises(bundle_desk.BundleError):
            bundle_desk.inject(SYNTHETIC.replace('id="desk-config"', 'id="other"'), {"store": "db"}, "", [])

    def test_a_page_without_the_components_marker_is_refused(self):
        with self.assertRaises(bundle_desk.BundleError):
            bundle_desk.inject(SYNTHETIC.replace("<!-- desk-components -->", ""), {"store": "db"}, "", ["var a;"])

    def test_component_js_registers_the_factory(self):
        js = bundle_desk.component_js("salary-band", "component_salary_band", "function component_salary_band() {}")
        self.assertIn('["salary-band"] = component_salary_band;', js)
        with self.assertRaises(bundle_desk.BundleError):
            bundle_desk.component_js("salary-band", "component_other", "function component_other() {}")


class BuiltPageTests(unittest.TestCase):
    def setUp(self):
        self.html = read(HTML)
        self.page = routineos.desk_page("W")

    def test_committed_page_is_the_vite_build(self):
        self.assertRegex(self.html, r'<meta name="desk-src-hash" content="[0-9a-f]{64}">')
        self.assertEqual(self.html.count("<!-- desk-components -->"), 1)
        self.assertEqual(len(CONFIG_RE.findall(self.html)), 1)

    def test_desk_page_injects_the_workspace(self):
        self.assertEqual(json.loads(CONFIG_RE.search(self.page).group(1)), {"store": "db", "workspace": "W"})

    def test_no_version_mark_is_left(self):
        self.assertNotIn(bundle_desk.VERSION_MARK, self.page)

    def test_no_replacement_characters(self):
        self.assertNotIn(chr(0xFFFD), self.html)
        self.assertNotIn(chr(0xFFFD), self.page)

    def test_no_url_but_namespaces_and_known_strings(self):
        urls = {u for u in URL_RE.findall(self.page) if not u.startswith(URL_ALLOWED)}
        self.assertLessEqual(urls, URL_STRINGS)

    def test_components_go_before_the_app_script(self):
        html = bundle_desk.inject(self.html, {"store": "db"}, "", ["var first = 1;", "var second = 2;"])
        self.assertLess(html.index("var first = 1;"), html.index("var second = 2;"))
        self.assertLess(html.index("var second = 2;"), html.index('<script type="module"'))


class SplitTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.routine = os.path.join(self.tmp, "watch")
        code, out, err = run_cli("new", "watch", "--from-template", "jobs-watch", "--dir", self.routine)
        self.assertEqual(code, 0, out + err)

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_split_writes_one_page_and_its_list(self):
        code, out, err = run_cli("bundle", "--routine", self.routine, "--split")
        self.assertEqual(code, 0, out + err)
        folder = os.path.join(self.routine, "dashboard", "artifact")
        self.assertEqual(sorted(os.listdir(folder)), ["files.json", "index.html"])
        self.assertEqual(json.loads(read(os.path.join(folder, "files.json"))), ["index.html"])
        page = routineos.desk_page(routineos._workspace_name(self.routine), routine_dir=self.routine)
        self.assertEqual(read(os.path.join(folder, "index.html")), page)
        self.assertIn("Split mode is gone; wrote one file.", out)


class ConfigTests(unittest.TestCase):
    """The desk-config block: the keys the page reads, passed through by the bundler and the CLI (spec 5.10, 7f)."""

    def test_config_json_keeps_tour_and_drops_unknown_keys(self):
        text = bundle_desk.config_json({"store": "db", "workspace": "W", "tour": True, "other": 1})
        self.assertEqual(json.loads(text), {"store": "db", "workspace": "W", "tour": True})
        self.assertEqual(json.loads(bundle_desk.config_json({"store": "db", "tour": False})), {"store": "db", "tour": False})

    def test_config_json_refuses_a_tour_that_is_not_a_boolean(self):
        with self.assertRaises(bundle_desk.BundleError):
            bundle_desk.config_json({"store": "db", "tour": "yes"})

    def test_desk_page_passes_the_tour_through(self):
        m = CONFIG_RE.search(routineos.desk_page("W", tour=True))
        self.assertEqual(json.loads(m.group(1)), {"store": "db", "workspace": "W", "tour": True})
        m = CONFIG_RE.search(routineos.desk_page("W"))
        self.assertEqual(json.loads(m.group(1)), {"store": "db", "workspace": "W"})


class SourceGuardTests(unittest.TestCase):
    """Guards on the Desk's own source (desk/core, desk/app and the page template)."""

    def setUp(self):
        self.files = {os.path.relpath(p, ROOT): read(p) for p in source_files("core", "app")}
        self.app = {rel: text for rel, text in self.files.items() if "/desk/app/" in rel}

    def test_scans_core_and_app(self):
        self.assertTrue(any("/desk/core/" in rel for rel in self.files))
        self.assertTrue(self.app)

    def test_no_html_sinks(self):  # R4
        for rel, text in self.files.items():
            for bad in desk_registry.HTML_SINKS:
                self.assertNotIn(bad, text, f"{bad} in {rel}")
        for rel, text in self.app.items():
            self.assertNotIn("dangerouslySetInnerHTML", text, rel)

    def test_no_blocking_dialogs(self):
        for rel, text in self.files.items():
            for bad in ("alert(", "confirm(", "prompt(", "window.print"):
                self.assertNotIn(bad, text, f"{bad} in {rel}")

    def test_no_seed_in_page(self):  # R3
        for rel, text in self.files.items():
            self.assertNotIn(".example", text, rel)
            self.assertNotRegex(text, r"\bDEMO\b", rel)
            # Seed data would carry bySource as a key; the record page only reads the field.
            self.assertNotRegex(text, r'bySource"?\s*:', rel)
            self.assertNotRegex(text, r'"entities/[^"]+"\s*:', rel)

    def test_clean_copy(self):
        for rel, text in self.files.items():
            self.assertNotIn(EM_DASH, text, rel)
            self.assertIsNone(EMOJI.search(text), rel)
            for w in BANNED_WORDS:
                self.assertNotRegex(text.lower(), r"\b" + re.escape(w) + r"\b", f"{w} in {rel}")

    def test_theme_storage_is_guarded(self):
        for name in ("prefs.js", "lock.js"):
            js = read(os.path.join(DESK, "core", name))
            calls = list(re.finditer(r"\b(localStorage|sessionStorage)\b|\.(getItem|setItem|removeItem)\(", js))
            self.assertTrue(calls, name)
            for m in calls:
                line = js[js.rfind("\n", 0, m.start()) + 1:m.start()]
                if line.lstrip().startswith("//"):
                    continue
                before = js[:m.start()]
                self.assertGreater(before.rfind("try {"), before.rfind("}"), f"storage call outside try in {name}")
        self.assertIn('["system", "light", "dark"]', read(os.path.join(DESK, "core", "prefs.js")))


class SessionUrlGuardTests(unittest.TestCase):
    """Session links render only for claude.ai over https (core/shared.js isClaudeSessionUrl)."""

    SHARED = os.path.join(DESK, "core", "shared.js")

    def test_session_url_guard_present(self):
        js = read(self.SHARED)
        self.assertIn("export function isClaudeSessionUrl", js)
        self.assertIn('u.protocol === "https:"', js)

    def test_session_url_guard_behaviour(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("node not installed")
        script = (
            "const { isClaudeSessionUrl } = await import(process.argv[1]);"
            "const cases = [['https://claude.ai/code/session_example', true],"
            "['https://www.claude.ai/x', true],"
            "['javascript:alert(1)', false],['http://claude.ai/x', false],"
            "['https://evilclaude.ai/x', false],['https://claude.ai.evil.com/x', false],"
            "['data:text/html,x', false],['', false],[null, false],[undefined, false],['not a url', false]];"
            "const bad = cases.filter(c => isClaudeSessionUrl(c[0]) !== c[1]);"
            "if (bad.length) { console.error(JSON.stringify(bad)); process.exit(1); }"
        )
        r = subprocess.run([node, "--input-type=module", "-e", script, "file://" + self.SHARED],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)


if __name__ == "__main__":
    unittest.main()
