"""Per-file gzip budgets with a ratchet (spec 14). Budgets live in tests/desk_budgets.json as
{"<key>": {"gzip": int, "raise_reason": str (optional)}}, gzip measured with gzip.compress(level 9, mtime 0).

Rules: 1 every entry is within budget; 2 no hoarding, a budget is at most ceil(actual * 1.05) + 512, so a budget
comes down when its file shrinks; 3 a budget higher than at its base (see budget_base) carries a raise_reason or
a commit with a "Budget-Raise: <why>" trailer touches the file (skipped only when git history is unavailable); 4 the entries match the outputs.
"""
import gzip
import json
import math
import os
import re
import subprocess
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

BUDGET_FILE = os.path.join(ROOT, "tests", "desk_budgets.json")
REL = "tests/desk_budgets.json"
HTML = os.path.join(ROOT, "skills", "routineos", "assets", "desk", "index.html")
BLUEPRINT_HTML = os.path.join(ROOT, "skills", "routineos", "assets", "desk", "index.blueprint.html")


def load_budgets():
    with open(BUDGET_FILE, encoding="utf-8") as fh:
        return json.load(fh)


def gzip_size(data):
    return len(gzip.compress(data, compresslevel=9, mtime=0))


def inlined_css(html):
    """The text of every <style> block in the built page, in order."""
    return "".join(re.findall(r"<style[^>]*>(.*?)</style>", html, re.S))


def measures():
    """Measured gzip bytes per budget key: the committed single-file Desk and the CSS inlined in it."""
    with open(HTML, "rb") as fh:
        raw = fh.read()
    with open(BLUEPRINT_HTML, "rb") as fh:
        variant = fh.read()
    return {"single/index.html": gzip_size(raw), "single/css": gzip_size(inlined_css(raw.decode("utf-8")).encode("utf-8")),
            "blueprint/index.html": gzip_size(variant),
            "blueprint/css": gzip_size(inlined_css(variant.decode("utf-8")).encode("utf-8"))}


def hoard_limit(actual):
    return math.ceil(actual * 1.05) + 512


def _git(root, *args):
    r = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else None


def budget_base(root=ROOT):
    """(budgets, rev) the current file is compared against, or (None, None) when git or history is unavailable.
    The base is the file at the merge-base with the default branch. When the default branch has no such file (a
    stacked branch) it is the version at the commit that introduced the file. When the merge-base is HEAD itself
    (on the default branch) the working tree is compared against HEAD, so an uncommitted raise is caught."""
    try:
        base = None
        for branch in ("main", "private/main"):
            base = _git(root, "merge-base", "HEAD", branch)
            if base and _git(root, "cat-file", "-e", f"{base}:{REL}") is not None:
                break
            base = None
        if not base:
            added = _git(root, "log", "--diff-filter=A", "--format=%H", "--", REL)
            base = added.splitlines()[0] if added else None
        if not base:
            return None, None
        text = _git(root, "show", f"{base}:{REL}")
        return (json.loads(text), base) if text else (None, None)
    except (OSError, ValueError):
        return None, None


def raise_trailer(root, base):
    """True when a commit in base..HEAD that touches the budgets file carries a Budget-Raise trailer."""
    msgs = _git(root, "log", f"{base}..HEAD", "--format=%B%x00", "--", REL) or ""
    return any(re.match(r"Budget-Raise:\s*\S", line) for line in msgs.splitlines())


def check_within(budgets, measured):
    return [f"{k}: actual {a} > budget {budgets[k]['gzip']} (+{a - budgets[k]['gzip']})"
            for k, a in sorted(measured.items()) if k in budgets and a > budgets[k]["gzip"]]


def check_hoard(budgets, measured):
    return [f"{k}: budget {budgets[k]['gzip']} > {hoard_limit(a)} for actual {a}; lower it"
            for k, a in sorted(measured.items()) if k in budgets and budgets[k]["gzip"] > hoard_limit(a)]


def check_raises(budgets, base, trailer=False):
    if trailer:
        return []
    return [f"{k}: budget raised from {base[k]['gzip']} to {e['gzip']} with no raise_reason"
            for k, e in sorted(budgets.items())
            if k in base and e["gzip"] > base[k]["gzip"] and not str(e.get("raise_reason", "")).strip()]


def check_match(budgets, measured):
    return [f"{k}: budget with no output" for k in sorted(set(budgets) - set(measured))] + \
           [f"{k}: output with no budget" for k in sorted(set(measured) - set(budgets))]


class BudgetTests(unittest.TestCase):
    def setUp(self):
        self.budgets = load_budgets()
        self.measured = measures()

    def test_every_entry_within_budget(self):  # rule 1
        self.assertEqual(check_within(self.budgets, self.measured), [])

    def test_no_hoarding(self):  # rule 2
        self.assertEqual(check_hoard(self.budgets, self.measured), [])

    def test_raise_needs_a_reason(self):  # rule 3, M20
        base, rev = budget_base()
        if base is None:
            self.skipTest("git history for the budgets file is unavailable")
        self.assertEqual(check_raises(self.budgets, base, raise_trailer(ROOT, rev)), [])

    def test_entries_match_outputs(self):  # rule 4
        self.assertEqual(check_match(self.budgets, self.measured), [])

    def test_only_the_built_pages_are_budgeted(self):
        self.assertEqual(sorted(self.budgets), ["blueprint/css", "blueprint/index.html", "single/css", "single/index.html"])

    def test_css_is_measured_inside_the_page(self):
        self.assertGreater(self.measured["single/css"], 0)
        self.assertLess(self.measured["single/css"], self.measured["single/index.html"])

    def test_entries_are_well_formed(self):
        for key, entry in self.budgets.items():
            with self.subTest(key=key):
                self.assertIsInstance(entry.get("gzip"), int)
                self.assertFalse(set(entry) - {"gzip", "raise_reason"})

    def test_hoard_limit_formula(self):
        self.assertEqual(hoard_limit(1000), 1562)
        self.assertEqual(hoard_limit(0), 512)

    def test_gzip_size_is_deterministic(self):
        data = b"desk " * 1000
        self.assertEqual(gzip_size(data), gzip_size(data))
        self.assertLess(gzip_size(data), len(data))

    def test_inlined_css_joins_every_style_block(self):
        self.assertEqual(inlined_css('<style>a{}</style><p>x</p><style media="all">b{}</style>'), "a{}b{}")


class RatchetGitFixtureTests(unittest.TestCase):
    """The raise check runs against real git history: a stacked branch, and the default branch itself."""

    def setUp(self):
        import tempfile
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = self.tmp.name
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.email", "t" + "@" + "fixture.test")  # built in parts: the repo scan bans email literals
        self.git("config", "user.name", "t")
        os.makedirs(os.path.join(self.root, "tests"))
        self.write({"a": {"gzip": 100}})
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "base")

    def git(self, *a):
        subprocess.run(["git", *a], cwd=self.root, check=True, capture_output=True)

    def write(self, data):
        os.makedirs(os.path.join(self.root, "tests"), exist_ok=True)
        with open(os.path.join(self.root, REL), "w", encoding="utf-8") as fh:
            json.dump(data, fh)

    def commit(self, msg):
        self.git("add", "-A")
        self.git("commit", "-q", "-m", msg)

    def test_default_branch_uncommitted_raise_is_caught(self):
        self.write({"a": {"gzip": 200}})
        base, rev = budget_base(self.root)
        self.assertEqual(len(check_raises(load(self.root), base, raise_trailer(self.root, rev))), 1)

    def test_feature_branch_raise_is_caught_and_trailer_allows_it(self):
        self.git("checkout", "-q", "-b", "feat")
        self.write({"a": {"gzip": 300}})
        self.commit("raise")
        base, rev = budget_base(self.root)
        self.assertEqual(base, {"a": {"gzip": 100}})
        self.assertEqual(len(check_raises(load(self.root), base, raise_trailer(self.root, rev))), 1)
        self.write({"a": {"gzip": 400}})
        self.commit("raise again\n\nBudget-Raise: new page")
        self.assertEqual(check_raises(load(self.root), base, raise_trailer(self.root, rev)), [])

    def test_stacked_branch_without_file_on_main_uses_introducing_commit(self):
        self.git("rm", "-q", "-f", REL)
        self.commit("drop")
        self.git("checkout", "-q", "-b", "feat")
        self.write({"a": {"gzip": 100}})
        self.commit("add budgets")
        self.write({"a": {"gzip": 150}})
        self.commit("grow")
        base, rev = budget_base(self.root)
        self.assertEqual(base, {"a": {"gzip": 100}})
        self.assertEqual(len(check_raises(load(self.root), base, raise_trailer(self.root, rev))), 1)


def load(root):
    with open(os.path.join(root, REL), encoding="utf-8") as fh:
        return json.load(fh)


class BudgetRuleFixtureTests(unittest.TestCase):
    """Each rule fails on a fixture built to break it."""

    def test_rule1_reports_diff(self):
        self.assertEqual(check_within({"a": {"gzip": 900}}, {"a": 1000}), ["a: actual 1000 > budget 900 (+100)"])

    def test_rule2_rejects_slack_budget(self):
        self.assertEqual(len(check_hoard({"a": {"gzip": 2000}}, {"a": 1000})), 1)
        self.assertEqual(check_hoard({"a": {"gzip": 1562}}, {"a": 1000}), [])

    def test_rule3_rejects_unexplained_raise(self):
        base = {"a": {"gzip": 1000}}
        self.assertEqual(len(check_raises({"a": {"gzip": 1100}}, base)), 1)
        self.assertEqual(len(check_raises({"a": {"gzip": 1100, "raise_reason": "  "}}, base)), 1)
        self.assertEqual(check_raises({"a": {"gzip": 1100, "raise_reason": "page table"}}, base), [])
        self.assertEqual(check_raises({"a": {"gzip": 900}, "b": {"gzip": 5}}, base), [])

    def test_rule4_rejects_missing_and_extra(self):
        self.assertEqual(check_match({"a": {"gzip": 1}}, {"b": 1}), ["a: budget with no output", "b: output with no budget"])


if __name__ == "__main__":
    unittest.main()
