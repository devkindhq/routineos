"""Raw page showcase fixture: lint, raw pages, preview thunks and the data-cell names are present in each page source."""
import json
import os
import re
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from test_desk_components_custom import desk_raw, desk_registry, main, read, routineos  # noqa: E402,F401

FIXTURE = os.path.join(HERE, "desk_fixtures", "raw-pages-showcase")
PAGES = ["sc-inputs", "sc-buttons-nav", "sc-overlays", "sc-data-display", "sc-feedback", "sc-charts", "sc-dates",
         "sc-datatable-icons-hooks"]


def page_source(cid):
    return read(os.path.join(FIXTURE, "desk", "components", cid, cid + ".jsx"))


class RawShowcaseTest(unittest.TestCase):
    def test_fixture_has_every_page(self):
        for cid in PAGES:
            self.assertTrue(os.path.isfile(os.path.join(FIXTURE, "desk", "components", cid, "component.json")), cid)
            self.assertTrue(os.path.isfile(os.path.join(FIXTURE, "desk", "components", cid, cid + ".jsx")), cid)

    def test_lint_is_clean(self):
        self.assertEqual(desk_registry.lint_routine_only(routineos.SKILL_ROOT, FIXTURE), [])

    def test_every_page_is_raw(self):
        for cid in PAGES:
            d = os.path.join(FIXTURE, "desk", "components", cid)
            m = json.loads(read(os.path.join(d, "component.json")))
            self.assertIs(m.get("raw"), True, cid)
            self.assertEqual(m["kind"], "custom", cid)
            self.assertTrue(desk_raw.compile_page(d).specifiers, cid)

    def test_preview_writes_a_thunk_per_page(self):
        out = tempfile.mkdtemp()
        code, text, _ = main("desk", "preview", "--routine", FIXTURE, "--out", out)
        self.assertEqual(code, 0, text)
        html = read(os.path.join(out, "index.html"))
        for cid in PAGES:
            self.assertIn('window.DESK_PAGES["%s"] = function (DESK_LIB)' % cid, html, cid)

    def test_every_page_labels_its_cells(self):
        for cid in PAGES:
            src = page_source(cid)
            self.assertIn("CellBoundary", src, cid)
            cells = re.findall(r'<Cell name="([^"]+)"', src)
            self.assertGreater(len(cells), 0, cid)

    def test_cell_names_are_used_in_the_source(self):
        """A claimed component name must appear as a JSX tag or import in the page that claims it."""
        for cid in PAGES:
            src = page_source(cid)
            for names in re.findall(r'<Cell name="([^"]+)"', src):
                for name in names.split():
                    if not re.match(r"^[A-Z]", name) or name == "hooks":
                        continue
                    self.assertRegex(src, r"<" + re.escape(name) + r"[\s/>]", "%s claims %s" % (cid, name))


if __name__ == "__main__":
    unittest.main()
