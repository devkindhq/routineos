"""Zero hand-written CSS in the Desk: no .css files and no style= props in assets/desk/app or assets/desk/core,
except entries in tests/desk_css_allow.json, each {"path": "<file under assets/desk>", "count": int, "why": str}.
Package stylesheets imported from node_modules (Mantine's own) are not hand-written and are not counted."""
import json
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DESK = os.path.join(ROOT, "skills", "routineos", "assets", "desk")
ALLOW = os.path.join(ROOT, "tests", "desk_css_allow.json")
DIRS = ("app", "core")
# A JSX style prop, an inline style set through the DOM, or a style attribute set by name.
STYLE_PROP = re.compile(r"""(?<![.\w$])style\s*=\s*[{"']|\.style\.\w+\s*=(?!=)|\.style\.cssText|setAttribute\(\s*["']style["']""")
LOCAL_CSS_IMPORT = re.compile(r"""import\s+(?:[\w{}\s,*]+\s+from\s+)?["'](\.{1,2}/[^"']+\.css)["']""")


def found(desk=DESK):
    """{relative path: count} of .css files (count 1 each), style= props and local .css imports."""
    hits = {}
    for d in DIRS:
        for dirpath, _dirs, files in os.walk(os.path.join(desk, d)):
            for f in files:
                path = os.path.join(dirpath, f)
                rel = os.path.relpath(path, desk).replace(os.sep, "/")
                if f.endswith(".css"):
                    hits[rel] = hits.get(rel, 0) + 1
                elif f.endswith((".js", ".jsx", ".mjs")):
                    with open(path, encoding="utf-8") as fh:
                        text = fh.read()
                    n = len(STYLE_PROP.findall(text)) + len(LOCAL_CSS_IMPORT.findall(text))
                    if n:
                        hits[rel] = hits.get(rel, 0) + n
    return hits


def problems(hits, allow):
    allowed = {e["path"]: e for e in allow}
    out = []
    for rel, n in sorted(hits.items()):
        e = allowed.get(rel)
        if e is None:
            out.append(f"{rel}: {n} hand-written style(s), not in desk_css_allow.json")
        elif n > e["count"]:
            out.append(f"{rel}: {n} hand-written style(s), allowed {e['count']}")
    return out


class DeskCss(unittest.TestCase):
    def test_allow_list_is_well_formed(self):
        with open(ALLOW, encoding="utf-8") as fh:
            allow = json.load(fh)
        self.assertIsInstance(allow, list)
        for e in allow:
            self.assertEqual(set(e), {"path", "count", "why"}, e)
            self.assertTrue(str(e["why"]).strip(), e)

    def test_no_hand_written_css_beyond_the_allow_list(self):
        with open(ALLOW, encoding="utf-8") as fh:
            allow = json.load(fh)
        self.assertEqual(problems(found(), allow), [])

    def test_scan_finds_css_files_style_props_and_local_imports(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            os.makedirs(os.path.join(tmp, "app", "pages"))
            os.makedirs(os.path.join(tmp, "core"))
            for rel, text in (("app/desk.css", "a{}"), ("app/pages/X.jsx", '<div style={{ color: "red" }} />\n<p style={s} />'),
                              ("app/main.jsx", 'import "@mantine/core/styles.css";\nimport "./local.css";'),
                              ("core/ok.js", 'export var styles = 1;\nvar s = opts.style === "sentence";\nif (el.style.color === "x") {}'),
                              ("core/dom.js", 'el.style.color = "red";\nel.setAttribute("style", "x");')):
                with open(os.path.join(tmp, rel), "w", encoding="utf-8") as fh:
                    fh.write(text)
            hits = found(tmp)
            self.assertEqual(hits, {"app/desk.css": 1, "app/pages/X.jsx": 2, "app/main.jsx": 1, "core/dom.js": 2})
            self.assertEqual(len(problems(hits, [])), 4)
            self.assertEqual(problems(hits, [{"path": "app/pages/X.jsx", "count": 2, "why": "w"},
                                             {"path": "app/desk.css", "count": 1, "why": "w"},
                                             {"path": "app/main.jsx", "count": 1, "why": "w"},
                                             {"path": "core/dom.js", "count": 2, "why": "w"}]), [])
            self.assertEqual(len(problems(hits, [{"path": "app/pages/X.jsx", "count": 1, "why": "w"}])), 4)


if __name__ == "__main__":
    unittest.main()
