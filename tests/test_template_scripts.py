"""Each template lib/ script on synthetic input, run as a subprocess with -I (isolated mode)."""
import json
import os
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def script(template, name):
    return os.path.join(ROOT, "templates", template, "lib", name)


class ScriptCase(unittest.TestCase):
    TEMPLATE = NAME = None

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()

    def put(self, name, data):
        path = os.path.join(self.d, name)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(data if isinstance(data, str) else json.dumps(data))
        return path

    def run_script(self, *args):
        return subprocess.run([sys.executable, "-I", script(self.TEMPLATE, self.NAME), *args],
                              capture_output=True, text=True, cwd=self.d)

    def ok_json(self, *args):
        res = self.run_script(*args)
        self.assertEqual(res.returncode, 0, res.stderr)
        return json.loads(res.stdout)

    def assert_input_error(self, *args, hidden=None):
        res = self.run_script(*args)
        self.assertEqual(res.returncode, 2, res.stdout + res.stderr)
        self.assertEqual(res.stdout, "")
        if hidden:
            self.assertNotIn(hidden, res.stderr)


class WeekOverWeekTests(ScriptCase):
    TEMPLATE, NAME = "weekly-marketing-report", "week_over_week.py"

    def test_change_per_channel_and_metric(self):
        this = self.put("this.json", {"search": {"clicks": 150, "spend": 90.5}, "social": {"clicks": 10}})
        last = self.put("last.json", {"search": {"clicks": 100, "spend": 0}, "email-news": {"opens": 40}})
        out = self.ok_json("--this", this, "--last", last)
        self.assertEqual(out["search"]["clicks"], {"value": 150, "previous": 100, "change_pct": 50.0})
        self.assertEqual(out["search"]["spend"], {"value": 90.5, "previous": 0, "change_pct": None})
        self.assertEqual(out["social"]["clicks"], {"value": 10, "previous": None, "change_pct": None})
        self.assertEqual(out["email-news"]["opens"], {"value": None, "previous": 40, "change_pct": None})

    def test_a_drop_is_negative_and_rounded(self):
        this = self.put("this.json", {"a": {"m": 2}})
        last = self.put("last.json", {"a": {"m": 3}})
        self.assertEqual(self.ok_json("--this", this, "--last", last)["a"]["m"]["change_pct"], -33.3)

    def test_bad_input_is_refused_without_echo(self):
        last = self.put("last.json", {})
        self.assert_input_error("--this", self.put("t.json", {"a": {"m": "secret-ish"}}), "--last", last,
                                hidden="secret-ish")
        self.assert_input_error("--this", self.put("b.json", {"a": {"m": True}}), "--last", last)
        self.assert_input_error("--this", self.put("c.json", "not json"), "--last", last)
        self.assert_input_error("--this", os.path.join(self.d, "missing.json"), "--last", last)

    def test_non_finite_numbers_are_refused(self):
        # json.load reads NaN and Infinity; printed back they are not JSON.
        last = self.put("last.json", {})
        for word in ("NaN", "Infinity"):
            self.assert_input_error("--this", self.put("t.json", '{"a": {"m": %s}}' % word), "--last", last)


class GroupQuestionsTests(ScriptCase):
    TEMPLATE, NAME = "support-gap-digest", "group_questions.py"

    def test_groups_by_normalised_form(self):
        path = self.put("q.json", [
            {"ref": "t1", "text": "How do I reset my password?"},
            {"ref": "t2", "text": "how do i   reset my password"},
            {"ref": "t3", "text": "Where is the invoice?"},
            {"ref": "t4", "text": "HOW DO I RESET MY PASSWORD!!"},
            {"ref": "t5", "text": "Can I export data?"},
            {"ref": "t6", "text": "?!"},
        ])
        out = self.ok_json("--in", path)
        self.assertEqual(out[0], {"key": "how do i reset my password", "count": 3, "refs": ["t1", "t2", "t4"],
                                  "example": "How do I reset my password?"})
        self.assertEqual([g["key"] for g in out[1:]], ["can i export data", "where is the invoice"])
        self.assertEqual(sum(g["count"] for g in out), 5)

    def test_bad_input_is_refused(self):
        self.assert_input_error("--in", self.put("q.json", {"ref": "x"}))
        self.assert_input_error("--in", self.put("q2.json", [{"ref": "x", "text": 3}]))


class InvoiceChecksTests(ScriptCase):
    TEMPLATE, NAME = "invoice-exceptions", "invoice_checks.py"

    def invoices(self):
        return [
            {"ref": "i1", "vendor_domain": "acme.example", "number": "A-1", "amount": 100, "issued": "2026-10-01"},
            {"ref": "i2", "vendor_domain": "ACME.example", "number": "A-1", "amount": 120, "issued": "2026-10-02"},
            {"ref": "i3", "vendor_domain": "acme.example", "number": "A-9", "amount": 100, "issued": "2026-10-01"},
            {"ref": "i4", "vendor_domain": "newco.example", "number": "N-1", "amount": 5000, "issued": "2026-10-03"},
            {"ref": "i5", "vendor_domain": "acme.example", "number": "A-2", "amount": 50, "issued": "2026-10-04"},
        ]

    def test_flags(self):
        out = self.ok_json("--invoices", self.put("i.json", self.invoices()),
                           "--vendors", self.put("v.json", ["acme.example"]), "--threshold", "1000")
        self.assertEqual(out["checked"], 5)
        flags = {f["ref"]: f["flags"] for f in out["flagged"]}
        self.assertEqual(flags, {"i1": ["duplicate"], "i2": ["duplicate"], "i3": ["duplicate"],
                                 "i4": ["over_threshold", "new_vendor"]})
        self.assertEqual([f["ref"] for f in out["flagged"]], ["i1", "i2", "i3", "i4"])

    def test_amount_equal_to_threshold_is_not_over(self):
        inv = [{"ref": "i1", "vendor_domain": "a.example", "number": "1", "amount": 1000, "issued": "2026-10-01"}]
        out = self.ok_json("--invoices", self.put("i.json", inv), "--vendors", self.put("v.json", ["a.example"]),
                           "--threshold", "1000")
        self.assertEqual(out["flagged"], [])

    def test_bad_input_is_refused(self):
        vendors = self.put("v.json", [])
        bad = self.invoices()
        bad[0]["amount"] = "100"
        self.assert_input_error("--invoices", self.put("i.json", bad), "--vendors", vendors, "--threshold", "1")
        self.assert_input_error("--invoices", self.put("i2.json", self.invoices()), "--vendors", vendors,
                                "--threshold", "lots")

    def test_non_finite_amount_or_threshold_is_refused(self):
        # A NaN compares false with everything, so it would pass every check unflagged.
        vendors = self.put("v.json", ["acme.example"])
        for word in ("nan", "inf"):
            self.assert_input_error("--invoices", self.put("i.json", self.invoices()), "--vendors", vendors,
                                    "--threshold", word)
        raw = json.dumps(self.invoices()).replace('"amount": 5000', '"amount": NaN')
        self.assert_input_error("--invoices", self.put("n.json", raw), "--vendors", vendors, "--threshold", "1000")


class ScoreRubricTests(ScriptCase):
    TEMPLATE, NAME = "candidate-shortlist", "score_rubric.py"

    def test_scores(self):
        criteria = self.put("c.json", {"python": 2, "commerce": 1, "remote": 1})
        marks = self.put("m.json", [
            {"ref": "c1", "marks": {"python": "met", "commerce": "partly", "remote": "not"}},
            {"ref": "c2", "marks": {"python": "met", "commerce": "met", "remote": "met"}},
            {"ref": "c3", "marks": {"python": "not", "commerce": "not", "remote": "not"}},
        ])
        out = self.ok_json("--criteria", criteria, "--marks", marks)
        self.assertEqual(out, [{"ref": "c2", "score": 100}, {"ref": "c1", "score": 63}, {"ref": "c3", "score": 0}])

    def test_unknown_or_missing_marks_are_errors(self):
        criteria = self.put("c.json", {"python": 1})
        self.assert_input_error("--criteria", criteria, "--marks",
                                self.put("m.json", [{"ref": "c1", "marks": {"python": "maybe"}}]))
        self.assert_input_error("--criteria", criteria, "--marks", self.put("m2.json", [{"ref": "c1", "marks": {}}]))
        self.assert_input_error("--criteria", criteria, "--marks",
                                self.put("m3.json", [{"ref": "c1", "marks": {"python": "met", "age": "met"}}]))
        self.assert_input_error("--criteria", self.put("c2.json", {"python": 0}), "--marks",
                                self.put("m4.json", [{"ref": "c1", "marks": {"python": "met"}}]))

    def test_infinite_weight_is_an_input_error_not_a_crash(self):
        self.assert_input_error("--criteria", self.put("c.json", '{"python": Infinity}'), "--marks",
                                self.put("m.json", [{"ref": "c1", "marks": {"python": "met"}}]))


class CheckCitationsTests(ScriptCase):
    TEMPLATE, NAME = "content-calendar", "check_citations.py"

    def test_clean_draft_passes(self):
        draft = self.put("d.md", "Fact one [1]. Fact two [2] and again [1].\n")
        sources = self.put("s.json", [{"n": 1, "url": "https://example.org/a"}, {"n": 2, "url": "https://example.org/b"}])
        res = self.run_script("--draft", draft, "--sources", sources)
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
        self.assertIn("3 markers, 2 sources", res.stdout)

    def test_problems_exit_1(self):
        draft = self.put("d.md", "Fact [1]. Claim [3].\n")
        sources = self.put("s.json", [{"n": 1, "url": "https://example.org/a"}, {"n": 2, "url": "https://example.org/b"}])
        res = self.run_script("--draft", draft, "--sources", sources)
        self.assertEqual(res.returncode, 1)
        self.assertIn("marker [3] has no source", res.stdout)
        self.assertIn("source 2 is never cited", res.stdout)

    def test_duplicate_source_and_bad_input(self):
        draft = self.put("d.md", "Fact [1].\n")
        res = self.run_script("--draft", draft, "--sources",
                              self.put("s.json", [{"n": 1, "url": "https://example.org/a"},
                                                  {"n": 1, "url": "https://example.org/b"}]))
        self.assertEqual(res.returncode, 1)
        self.assertIn("source 1 is listed more than once", res.stdout)
        self.assert_input_error("--draft", draft, "--sources", self.put("s2.json", [{"n": "1"}]))


class StaleItemsTests(ScriptCase):
    TEMPLATE, NAME = "engineering-digest", "stale_items.py"

    def test_age_and_stale(self):
        items = self.put("i.json", [
            {"ref": "pr-1", "updated": "2026-10-29"},
            {"ref": "pr-2", "updated": "2026-10-20T08:30:00Z"},
            {"ref": "pr-3", "updated": "2026-10-23"},
        ])
        out = self.ok_json("--in", items, "--today", "2026-10-30", "--stale-after", "7")
        self.assertEqual(out, [
            {"ref": "pr-2", "updated": "2026-10-20T08:30:00Z", "age_days": 10, "stale": True},
            {"ref": "pr-3", "updated": "2026-10-23", "age_days": 7, "stale": False},
            {"ref": "pr-1", "updated": "2026-10-29", "age_days": 1, "stale": False},
        ])

    def test_bad_input_is_refused(self):
        items = self.put("i.json", [{"ref": "pr-1", "updated": "yesterday"}])
        self.assert_input_error("--in", items, "--today", "2026-10-30", "--stale-after", "7")
        good = self.put("g.json", [{"ref": "pr-1", "updated": "2026-10-01"}])
        self.assert_input_error("--in", good, "--today", "today", "--stale-after", "7")
        self.assert_input_error("--in", good, "--today", "2026-10-30", "--stale-after", "-1")


if __name__ == "__main__":
    unittest.main()
