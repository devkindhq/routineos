"""List setting validation: the same rules in schema.py, the Desk form, the proposal check, and the scripts."""
import os
import re
import subprocess
import sys
import tempfile
import unittest

from pack_fixtures import ROOT, TEMPLATES

import desk_contract
import schema

SETTINGS_JS = os.path.join(ROOT, "skills", "routineos", "assets", "desk", "core", "pages", "settings.js")
BAD_ITEMS = ['https://a.example/x"; touch /tmp/pwn; "', "https://a.example/$(id)", "https://a.example/a b",
             "https://a.example/`id`", "http://a.example/", "ftp://a.example", "https://a.example/\n--out", "x" * 301]


def lst(fmt=None):
    s = {"name": "pages", "type": "list"}
    if fmt:
        s["format"] = fmt
    return s


class FormatTests(unittest.TestCase):
    def test_good_and_bad_items(self):
        good = {"word": ["analytics", "a-b_c"], "https_url": ["https://example.org", "https://example.org/a/b?x=1&y=2".replace("&", "")],
                "ga_property": ["properties/123456789"], "gsc_site": ["sc-domain:example.com", "https://example.org/"]}
        for fmt, items in good.items():
            for item in items:
                self.assertEqual(schema.list_item_problem(lst(fmt), item), "", (fmt, item))
        for item in BAD_ITEMS:
            self.assertNotEqual(schema.list_item_problem(lst("https_url"), item), "", item)
        self.assertNotEqual(schema.list_item_problem(lst("word"), "Has Space"), "")
        self.assertNotEqual(schema.list_item_problem(lst("ga_property"), "123"), "")
        self.assertNotEqual(schema.list_item_problem(lst("gsc_site"), "sc-domain:a.com; id"), "")

    def test_no_format_still_needs_one_line_text(self):
        self.assertEqual(schema.list_item_problem(lst(), "any phrase here"), "")
        for bad in ["", "  ", 5, "a\nb", "x" * 301]:
            self.assertNotEqual(schema.list_item_problem(lst(), bad), "", repr(bad))
        self.assertNotEqual(schema.list_problem(lst(), "not a list"), "")

    def test_js_table_equals_python_table(self):
        with open(SETTINGS_JS, encoding="utf-8") as fh:
            src = fh.read()
        block = re.search(r"LIST_FORMATS\s*=\s*\{(.*?)\n\};", src, re.S).group(1)
        js = {}
        for name, expr in re.findall(r"(\w+):\s*(?:new RegExp\()?\"(.*?)\"\)?,?\n", block):
            pass
        for name, pat in re.findall(r"(\w+):\s*\"((?:[^\"\\]|\\.)*)\"", block):
            js[name] = pat.replace("\\\\", "\\")
        self.assertEqual(js, schema.LIST_FORMATS)
        self.assertRegex(src, r"LIST_ITEM_MAX\s*=\s*%d\b" % schema.LIST_ITEM_MAX)


class LintTests(unittest.TestCase):
    def cfg(self, setting):
        return {"routine": {"name": "x", "type": "watch", "schedule": "0 6 * * *", "first_run": "report-only"},
                "store": {"adapter": "artifact-db"}, "setting": [setting], "gate": {"enabled": False}}

    def problems(self, setting, prompt=""):
        return [p for p in schema.lint(self.cfg(setting), prompt) if "format" in p or "default" in p or "shell" in p or "@file" in p]

    def test_format_rules(self):
        self.assertEqual(self.problems({"name": "u", "type": "list", "label": "U", "format": "https_url", "default": []}), [])
        self.assertTrue(self.problems({"name": "u", "type": "list", "label": "U", "format": "nope", "default": []}))
        self.assertTrue(self.problems({"name": "n", "type": "number", "label": "N", "format": "word", "default": 1, "min": 0, "max": 5}))
        self.assertTrue(self.problems({"name": "u", "type": "list", "label": "U", "format": "https_url", "default": ["http://x.example"]}))

    def test_prompt_shell_interpolation(self):
        ok = "Run `python3 lib/x.py @args.txt --max PAGES`.\n"
        self.assertEqual(schema.shell_interpolation_problems(ok), [])
        self.assertTrue(schema.shell_interpolation_problems('Run `python3 lib/x.py --site "SITE"`.\n'))
        self.assertTrue(schema.shell_interpolation_problems("Run `python3 lib/x.py --site $SITE`.\n"))
        self.assertTrue(schema.shell_interpolation_problems("Keep the double quotes around every setting value.\n"))

    def test_every_template_prompt_is_clean(self):
        for tid in sorted(os.listdir(TEMPLATES)):
            path = os.path.join(TEMPLATES, tid, "prompt.md")
            if os.path.isfile(path):
                with open(path, encoding="utf-8") as fh:
                    self.assertEqual(schema.shell_interpolation_problems(fh.read()), [], tid)


class ProposalTests(unittest.TestCase):
    def test_add_item_checks_the_format(self):
        # "123" is a plain value (it passes the proposal character check) but is not a GA property
        sdef = lst("ga_property")
        with self.assertRaises(desk_contract.ContractError) as cm:
            desk_contract._item_change({"setting": "pages", "op": "add", "value": "123"}, sdef, [])
        self.assertIn("not a valid ga property", str(cm.exception))
        before, after = desk_contract._item_change({"setting": "pages", "op": "add", "value": "properties/123"}, sdef, [])
        self.assertEqual(after, ["properties/123"])


class ScriptTests(unittest.TestCase):
    def run_script(self, rel, args_lines, extra):
        script = os.path.join(TEMPLATES, rel)
        with tempfile.TemporaryDirectory() as tmp:
            af = os.path.join(tmp, "args.txt")
            with open(af, "w", encoding="utf-8") as fh:
                fh.write("\n".join(args_lines) + "\n")
            return subprocess.run([sys.executable, script, "@" + af] + [e.replace("TMP", tmp) for e in extra],
                                  capture_output=True, text=True, cwd=tmp), tmp

    def test_metacharacter_urls_are_refused_and_never_run(self):
        marker = os.path.join(tempfile.gettempdir(), "routineos-pwn-marker")
        if os.path.exists(marker):
            os.remove(marker)
        evil = f'https://a.example/"; touch {marker}; "'
        res, _ = self.run_script("shopify-content-qa/lib/discover.py", ["--store", evil], ["--out", "TMP/p.json", "--docs", "TMP/none.json", "--producer", "shopify-content-qa"])
        self.assertEqual(res.returncode, 2, res.stderr)
        self.assertIn("plain https URL", res.stderr)
        self.assertFalse(os.path.exists(marker))

    def test_file_arguments_reach_the_script(self):
        # an arg file with a value containing spaces and quotes arrives as one argument, so it is refused by the
        # URL check, not split or expanded by a shell
        res, _ = self.run_script("site-compliance-review/lib/fetch_results.py", ["--worker", "https://w.example", "--site", 'https://a.example/a "b" $HOME'], ["--docs", "TMP/none.json", "--producer", "x", "--out", "TMP/r.json"])
        self.assertEqual(res.returncode, 2, res.stderr)
        self.assertIn("plain https URL", res.stderr)


if __name__ == "__main__":
    unittest.main()
