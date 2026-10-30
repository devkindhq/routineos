"""Desk UI checks: the vendored icon set, icon-only star toggles, the link-style Edit, clean copy in the
touched docs, and that the UI change left definition and demo data alone. Behaviour of the helpers is
covered in tests/visual/pure.test.mjs; these are static checks over the source and the bundle."""
import os
import re
import json
import subprocess
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "skills", "routineos", "scripts"))
import definition  # noqa: E402
DESK = os.path.join(ROOT, "skills", "routineos", "assets", "desk")
SRC = os.path.join(DESK, "src")
HTML = os.path.join(DESK, "index.html")
SITE_HTML = os.path.join(ROOT, "site", "desk.html")  # the local landing page copy, not tracked; checked when present
EM_DASH = chr(0x2014)

REQUIRED_ICONS = ("star", "star-filled", "pencil", "check", "x", "external-link", "chevron-down", "filter", "columns-3",
                  "download", "triangle-alert", "search", "sun", "moon", "monitor", "bell", "menu", "panel-left", "rows-3") + definition.NAV_ICONS
STAR_PAGES = ("browse", "inbox", "entity")
DOCS = (os.path.join(ROOT, "templates", "watch", "README.md"), os.path.join(ROOT, "templates", "jobs-watch", "README.md"),
        os.path.join(SRC, "icons.LICENSE.txt"))
# Data and compiled definitions a UI change must not touch. The jobs-watch definition, its demo generator and
# templates/jobs-watch/demo/desk-demo.json change with the role summary field and the keep demo records, and both template
# definitions carry the default learning block, so they are not listed.
DATA_PATHS = ("tests/fixtures", ":(exclude)tests/fixtures/migrate")


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def page(name):
    return read(os.path.join(SRC, "pages", name + ".js"))


class IconSet(unittest.TestCase):
    def setUp(self):
        self.icons = read(os.path.join(SRC, "icons.js"))

    def test_every_icon_is_defined(self):
        defined = set(re.findall(r'^  "([a-z0-9-]+)": \[', self.icons, re.M))
        self.assertEqual(defined, set(REQUIRED_ICONS))

    def test_nav_icons_match_the_pack_schema(self):
        schema = json.loads(read(os.path.join(ROOT, "catalog", "schema", "pack.v1.schema.json")))
        for kind in ("type", "view"):
            self.assertEqual(schema["$defs"][kind]["properties"]["icon"]["enum"], list(definition.NAV_ICONS))

    def test_symbols_are_24_grid_and_current_colour(self):
        self.assertIn('viewBox: "0 0 24 24"', self.icons)
        self.assertIn('stroke: "currentColor"', self.icons)
        self.assertIn('fill: "none"', self.icons)
        self.assertIn('"star-filled": [["path", { d: STAR_PATH, fill: "currentColor" }]]', self.icons)

    def test_licence_travels_with_the_icons(self):
        for text in (self.icons, read(os.path.join(SRC, "icons.LICENSE.txt"))):
            self.assertIn("ISC License", text)
            self.assertIn("Copyright (c) 2026 Lucide Icons and Contributors", text)
            self.assertIn("Copyright (c) 2013-present Cole Bemis", text)

    def test_bundle_carries_the_sprite_and_mounts_it(self):
        for path in (HTML, SITE_HTML) if os.path.isfile(SITE_HTML) else (HTML,):
            html = read(path)
            self.assertIn("/* src/icons.js */", html)
            self.assertIn("Lucide Icons and Contributors", html)
            self.assertIn('var ICON_PREFIX = "icon-";', html)
        self.assertIn("append(root, iconSprite());", read(os.path.join(SRC, "shell.js")))

    def test_no_markup_strings_build_icons(self):
        self.assertNotRegex(self.icons, r"'[^'\n]*<(svg|path|symbol|use)|\"[^\"\n]*<(svg|path|symbol|use)")


class StarToggle(unittest.TestCase):
    def test_no_text_only_star_buttons(self):
        for name in STAR_PAGES + ("today", "views", "settings", "runs"):
            # The Browse star column header is a visually hidden "Star" label, not a button.
            text = page(name).replace('el("span", { class: "visually-hidden" }, "Star")', "")
            self.assertNotRegex(text, r'"Unstar"|"Star"\s*[,)]', name)
            self.assertNotRegex(text, r'(actionButton|button)\(ctx,\s*[^,]*\?\s*"Unstar"', name)

    def test_star_pages_use_the_toggle(self):
        for name in STAR_PAGES:
            self.assertIn("starToggle(ctx,", page(name), name)

    def test_toggle_is_icon_only_with_aria_pressed(self):
        actions = read(os.path.join(SRC, "actions.js"))
        body = re.search(r"function starToggle\(.*?\n}\n", actions, re.S)
        self.assertIsNotNone(body)
        b = body.group(0)
        self.assertIn('icon: starred ? "star-filled" : "star"', b)
        self.assertIn("iconOnly: true", b)
        self.assertIn("pressed: !!starred", b)
        self.assertIn('(starred ? "Unstar " : "Star ") + name', b)
        ui = read(os.path.join(SRC, "ui.js"))
        self.assertIn('"aria-pressed": opts.pressed === undefined ? null : (opts.pressed ? "true" : "false")', ui)
        self.assertIn('"aria-label": iconOnly ? label : null', ui)

    def test_browse_star_column_is_narrow(self):
        self.assertIn('el("td", { class: "star-col" }, starButton(r, cols))', page("browse"))
        self.assertRegex(read(os.path.join(SRC, "shell.css")), r"th\.star-col, td\.star-col \{ width: 1%;")


class Controls(unittest.TestCase):
    def test_edit_is_a_link(self):
        views = page("views")
        self.assertRegex(views, r'el\("a", \{ class: "link-action", href: [^}]+\}, icon\("pencil"\), "Edit"\)')
        self.assertNotRegex(views, r'button\(\s*"Edit"')

    def test_settings_chip_remove_is_an_x_icon_button(self):
        self.assertIn('button("Remove " + v, function () {', page("settings"))
        self.assertIn('{ icon: "x", iconOnly: true }', page("settings"))
        self.assertNotRegex(page("settings"), r'\}, "Remove"\)')

    def test_theme_control_is_an_icon_button(self):
        shell = read(os.path.join(SRC, "shell.js"))
        self.assertIn('var THEME_ICONS = { system: "monitor", light: "sun", dark: "moon" };', shell)
        self.assertIn('class: "ghost icon-btn theme-toggle"', shell)

    def test_one_primary_per_card(self):
        today = page("today")
        for label in ("Mark read", "Acknowledge", "Dismiss", "Reject"):
            line = [ln for ln in today.splitlines() if 'actionButton(ctx, "' + label + '"' in ln][0]
            self.assertNotIn("primary: true", line, label)
        for label in ("Accept", "Approve"):
            line = [ln for ln in today.splitlines() if 'actionButton(ctx, "' + label + '"' in ln][0]
            self.assertIn("primary: true", line, label)

    def test_ghost_hover_keeps_layout(self):
        css = read(os.path.join(SRC, "shell.css"))
        self.assertIn("button.ghost { background: transparent; border-color: transparent;", css)
        hover = re.search(r"button\.ghost:hover:not\(:disabled\) \{([^}]*)\}", css)
        self.assertIsNotNone(hover)
        self.assertNotRegex(hover.group(1), r"padding|border-width|margin|font-size|min-height")
        self.assertIn("button.icon-btn { justify-content: center; min-width: 36px; min-height: 36px;", css)

    def test_settings_diff_table_wraps(self):
        self.assertIn('el("table", { class: "settings-diff" },', page("runs"))
        self.assertIn("table.settings-diff td { overflow-wrap: anywhere;", read(os.path.join(SRC, "shell.css")))


class CleanCopy(unittest.TestCase):
    def test_no_em_dashes_in_touched_docs(self):
        for path in DOCS:
            self.assertNotIn(EM_DASH, read(path), os.path.relpath(path, ROOT))

    def test_no_undefined_in_proposal_copy(self):
        self.assertIn("proposalText(producerLabel(defn, it.doc.data.producer), p)", page("today"))
        self.assertIn("proposalDiff(d.proposal)", page("inbox"))


class DataUntouched(unittest.TestCase):
    def test_definition_and_data_files_are_unchanged_against_main(self):
        try:
            base = subprocess.run(["git", "-C", ROOT, "merge-base", "HEAD", "origin/main"],
                                  capture_output=True, text=True, timeout=30)
        except (OSError, subprocess.SubprocessError):
            self.skipTest("git is not available")
        if base.returncode != 0:
            self.skipTest("no origin/main to compare against")
        diff = subprocess.run(["git", "-C", ROOT, "diff", "--name-only", base.stdout.strip(), "--"] + list(DATA_PATHS),
                              capture_output=True, text=True, timeout=30)
        self.assertEqual(diff.returncode, 0, diff.stderr)
        self.assertEqual(diff.stdout.strip(), "")


if __name__ == "__main__":
    unittest.main()
