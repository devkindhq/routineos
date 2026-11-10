"""Spec pages in a producer's definition.json (desk.pages): lint and compile."""
import copy
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "skills", "routineos", "scripts"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import definition  # noqa: E402

EM_DASH = chr(0x2014)

TYPES = {
    "metric": {"label": "Metric", "plural": "Metrics", "identity": "field:key",
               "fields": {"key": {"type": "text"}, "source": {"type": "text"}, "name": {"type": "text"},
                          "week": {"type": "date"}, "value": {"type": "number"}}},
    "audit": {"label": "Audit", "plural": "Audits", "identity": "field:url",
              "fields": {"url": {"type": "url"}, "title": {"type": "text"}}},
}

QUERY = {"type": "metric", "where": [["name", "==", "sessions"]], "window": {"last": {"n": 12, "unit": "weeks"}},
         "groupBy": "source", "x": "week", "aggregate": {"op": "sum", "field": "value"}}

PAGE = {
    "id": "overview",
    "title": "Overview",
    "nav": {"label": "Overview", "icon": "list"},
    "controls": ["refresh", "dateRange", "filter"],
    "filter": {"field": "source", "label": "Source"},
    "blocks": [
        {"id": "sessions", "kind": "tile", "label": "Sessions", "sparkline": True, "format": "number",
         "span": {"base": 12, "md": 4},
         "query": {"type": "metric", "where": [["name", "==", "sessions"]], "window": {"last": {"n": 12, "unit": "weeks"}},
                   "x": "week", "aggregate": {"op": "latest", "field": "value"}}},
        {"id": "trend", "kind": "chart", "type": "line", "title": "Sessions by source", "span": {"md": 8}, "query": QUERY},
        {"id": "share", "kind": "chart", "type": "shareBar", "title": "Share", "query": QUERY},
        {"id": "audits", "kind": "table", "title": "Audited pages", "columns": ["url", "title"],
         "query": {"type": "audit", "orderBy": ["title", "asc"], "limit": 20}},
        {"id": "readme", "kind": "text", "heading": "About", "text": "Numbers update after each weekly run."},
    ],
}


def defn(*pages):
    return {"version": 1, "label": "Marketing", "inbox": False, "types": copy.deepcopy(TYPES),
            "desk": {"pages": [copy.deepcopy(p) for p in pages]}}


def page(**over):
    p = copy.deepcopy(PAGE)
    p.update(over)
    return p


def block_problems(**over):
    p = copy.deepcopy(PAGE)
    p["blocks"][1] = dict(p["blocks"][1], **over)
    return definition.lint(defn(p), [])


def says(found, text):
    return [x for x in found if text in x]


class PageLint(unittest.TestCase):
    def test_example_page_is_clean(self):
        self.assertEqual(definition.lint(defn(PAGE), []), [])

    def test_every_problem_names_the_page(self):
        found = definition.lint(defn(page(title="")), [])
        self.assertTrue(found)
        self.assertTrue(all(x.startswith("desk.pages.overview: ") for x in found), found)

    def test_unknown_block_kind(self):
        found = block_problems(kind="gauge")
        self.assertTrue(says(found, "kind 'gauge'"), found)

    def test_unknown_chart_type(self):
        self.assertTrue(says(block_problems(type="pie"), "chart type 'pie'"))

    def test_unknown_query_type(self):
        q = dict(QUERY, type="nope")
        self.assertTrue(says(block_problems(query=q), "undeclared type 'nope'"))

    def test_where_on_unknown_field_but_meta_allowed(self):
        self.assertTrue(says(block_problems(query=dict(QUERY, where=[["nope", "==", 1]])), "undeclared field 'nope'"))
        self.assertEqual(block_problems(query=dict(QUERY, where=[["lastSeen", ">=", "2026-01-01"]])), [])

    def test_where_operator_checked(self):
        self.assertTrue(says(block_problems(query=dict(QUERY, where=[["name", "like", "x"]])), "operator 'like'"))

    def test_aggregate_field_must_be_a_number_except_count(self):
        bad = dict(QUERY, aggregate={"op": "sum", "field": "source"})
        self.assertTrue(says(block_problems(query=bad), "not a number field"))
        ok = dict(QUERY, aggregate={"op": "count", "field": "source"})
        self.assertEqual(block_problems(query=ok), [])
        self.assertEqual(block_problems(query=dict(QUERY, aggregate={"op": "count"})), [])

    def test_aggregate_op_checked(self):
        self.assertTrue(says(block_problems(query=dict(QUERY, aggregate={"op": "median", "field": "value"})), "aggregate op"))

    def test_built_in_and_retired_ids_refused(self):
        for bad in ("today", "settings", "entity", "inbox", "views"):
            self.assertTrue(says(definition.lint(defn(page(id=bad)), []), "built-in page"), bad)

    def test_never_learnable_words_refused(self):
        self.assertTrue(says(definition.lint(defn(page(id="send-report")), []), "never touches"))

    def test_id_equal_to_a_module_id_refused(self):
        d = defn(page(id="recent"))
        d["desk"]["modules"] = [{"id": "recent", "kind": "view", "label": "Recent", "view": {"type": "metric"}}]
        self.assertTrue(says(definition.lint(d, []), "is also a desk module id"), definition.lint(d, []))

    def test_page_needs_a_title(self):
        for bad in ("", "  ", None, 3):
            self.assertTrue(says(definition.lint(defn(page(title=bad)), []), "title"), bad)
        p = page()
        del p["title"]
        self.assertTrue(says(definition.lint(defn(p), []), "title"))

    def test_html_keys_refused_at_any_depth(self):
        found = block_problems(bodyHtml="<b>x</b>")
        self.assertTrue(says(found, "bodyHtml"), found)
        deep = copy.deepcopy(PAGE)
        deep["blocks"][0]["query"]["whereHtml"] = "x"
        self.assertTrue(says(definition.lint(defn(deep), []), "whereHtml"))

    def test_code_keys_refused(self):
        for key in definition.CODE_KEYS:
            found = block_problems(**{key: "x"})
            self.assertTrue(says(found, f"'{key}' would carry code") or says(found, key), (key, found))

    def test_em_dash_and_banned_words_in_copy(self):
        self.assertTrue(says(definition.lint(defn(page(title="Sessions " + EM_DASH + " all")), []), "em dash"))
        self.assertTrue(says(definition.lint(defn(page(title="Magic page")), []), "not Desk copy"))
        self.assertTrue(says(block_problems(title="A " + EM_DASH + " B"), "em dash"))

    def test_span_range(self):
        for bad in ({"base": 0}, {"md": 13}, {"base": "x"}, {"xl": 4}, "wide"):
            self.assertTrue(says(block_problems(span=bad), "span"), bad)
        self.assertEqual(block_problems(span={"base": 1, "md": 12}), [])

    def test_unknown_control(self):
        self.assertTrue(says(definition.lint(defn(page(controls=["export"])), []), "control 'export'"))

    def test_filter_control_needs_a_filter_field(self):
        p = page()
        del p["filter"]
        self.assertTrue(says(definition.lint(defn(p), []), "filter"))
        self.assertTrue(says(definition.lint(defn(page(filter={"field": "nope", "label": "X"})), []), "undeclared field 'nope'"))

    def test_unknown_page_key_and_bad_shape(self):
        self.assertTrue(says(definition.lint(defn(page(theme="x")), []), "unknown key 'theme'"))
        self.assertTrue(definition.lint(dict(defn(), desk={"pages": "x"}), []))
        self.assertTrue(says(definition.lint(defn(page(blocks="x")), []), "blocks"))

    def test_duplicate_ids(self):
        self.assertTrue(says(definition.lint(defn(PAGE, PAGE), []), "more than once"))
        p = copy.deepcopy(PAGE)
        p["blocks"][1]["id"] = p["blocks"][0]["id"]
        self.assertTrue(says(definition.lint(defn(p), []), "block 'sessions'"))

    def test_window_and_limit_checked(self):
        self.assertTrue(says(block_problems(query=dict(QUERY, window={"last": {"n": 0, "unit": "weeks"}})), "window"))
        self.assertTrue(says(block_problems(query=dict(QUERY, window={"last": {"n": 2, "unit": "years"}})), "window"))
        self.assertEqual(block_problems(query=dict(QUERY, window="range")), [])
        self.assertTrue(says(block_problems(query=dict(QUERY, limit=0)), "limit"))

    def test_chart_and_tile_need_x_and_aggregate(self):
        q = {k: v for k, v in QUERY.items() if k != "x"}
        self.assertTrue(says(block_problems(query=q), "query.x"))
        q = {k: v for k, v in QUERY.items() if k != "aggregate"}
        self.assertTrue(says(block_problems(query=q), "aggregate"))

    def test_format_checked(self):
        self.assertTrue(says(block_problems(format="roman"), "format"))

    def test_tile_has_no_group_by(self):
        p = copy.deepcopy(PAGE)
        p["blocks"][0]["query"]["groupBy"] = "source"
        self.assertTrue(says(definition.lint(defn(p), []), "tile"))

    def test_table_columns_checked(self):
        p = copy.deepcopy(PAGE)
        p["blocks"][3]["columns"] = ["url", "nope"]
        self.assertTrue(says(definition.lint(defn(p), []), "undeclared field 'nope'"))


class PageLintHardening(unittest.TestCase):
    """Values the client cannot draw or that silently match nothing are refused at lint."""

    def test_window_size_is_bounded(self):
        for n, unit in ((3661, "days"), (521, "weeks"), (10 ** 12, "days")):
            q = dict(QUERY, window={"last": {"n": n, "unit": unit}})
            self.assertTrue(says(block_problems(query=q), "window"), (n, unit))
        for n, unit in ((3660, "days"), (520, "weeks")):
            q = dict(QUERY, window={"last": {"n": n, "unit": unit}})
            self.assertEqual(block_problems(query=q), [], (n, unit))

    def test_in_needs_a_list(self):
        for op in ("in", "not-in"):
            q = dict(QUERY, where=[["source", op, "a"]])
            self.assertTrue(says(block_problems(query=q), "needs a list"), op)
            self.assertEqual(block_problems(query=dict(QUERY, where=[["source", op, ["a"]]])), [])

    def test_table_window_needs_x(self):
        p = copy.deepcopy(PAGE)
        p["blocks"][3]["query"]["window"] = {"last": {"n": 4, "unit": "weeks"}}
        self.assertTrue(says(definition.lint(defn(p), []), "needs query.x"))
        p["blocks"][3]["query"]["window"] = "range"
        self.assertTrue(says(definition.lint(defn(p), []), "needs query.x"))

    def test_x_must_be_a_date_field(self):
        self.assertTrue(says(block_problems(query=dict(QUERY, x="source")), "not a date field"))
        self.assertEqual(block_problems(query=dict(QUERY, x="lastSeen")), [])

    def test_filter_field_must_belong_to_a_queried_type(self):
        p = copy.deepcopy(PAGE)
        p["filter"] = {"field": "url", "label": "Page"}
        p["blocks"] = [b for b in p["blocks"] if b["id"] != "audits"]
        self.assertTrue(says(definition.lint(defn(p), []), "no block on this page"))
        self.assertEqual(definition.lint(defn(PAGE), []), [])

    def test_range_window_needs_the_date_range_control(self):
        p = page(controls=["refresh", "filter"])
        p["blocks"][1]["query"] = dict(QUERY, window="range")
        self.assertTrue(says(definition.lint(defn(p), []), "dateRange"))
        p["controls"] = ["dateRange"]
        self.assertFalse(says(definition.lint(defn(p), []), "dateRange"))

    def test_duplicate_columns_refused(self):
        p = copy.deepcopy(PAGE)
        p["blocks"][3]["columns"] = ["url", "url"]
        self.assertTrue(says(definition.lint(defn(p), []), "more than once"))

    def test_flags_and_target_are_typed(self):
        p = copy.deepcopy(PAGE)
        p["blocks"][0]["sparkline"] = "yes"
        self.assertTrue(says(definition.lint(defn(p), []), "sparkline"))
        p = copy.deepcopy(PAGE)
        p["blocks"][3]["link"] = "record"
        self.assertTrue(says(definition.lint(defn(p), []), "link"))
        for bad in (float("nan"), float("inf")):
            self.assertTrue(says(block_problems(target=bad), "target"), bad)
        self.assertEqual(block_problems(target=5), [])

    def test_limit_only_on_a_table(self):
        self.assertTrue(says(block_problems(query=dict(QUERY, limit=5)), "only for a table"))


class PageCompile(unittest.TestCase):
    def producers(self, a, b=None):
        out = [{"id": "alpha", "label": "Alpha", "schedule": "", "definition": a}]
        if b is not None:
            out.append({"id": "beta", "label": "Beta", "schedule": "", "definition": b})
        return out

    def test_pages_are_compiled_with_their_producer(self):
        compiled = definition.compile(self.producers(defn(PAGE)))
        pages = compiled["desk"]["pages"]
        self.assertEqual(len(pages), 1)
        self.assertEqual(pages[0]["producer"], "alpha")
        self.assertEqual(pages[0]["blocks"], PAGE["blocks"])

    def test_no_pages_compiles_as_before(self):
        d = defn()
        del d["desk"]
        self.assertNotIn("desk", definition.compile(self.producers(d)))

    def test_same_page_id_across_producers_refused(self):
        with self.assertRaises(definition.DefinitionError) as ctx:
            definition.compile(self.producers(defn(PAGE), defn(PAGE)))
        self.assertTrue(says(ctx.exception.problems, "desk page 'overview' is declared by alpha and beta"), ctx.exception.problems)

    def test_page_id_equal_to_a_module_id_in_another_producer_refused(self):
        mod = defn()
        mod["desk"] = {"modules": [{"id": "recent", "kind": "view", "label": "Recent", "view": {"type": "metric"}}]}
        with self.assertRaises(definition.DefinitionError) as ctx:
            definition.compile(self.producers(defn(page(id="recent")), mod))
        self.assertTrue(says(ctx.exception.problems, "desk page 'recent' is also a desk module id"), ctx.exception.problems)


if __name__ == "__main__":
    unittest.main()
