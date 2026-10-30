import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DESK = os.path.join(ROOT, "skills", "routineos", "assets", "desk")
SRC = os.path.join(DESK, "src")
HTML = os.path.join(DESK, "index.html")
BUNDLER = os.path.join(ROOT, "skills", "routineos", "scripts", "bundle_desk.py")
CLI = os.path.join(ROOT, "skills", "routineos", "scripts", "routineos.py")
NODE_TESTS = os.path.join(ROOT, "tests", "visual", "shell.test.mjs")
PURE_TESTS = os.path.join(ROOT, "tests", "visual", "pure.test.mjs")
V2_TESTS = os.path.join(ROOT, "tests", "visual", "v2.test.mjs")
PAGES = ("today", "inbox", "approvals", "suggestions", "browse", "entity", "views", "settings", "runs", "history", "workers")

EM_DASH = chr(0x2014)
EMOJI = re.compile("[" + chr(0x1F300) + "-" + chr(0x1FAFF) + chr(0x2600) + "-" + chr(0x27BF) + chr(0x2B50) + "]")
BANNED_WORDS = ("ai-powered", "smart", "magic", "effortless", "unlock", "supercharge")

# The v2 palette from the Desk design draft (ledger ruling 20).
LIGHT = {
    "--bg": "#FFFFFF", "--surface": "#F8F8FA", "--line": "#EBECF0",
    "--ink": "#15171C", "--muted": "#696E7B",
    "--accent": "#2F5BD8", "--accent-ink": "#FFFFFF",
    "--ok": "#1F7A46", "--ok-bg": "#E3F4E8",
    "--warn": "#9C540A", "--warn-bg": "#FDEEDC",
    "--fail": "#B13A33", "--fail-bg": "#FBE8E6",
}
DARK = {
    "--bg": "#15171C", "--surface": "#1A1D23", "--line": "#262A32",
    "--ink": "#E9EBF0", "--muted": "#8B91A0",
    "--accent": "#86A3F7", "--accent-ink": "#15171C",
    "--ok": "#66C98F", "--ok-bg": "#17301F",
    "--warn": "#E8A85A", "--warn-bg": "#382B17",
    "--fail": "#EE8479", "--fail-bg": "#3A1F1C",
}
OTHER_TOKENS = ("--font-sans", "--font-mono", "--space-1", "--space-4", "--radius-1", "--radius-2")


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def src_files():
    for dirpath, _dirs, files in os.walk(SRC):
        for f in sorted(files):
            yield os.path.join(dirpath, f)


def found(m, what):
    """The match, or a test failure naming what was missing (narrows Optional for type checkers)."""
    if m is None:
        raise AssertionError(what + " not found")
    return m


def block(css, selector):
    """Body of the first `selector { ... }` block (one level of nesting)."""
    i = css.index(selector)
    start = css.index("{", i) + 1
    depth, j = 1, start
    while depth:
        if css[j] == "{":
            depth += 1
        elif css[j] == "}":
            depth -= 1
        j += 1
    return css[start:j - 1]


def tokens(body):
    return {m.group(1): m.group(2).strip() for m in re.finditer(r"(--[\w-]+)\s*:\s*([^;]+);", body)}


def luminance(hexv):
    h = hexv.lstrip("#")
    rgb = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]


def ratio(a, b):
    """WCAG 2.x, the same formula as Kindform contrast.py."""
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


class BundleTests(unittest.TestCase):
    def test_bundle_is_current(self):
        r = subprocess.run([sys.executable, BUNDLER, "--check"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_check_fails_when_stale(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "index.html")
            shutil.copy(HTML, out)
            with open(out, "a", encoding="utf-8") as fh:
                fh.write("<!-- drift -->")
            r = subprocess.run([sys.executable, BUNDLER, "--check", "--out", out], capture_output=True, text=True)
            self.assertEqual(r.returncode, 1)

    def test_bundle_is_deterministic(self):
        with tempfile.TemporaryDirectory() as tmp:
            a, b = os.path.join(tmp, "a.html"), os.path.join(tmp, "b.html")
            for out in (a, b):
                subprocess.run([sys.executable, BUNDLER, "--out", out], check=True, capture_output=True)
            self.assertEqual(read(a), read(b))
            self.assertEqual(read(a), read(HTML))

    def test_plugin_version_is_injected_for_the_settings_page(self):
        with open(os.path.join(ROOT, ".claude-plugin", "plugin.json"), encoding="utf-8") as fh:
            version = json.load(fh)["version"]
        self.assertIn('var DESK_TEMPLATE_VERSION = "__ROUTINEOS_VERSION__";', read(os.path.join(SRC, "pages", "settings.js")))
        self.assertIn(f'var DESK_TEMPLATE_VERSION = "{version}";', read(HTML))
        self.assertNotIn("__ROUTINEOS_VERSION__", read(HTML))

    def test_cli_bundle_check(self):
        r = subprocess.run([sys.executable, CLI, "bundle", "--check"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_every_src_file_is_inlined(self):
        html = read(HTML)
        for path in src_files():
            if path.endswith((".css", ".js")):
                rel = os.path.relpath(path, SRC)
                self.assertIn(f"/* src/{rel} */", html, rel)


class PageTests(unittest.TestCase):
    def setUp(self):
        self.html = read(HTML)
        self.low = self.html.lower()

    def test_viewport_meta(self):
        self.assertRegex(self.html, r'<meta name="viewport" content="width=device-width, initial-scale=1[^"]*">')

    def test_title_two_to_four_words_from_shell_constant(self):
        m = found(re.search(r"<title>([^<]+)</title>", self.html), "<title>")
        words = m.group(1).split()
        self.assertTrue(2 <= len(words) <= 4, m.group(1))
        name = found(re.search(r'const SHELL_NAME = "([^"]+)";', read(os.path.join(SRC, "shell.js"))), "SHELL_NAME").group(1)
        self.assertEqual(m.group(1), "RoutineOS " + name)

    def test_shell_name_in_one_place(self):
        hits = [os.path.relpath(p, SRC) for p in src_files() if '"Desk"' in read(p)]
        self.assertEqual(hits, ["shell.js"])

    def test_both_dark_selectors_and_body_background(self):
        self.assertIn('@media (prefers-color-scheme: dark)', self.html)
        self.assertIn(':root:not([data-theme="light"])', self.html)
        self.assertIn(':root[data-theme="dark"]', self.html)
        self.assertRegex(self.html, r"body\s*\{[^}]*background:\s*var\(--bg\)")

    def test_no_script_src_and_only_font_links(self):
        self.assertNotRegex(self.low, r"<script[^>]*\ssrc=")
        for href in re.findall(r'<link[^>]*href="([^"]+)"', self.html):
            self.assertRegex(href, r"^https://fonts\.(googleapis|gstatic)\.com(/|$)", href)

    def test_no_blocking_dialogs(self):
        for bad in ("alert(", "confirm(", "prompt(", "window.print"):
            self.assertNotIn(bad, self.html, bad)

    def test_no_html_sinks(self):  # R4
        for bad in ("innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "createContextualFragment", "DOMParser"):
            self.assertNotIn(bad, self.html, bad)

    def test_no_seed_in_page(self):  # R3
        self.assertNotIn(".example", self.html)
        self.assertNotRegex(self.html, r"\bDEMO\b")
        # Seed data would carry bySource as a key; the record page only reads the field.
        self.assertNotRegex(self.html, r'bySource"?\s*:')
        self.assertNotRegex(self.html, r'"entities/[^"]+"\s*:')

    def test_config_block(self):
        m = found(re.search(r'<script type="application/json" id="desk-config">([^<]*)</script>', self.html), "desk-config")
        self.assertIn('"store": "db"', m.group(1))

    def test_clean_copy(self):
        for path in [HTML] + list(src_files()):
            text = read(path)
            rel = os.path.relpath(path, ROOT)
            self.assertNotIn(EM_DASH, text, rel)
            self.assertIsNone(EMOJI.search(text), rel)
            for w in BANNED_WORDS:
                self.assertNotRegex(text.lower(), r"\b" + re.escape(w) + r"\b", f"{w} in {rel}")

    def test_anti_slop_css(self):
        self.assertNotIn("gradient(", self.low)
        self.assertNotIn("backdrop-filter", self.low)
        self.assertNotIn("text-shadow", self.low)
        self.assertNotRegex(self.low, r"filter:\s*blur")
        self.assertNotIn("@keyframes", self.low)
        for value in re.findall(r"box-shadow:\s*([^;}]+)", self.low):
            self.assertRegex(value.strip(), r"^(none|(inset )?0 0 0 1px var\(--[\w-]+\))$", value)

    def test_session_url_guard_present(self):
        self.assertIn("function isClaudeSessionUrl", self.html)
        self.assertIn('u.protocol === "https:"', self.html)

    def test_session_url_guard_behaviour(self):
        node = shutil.which("node")
        if not node:
            self.skipTest("node not installed")
        m = found(re.search(r"function isClaudeSessionUrl\(value\) \{.*?\n\}\n", read(os.path.join(SRC, "ui.js")), re.S),
                  "isClaudeSessionUrl")
        script = m.group(0) + (
            "const cases = [['https://claude.ai/code/session_1', true],"
            "['https://www.claude.ai/x', true],"
            "['javascript:alert(1)', false],['http://claude.ai/x', false],"
            "['https://evilclaude.ai/x', false],['https://claude.ai.evil.com/x', false],"
            "['data:text/html,x', false],['', false],[null, false],['not a url', false]];"
            "const bad = cases.filter(c => isClaudeSessionUrl(c[0]) !== c[1]);"
            "if (bad.length) { console.error(JSON.stringify(bad)); process.exit(1); }"
        )
        r = subprocess.run([node, "-e", script], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_theme_storage_is_guarded(self):
        js = read(os.path.join(SRC, "shell.js"))
        for m in re.finditer(r"localStorage\.(getItem|setItem)", js):
            before = js[:m.start()]
            self.assertGreater(before.rfind("try {"), before.rfind("}"), "localStorage call outside try")
        self.assertIn('"system", "light", "dark"', js)

    def test_only_store_knows_claude_use(self):
        for path in src_files():
            rel = os.path.relpath(path, SRC)
            if rel != "store.js":
                self.assertNotIn("claude.use", read(path), rel)
                self.assertNotIn("window.claude", read(path), rel)

    def test_breakpoint_900(self):
        css = read(os.path.join(SRC, "shell.css"))
        self.assertIn("@media (min-width: 900px)", css)
        self.assertNotRegex(css, r"min-width:\s*(?!900px)\d+px\)")
        self.assertIn("env(safe-area-inset-bottom)", css)
        self.assertRegex(css, r"--nav-h:\s*56px")
        self.assertRegex(css, r"min-height:\s*44px")

    def test_tabular_figures(self):
        self.assertIn("font-variant-numeric: tabular-nums", read(os.path.join(SRC, "shell.css")))


class PagePresenceTests(unittest.TestCase):
    def setUp(self):
        self.html = read(HTML)

    def page(self, name):
        return read(os.path.join(SRC, "pages", name + ".js"))

    def test_pages_bundled_before_shell(self):
        shell_at = self.html.index("/* src/shell.js */")
        for name in ("actions",) + tuple("pages/" + p for p in PAGES):
            marker = f"/* src/{name}.js */"
            self.assertIn(marker, self.html)
            self.assertLess(self.html.index(marker), shell_at, name)

    def test_shell_registers_pages(self):
        shell = read(os.path.join(SRC, "shell.js"))
        for name in PAGES:
            self.assertRegex(shell, name + r":\s*render" + name.capitalize(), name)

    def test_shell_registers_run_detail(self):
        self.assertRegex(read(os.path.join(SRC, "shell.js")), r"run:\s*renderRun\b")

    def test_runs_page_stays_inside_the_boundary(self):
        text = self.page("runs")
        for banned in ("Run now", "Run again", "Edit schedule", "logs"):
            self.assertNotIn(banned, text, banned)
        for line in ("Edit the schedule on the routines page", "Mark seen", "isClaudeSessionUrl(", '"late"', '"unknown"'):
            self.assertIn(line, text, line)

    def test_today_quiet_state(self):
        self.assertIn('stateView("quiet"', self.page("today"))

    def test_inbox_filter_labels(self):
        inbox = self.page("inbox")
        for label in ("All", "Unread", "Done"):
            self.assertIn(f'"{label}"', inbox, label)

    def test_approvals_page_copy(self):
        text = self.page("approvals")
        for line in ("Nothing is sent from the Desk.", "(by role)", '"Edit draft"', '"Approve"', '"Reject"', "Decided"):
            self.assertIn(line, text, line)
        self.assertNotRegex(text, r"recipients?\[[^\]]*\]\.(email|address)", "recipient addresses")

    def test_notifications_panel_copy_and_order(self):
        text = read(os.path.join(SRC, "notify.js"))
        for line in ('"Mark all read"', '"Preferences"', '"All"', '"Unread"', "#/settings?section=notifications", "state/read"):
            self.assertIn(line, text, line)
        self.assertNotRegex(text, r"store\.(set|del)\(")
        self.assertLess(self.html.index("/* src/notify.js */"), self.html.index("/* src/shell.js */"))

    def test_gate_buttons_labelled_honestly(self):
        self.assertIn("A later run acting on it is not piloted.", self.page("inbox"))

    def test_settings_writes_say_next_run(self):
        self.assertIn("Applies from the next run", self.page("inbox"))
        self.assertIn("Applies from the next run", self.page("entity"))
        self.assertIn("Applies from the next run", self.page("settings"))

    def test_settings_page_copy(self):
        text = self.page("settings")
        for line in ("Saves from this page are last write wins: if two people change the same thing, the later save is kept.",
                     "Edit the schedule on the routines page",
                     "Stored. No producer acts on this yet.",
                     "Applies from the next run. Existing records are not re-keyed.",
                     "by routineos new", "25,000"):
            self.assertIn(line, text, line)
        for label in ("Inbox only", "Inbox plus push", "Quiet hours"):
            self.assertIn(f'"{label}"', text, label)

    def test_settings_page_writes_only_settings(self):
        text = self.page("settings")
        self.assertNotRegex(text, r'"(runs|entities|inbox|pending|meta)/', "settings page names a producer path")
        self.assertIn('"settings/workspace"', text)

    def test_views_keep_the_agent_badge(self):
        text = self.page("views")
        self.assertIn("agentBadge(", text)
        for label in ("Keep", "Edit", "Delete"):
            self.assertIn(f'"{label}"', text, label)
        self.assertIn('"Save view"', self.page("browse"))

    def test_pages_write_only_through_actions(self):
        for name in PAGES:
            text = self.page(name)
            self.assertNotRegex(text, r"store\.(set|del)\(", name)
            self.assertNotIn("localStorage", text, name)

    def test_no_version_pin_in_pages(self):
        for name in PAGES:
            self.assertNotRegex(self.page(name), r"(?i)if_?version", name)


class StateTests(unittest.TestCase):
    KINDS = ("no-db", "not-set-up", "first-run", "loading", "read-error", "per-viewer-off", "empty-filter", "quiet", "read-only")

    def setUp(self):
        self.text = read(os.path.join(SRC, "states.js"))
        self.html = read(HTML)

    def test_every_kind_has_fixed_copy(self):
        for kind in self.KINDS:
            self.assertIn(f'"{kind}"', self.text, kind)
        for line in ("This page needs the db capability. Republish it with db declared.",
                     '"Try again"', '"Clear filters"', " match these filters.", '"Nothing needs you."',
                     "NO_VIEWER_NOTE", "routineos.py seed", '"Loading "', "READ_ONLY_NOTE"):
            self.assertIn(line, self.text, line)

    def test_states_bundled_before_pages(self):
        self.assertLess(self.html.index("/* src/states.js */"), self.html.index("/* src/pages/today.js */"))

    def test_loading_is_static(self):
        self.assertNotIn("@keyframes", self.html)
        self.assertNotRegex(self.html, r"animation\s*:")

    def test_pages_use_states(self):
        for name in PAGES + ("../shell",):
            text = read(os.path.join(SRC, "pages", name + ".js"))
            self.assertIn("stateView(", text, name)
            self.assertNotIn("Reload to try again", text, name)


class TokenTests(unittest.TestCase):
    def setUp(self):
        self.css = read(os.path.join(SRC, "tokens.css"))
        self.light = tokens(block(self.css, ":root {"))
        media = block(self.css, "@media (prefers-color-scheme: dark)")
        self.dark_media = tokens(block(media, ':root:not([data-theme="light"])'))
        self.dark_attr = tokens(block(self.css, ':root[data-theme="dark"]'))

    def test_palette_light(self):
        for k, v in LIGHT.items():
            self.assertEqual(self.light.get(k, "").upper(), v, k)
        for k in OTHER_TOKENS:
            self.assertIn(k, self.light)

    def test_palette_dark_in_both_blocks(self):
        for k, v in DARK.items():
            self.assertEqual(self.dark_media.get(k, "").upper(), v, k)
            self.assertEqual(self.dark_attr.get(k, "").upper(), v, k)

    def test_no_line_strong_and_inputs_use_muted(self):
        self.assertNotIn("--line-strong", self.css)
        shell = read(os.path.join(SRC, "shell.css"))
        rule = found(re.search(r"input,\s*select,\s*textarea\s*\{([^}]*)\}", shell), "input, select, textarea rule")
        self.assertIn("var(--muted)", rule.group(1))

    def test_text_contrast_both_themes(self):
        for name, t in (("light", self.light), ("dark", self.dark_attr)):
            pairs = [(fg, g) for fg in ("--ink", "--muted", "--accent", "--ok", "--warn", "--fail")
                     for g in ("--bg", "--surface")]
            pairs += [("--accent-ink", "--accent"), ("--ok", "--ok-bg"), ("--warn", "--warn-bg"), ("--fail", "--fail-bg")]
            for fg, g in pairs:
                r = ratio(t[fg], t[g])
                self.assertGreaterEqual(r, 4.5, f"{name} {fg} on {g} {r:.2f}")
            # control borders use --muted: 3:1 for non-text (WCAG 1.4.11)
            self.assertGreaterEqual(ratio(t["--muted"], t["--bg"]), 3.0)
            self.assertGreaterEqual(ratio(t["--muted"], t["--surface"]), 3.0)

    def test_green_only_for_ok(self):
        # The only green in the palette is --ok (and its ground); the accent is blue.
        def is_green(h):
            r, g, b = (int(h.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))
            return g > r + 20 and g > b + 20
        for t in (self.light, self.dark_attr):
            greens = {k for k, v in t.items() if v.startswith("#") and len(v) == 7 and is_green(v)}
            self.assertEqual(greens - {"--ok", "--ok-bg"}, set())


@unittest.skipUnless(shutil.which("node"), "node not installed")
class NodeTests(unittest.TestCase):
    def test_store_and_router(self):
        r = subprocess.run(["node", "--test", NODE_TESTS], capture_output=True, text=True, cwd=ROOT)
        self.assertEqual(r.returncode, 0, r.stdout[-3000:] + r.stderr[-2000:])

    def test_page_logic(self):
        r = subprocess.run(["node", "--test", PURE_TESTS], capture_output=True, text=True, cwd=ROOT)
        self.assertEqual(r.returncode, 0, r.stdout[-3000:] + r.stderr[-2000:])

    def test_v2_logic(self):
        r = subprocess.run(["node", "--test", V2_TESTS], capture_output=True, text=True, cwd=ROOT)
        self.assertEqual(r.returncode, 0, r.stdout[-3000:] + r.stderr[-2000:])


if __name__ == "__main__":
    unittest.main()
