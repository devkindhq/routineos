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


BOARD_TYPES = {
    "draft": {"label": "Draft", "plural": "Drafts", "identity": "field:title",
              "fields": {"title": {"type": "text"}, "status": {"type": "choice", "choices": ["idea", "ready", "live"]},
                         "channel": {"type": "text"}, "summary": {"type": "text"}, "updated": {"type": "date"},
                         "note": {"type": "text"}, "views": {"type": "number"}}},
}

BOARD = {"id": "drafts", "kind": "board", "title": "Drafts by status",
         "query": {"type": "draft", "groupBy": "status", "where": [["channel", "==", "blog"]],
                   "orderBy": ["updated", "desc"], "limit": 20},
         "columns": [{"value": "idea", "title": "Ideas"}, {"value": "ready"}],
         "card": {"title": "title", "badges": ["channel"], "text": "summary"}, "link": True}


def board_defn(block):
    return {"version": 1, "label": "Content", "inbox": False, "types": copy.deepcopy(BOARD_TYPES),
            "desk": {"pages": [{"id": "boards", "title": "Boards", "blocks": [block]}]}}


def board_problems(**over):
    blk = copy.deepcopy(BOARD)
    for k, v in over.items():
        if v is DROP:
            blk.pop(k, None)
        else:
            blk[k] = v
    return definition.lint(board_defn(blk), [])


DROP = object()


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

    def test_limit_only_on_a_table_or_board(self):
        for kind, extra in (("tile", {"label": "L"}), ("chart", {"type": "line"})):
            blk = dict({"id": "b1", "kind": kind, "query": dict(QUERY, limit=5)}, **extra)
            found = definition.lint(defn(page(blocks=[blk])), [])
            self.assertTrue(says(found, "query.limit is only for a table or board"), (kind, found))
        tbl = {"id": "b1", "kind": "table", "columns": ["url"], "query": {"type": "audit", "limit": 5}}
        self.assertEqual(definition.lint(defn(page(blocks=[tbl], controls=[], filter=None)), []), [])
        self.assertEqual(board_problems(), [])


class BoardLint(unittest.TestCase):
    def test_board_lint_accepts_spec_example(self):
        self.assertEqual(board_problems(), [])

    def test_board_without_columns_uses_choices(self):
        self.assertEqual(board_problems(columns=DROP), [])

    def test_board_invalid_groupby(self):
        q = BOARD["query"]
        self.assertTrue(says(board_problems(query={k: v for k, v in q.items() if k != "groupBy"}), "groupBy"))
        self.assertTrue(says(board_problems(query=dict(q, groupBy="nope")), "query.groupBy has undeclared field 'nope'"))
        found = board_problems(query=dict(q, groupBy="channel"), columns=DROP)
        self.assertTrue(says(found, "choice"), found)
        # the same non-choice field with board columns given is accepted
        self.assertEqual(board_problems(query=dict(q, groupBy="channel"), columns=[{"value": "blog"}]), [])

    def test_board_columns_and_card(self):
        self.assertTrue(says(board_problems(columns=[{"value": "idea"}, {"value": "idea"}]), "board columns"))
        self.assertTrue(says(board_problems(columns=[{"value": "archived"}]), "not one of the choices"))
        self.assertTrue(says(board_problems(columns=[{"value": "idea", "colour": "red"}]), "unknown key 'colour'"))
        self.assertTrue(says(board_problems(columns=[]), "board columns"))
        self.assertTrue(says(board_problems(card=DROP), "card"))
        self.assertTrue(says(board_problems(card={"badges": ["channel"]}), "card.title"))
        self.assertTrue(says(board_problems(card={"title": "title", "badges": ["channel"] * 4}), "at most 3"))
        self.assertTrue(says(board_problems(card={"title": "title", "text": "nope"}), "undeclared field 'nope'"))
        self.assertTrue(says(board_problems(card={"title": "title", "colour": "x"}), "unknown key 'colour'"))
        self.assertEqual(board_problems(card={"title": "title", "badges": ["channel", "views", "status"]}), [])

    def test_board_link_must_be_bool_and_window_needs_x(self):
        self.assertTrue(says(board_problems(link="yes"), "link must be true or false"))
        q = dict(BOARD["query"], window={"last": {"n": 4, "unit": "weeks"}})
        self.assertTrue(says(board_problems(query=q), "needs query.x"))
        self.assertEqual(board_problems(query=dict(q, x="updated")), [])

    def test_board_adds_no_second_message_for_a_choice_field_without_choices(self):
        # the type lint already refuses a choice field with no choices; the board lint must not repeat it
        blk = copy.deepcopy(BOARD)
        del blk["columns"]
        d = board_defn(blk)
        d["types"]["draft"]["fields"]["status"] = {"type": "choice", "choices": []}
        found = definition.lint(d, [])
        self.assertEqual(len(says(found, "choices")), 1, found)


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


def started(start, *pages):
    d = defn(*pages)
    d["desk"]["start"] = start
    return d


class DeskStartLint(unittest.TestCase):
    def test_builtin_pages_pass(self):
        for start in ("today", "approvals", "runs", "history"):
            self.assertEqual(definition.lint(started(start), []), [], start)

    def test_spec_page_passes(self):
        self.assertEqual(definition.lint(started("p/overview", PAGE), []), [])

    def test_unknown_spec_page_refused(self):
        found = definition.lint(started("p/overveiw", PAGE), [])
        self.assertTrue(says(found, "desk.start 'p/overveiw' is not a page"), found)
        self.assertTrue(says(found, "p/overview"), found)

    def test_component_shape_passes(self):
        # A page component's id is checked against desk/components/ by the routine lint, not here.
        self.assertEqual(definition.lint(started("x/review-page"), []), [])
        self.assertTrue(says(definition.lint(started("x/Not An Id"), []), "desk.start 'x/Not An Id' is not a page"))
        self.assertTrue(says(definition.lint(started("x/a/b"), []), "desk.start 'x/a/b' is not a page"))

    def test_not_a_string_refused(self):
        for bad in (None, 5, ["today"], {"page": "today"}, True):
            found = definition.lint(started(bad), [])
            self.assertTrue(says(found, "desk.start must be a page address string"), (bad, found))

    def test_unknown_value_names_value_and_choices(self):
        for bad in ("overview", "#/today", "/today", "settings", "Today", "p/", "x/", ""):
            found = definition.lint(started(bad), [])
            hit = says(found, f"desk.start '{bad}' is not a page")
            self.assertTrue(hit, (bad, found))
            self.assertIn("today, approvals, runs, history", hit[0])
            self.assertIn("x/<page component id>", hit[0])
            self.assertIn("p/<spec page id>", hit[0])

    def test_no_start_lints_as_before(self):
        self.assertEqual(definition.lint(defn(PAGE), []), [])
        self.assertEqual(definition.lint_desk({"start": "today"}, TYPES), [])


class DeskStartCompile(unittest.TestCase):
    def producers(self, a, b=None):
        return PageCompile.producers(self, a, b)

    def test_start_is_compiled(self):
        compiled = definition.compile(self.producers(started("p/overview", PAGE)))
        self.assertEqual(compiled["desk"]["start"], "p/overview")

    def test_same_start_across_producers_passes(self):
        compiled = definition.compile(self.producers(started("runs"), started("runs")))
        self.assertEqual(compiled["desk"]["start"], "runs")

    def test_different_starts_refused(self):
        with self.assertRaises(definition.DefinitionError) as ctx:
            definition.compile(self.producers(started("runs"), started("history")))
        self.assertTrue(says(ctx.exception.problems, "desk.start is 'runs' in alpha but 'history' in beta"),
                        ctx.exception.problems)

    def test_no_start_compiles_as_before(self):
        compiled = definition.compile(self.producers(defn(PAGE)))
        self.assertNotIn("start", compiled["desk"])


def hiding(*ids, modules=()):
    d = defn()
    d["desk"] = {"hideLists": list(ids)}
    if modules:
        d["desk"]["modules"] = list(modules)
    return d


def two_types(extra=None):
    d = {"version": 1, "label": "Content", "inbox": False,
         "types": {"story": {"label": "Story", "plural": "Stories", "identity": "field:title",
                             "fields": {"title": {"type": "text"}}},
                   "feed": {"label": "Feed", "plural": "Feeds", "identity": "field:title",
                            "fields": {"title": {"type": "text"}}}}}
    if extra:
        d["desk"] = extra
    return d


class HideLists(unittest.TestCase):
    def producers(self, a, b=None):
        out = [{"id": "alpha", "label": "Alpha", "schedule": "", "definition": a}]
        if b is not None:
            out.append({"id": "beta", "label": "Beta", "schedule": "", "definition": b})
        return out

    def test_hide_lists_lint(self):
        found = definition.lint(two_types({"hideLists": "story"}), [])
        self.assertTrue(says(found, "desk.hideLists must be a list"), found)
        found = definition.lint(two_types({"hideLists": ["story", "story"]}), [])
        self.assertTrue(says(found, "more than once"), found)
        found = definition.lint(two_types({"hideLists": [3]}), [])
        self.assertTrue(says(found, "type ids"), found)
        mod = {"id": "story-view", "kind": "view", "label": "Stories", "view": {"type": "story"}, "fields": {}}
        found = definition.lint(two_types({"hideLists": ["story"], "modules": [mod]}), [])
        self.assertTrue(says(found, "story-view"), found)
        self.assertTrue(says(found, "hideLists"), found)
        self.assertEqual(definition.lint(two_types({"hideLists": ["story"]}), []), [])

    def test_hide_lists_compile(self):
        with self.assertRaises(definition.DefinitionError) as ctx:
            definition.compile(self.producers(two_types({"hideLists": ["nope"]})))
        self.assertTrue(says(ctx.exception.problems, "'nope'"), ctx.exception.problems)
        self.assertTrue(says(ctx.exception.problems, "alpha"), ctx.exception.problems)
        a, b = two_types({"hideLists": ["story"]}), two_types({"hideLists": ["feed"]})
        ab = definition.compile(self.producers(a, b))
        ba = definition.compile(self.producers(b, a))
        self.assertEqual(ab["desk"]["hideLists"], ["feed", "story"])
        self.assertEqual(ba["desk"]["hideLists"], ["feed", "story"])

    def test_hide_lists_module_in_another_producer_is_refused(self):
        mod = {"id": "story-view", "kind": "view", "label": "Stories", "view": {"type": "story"}, "fields": {}}
        a = two_types({"hideLists": ["story"]})
        b = two_types({"modules": [mod]})
        with self.assertRaises(definition.DefinitionError) as ctx:
            definition.compile(self.producers(a, b))
        found = says(ctx.exception.problems, "story-view")
        self.assertTrue(found and "alpha" in found[0] and "beta" in found[0], ctx.exception.problems)

    def test_hide_lists_absent_leaves_the_digest_alone(self):
        compiled = definition.compile(self.producers(defn(PAGE)))
        self.assertEqual(compiled["version"], "a4eb7a0baaa7")
        self.assertNotIn("hideLists", compiled.get("desk", {}))
        self.assertEqual(definition.compile(self.producers(defn()))["version"], "312cf56de52b")

    def test_hide_lists_start_conflict(self):
        found = definition.start_hide_conflict("browse/story", "alpha", {"story": "beta"})
        self.assertEqual(len(found), 1)
        self.assertIn("beta", found[0])
        self.assertIn("story", found[0])
        self.assertEqual(definition.start_hide_conflict("today", "alpha", {"story": "beta"}), [])
        self.assertEqual(definition.start_hide_conflict(None, None, {"story": "beta"}), [])
        self.assertEqual(definition.start_hide_conflict("browse/feed", "alpha", {"story": "beta"}), [])


SHEET = "https://docs.google.com/spreadsheets/d/EXAMPLE/edit"


def link(**over):
    return dict({"label": "Tracker", "url": SHEET}, **over)


class NavLinks(unittest.TestCase):
    def producers(self, a_links, b_links=None, a_tz=None, b_tz=None):
        out = [{"id": "alpha", "label": "Alpha", "schedule": "", "definition": defn(),
                "links": a_links, "timezone": a_tz}]
        if b_links is not None or b_tz is not None:
            out.append({"id": "beta", "label": "Beta", "schedule": "", "definition": defn(),
                        "links": b_links or [], "timezone": b_tz})
        return out

    def test_nav_links_validation(self):
        self.assertEqual(definition.lint_routine_desk({"link": [link()]}), [])
        self.assertEqual(definition.lint_routine_desk({"link": [link(icon="globe")]}), [])
        bad = {
            "http": link(url="http://example.org/a"),
            "javascript": link(url="javascript:alert(1)"),
            "data": link(url="data:text/html,x"),
            "file": link(url="file:///etc/hosts"),
            "userinfo": link(url="https://user:secret" + "@" + "host.example/a"),
            "space": link(url="https://example.org/a b"),
            "long": link(url="https://example.org/" + "a" * 290),
            "empty label": link(label=""),
            "long label": link(label="x" * 41),
            "em dash": link(label="Tracker " + EM_DASH + " sheet"),
            "icon": link(icon="rocket"),
            "unknown key": dict(link(), colour="red"),
            "no url": {"label": "Tracker"},
        }
        for name, item in bad.items():
            found = definition.lint_routine_desk({"link": [item]})
            self.assertTrue(found and found[0].startswith("desk.link[0]"), (name, found))
        found = definition.lint_routine_desk({"link": [link(), link(label="Tracker", url="http://x.org")]})
        self.assertTrue(says(found, 'desk.link[1] "Tracker": url must start with https://'), found)
        found = definition.lint_routine_desk({"link": [link(), link(label="Other")]})
        self.assertTrue(says(found, "same url"), found)
        found = definition.lint_routine_desk({"link": [link(label=f"L{i}", url=f"https://example.org/{i}")
                                                       for i in range(13)]})
        self.assertTrue(says(found, "at most 12"), found)
        found = definition.lint_routine_desk({"links": []})
        self.assertEqual(found, ["desk: unknown key 'links'; allowed: pages, link, timezone"])
        self.assertEqual(definition.lint_routine_desk({"pages": True}), [])
        self.assertTrue(says(definition.lint_routine_desk({"pages": "yes"}), "desk.pages"))
        self.assertTrue(says(definition.lint_routine_desk({"link": {"label": "x"}}), "desk.link must be"))
        self.assertEqual(definition.lint_routine_desk(None), [])

    def test_routine_toml_lint_refuses_a_desk_typo(self):
        import schema
        cfg = {"routine": {"name": "x", "type": "watch", "schedule": "0 1 * * *"}, "desk": {"links": []}}
        self.assertTrue(says(schema.lint(cfg, None), "desk: unknown key 'links'"))
        cfg["desk"] = {"pages": True, "link": [link()]}
        self.assertFalse(says(schema.lint(cfg, None), "desk"))

    def test_nav_links_compile(self):
        a = [link(), link(label="Docs", url="https://example.org/docs", icon="globe")]
        b = [link(label="Same sheet", url=SHEET), link(label="Wiki", url="https://example.org/wiki")]
        out = definition.compile(self.producers(a, b))["desk"]["links"]
        self.assertEqual([x["url"] for x in out], [SHEET, "https://example.org/docs", "https://example.org/wiki"])
        self.assertEqual(out[0], {"label": "Tracker", "url": SHEET, "icon": "external-link"})
        self.assertEqual(out[1]["icon"], "globe")
        self.assertEqual(out[0]["label"], "Tracker")

    def test_nav_links_absent_leave_the_digest_alone(self):
        compiled = definition.compile(self.producers([]))
        self.assertEqual(compiled["version"], "312cf56de52b")
        self.assertNotIn("desk", compiled)

    def test_desk_timezone(self):
        for ok in ("Australia/Melbourne", "UTC", "local"):
            self.assertEqual(definition.lint_routine_desk({"timezone": ok}), [], ok)
        for bad in ("Mars/Base", "", 5, "../etc/passwd"):
            found = definition.lint_routine_desk({"timezone": bad})
            self.assertTrue(says(found, "desk.timezone"), (bad, found))
        compiled = definition.compile(self.producers([], None, a_tz="Australia/Melbourne"))
        self.assertEqual(compiled["desk"]["timezone"], "Australia/Melbourne")
        for tz in ("local", None):
            self.assertNotIn("desk", definition.compile(self.producers([], None, a_tz=tz)))
        # local on one producer and a zone on another is not a disagreement
        compiled = definition.compile(self.producers([], [], a_tz="local", b_tz="Australia/Melbourne"))
        self.assertEqual(compiled["desk"]["timezone"], "Australia/Melbourne")
        with self.assertRaises(definition.DefinitionError) as ctx:
            definition.compile(self.producers([], [], a_tz="Australia/Melbourne", b_tz="Europe/Paris"))
        text = str(ctx.exception)
        self.assertTrue("alpha" in text and "beta" in text and "timezone" in text, text)


if __name__ == "__main__":
    unittest.main()
