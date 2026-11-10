"""View modules in a producer's definition.json: lint, compile and the default page modules."""
import copy
import json
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "skills", "routineos", "scripts")
sys.path.insert(0, SCRIPTS)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import definition  # noqa: E402
import pack  # noqa: E402
import pack_fixtures  # noqa: E402

EM_DASH = chr(0x2014)
NEVER_LEARNABLE_MSG = ("desk module 'send-list': the id contains a word learning never touches "
                       "(push, gate, send, alert, permission, budget, maxruns, capoverride); choose another id")


def job_defn(*modules):
    defn = {
        "version": 1,
        "label": "Jobs",
        "inbox": False,
        "types": {"job": {"label": "Job", "plural": "Jobs", "identity": "field:title",
                          "fields": {"title": {"type": "text"}, "salary": {"type": "text"}}}},
    }
    if modules:
        defn["desk"] = {"modules": [copy.deepcopy(m) for m in modules]}
    return defn


# The spec 4.4 example, with sort and columns over fields this type declares.
EXAMPLE = {
    "id": "remote-this-week",
    "kind": "view",
    "label": "Remote roles this week",
    "icon": "globe",
    "view": {
        "type": "job",
        "filters": {"tag": ["remote", "hybrid"], "status": "active"},
        "window": "week",
        "sort": {"field": "lastSeen", "dir": "desc"},
        "columns": ["title", "salary", "lastSeen"],
    },
    "fields": {"salary": "salary-band"},
}


def module(**over):
    m = copy.deepcopy(EXAMPLE)
    m.update(over)
    return m


def problems_of(*modules):
    return definition.lint(job_defn(*modules), [])


class ModuleLint(unittest.TestCase):
    def test_valid_module_has_no_problems(self):
        self.assertEqual(problems_of(EXAMPLE), [])

    def test_unknown_key_refused(self):
        found = problems_of(module(nav={}))
        self.assertTrue(found)
        self.assertTrue(all("nav" in p for p in found), found)

    def test_id_pattern(self):
        for bad in ("A", "x", "1abc"):
            self.assertTrue(problems_of(module(id=bad)), bad)
        self.assertEqual(problems_of(module(id="remote-week")), [])

    def test_page_id_refused(self):
        # runs is a v2 page; inbox, suggestions and views are retired pages whose addresses still redirect.
        for mid in ("inbox", "runs", "suggestions", "views"):
            found = problems_of(module(id=mid))
            self.assertTrue([p for p in found if "built-in page" in p], (mid, found))

    def test_never_learnable_id_refused(self):
        self.assertEqual(problems_of(module(id="send-list")), [NEVER_LEARNABLE_MSG])

    def test_code_key_at_any_depth_refused(self):
        deep = module()
        deep["view"]["filters"]["fields"] = {"bodyHtml": "x"}
        self.assertTrue([p for p in problems_of(deep) if "bodyHtml" in p], problems_of(deep))
        top = module(script="x")
        self.assertTrue([p for p in problems_of(top) if "script" in p], problems_of(top))

    def test_kind_must_be_view(self):
        found = problems_of(module(kind="page"))
        self.assertTrue([p for p in found if "kind" in p], found)

    def test_icon_must_be_nav_icon(self):
        self.assertTrue(problems_of(module(icon="improve")))
        self.assertIn("globe", definition.NAV_ICONS)
        self.assertEqual(problems_of(module(icon="globe")), [])

    def test_view_is_linted(self):
        m = module()
        m["view"]["type"] = "nope"
        found = problems_of(m)
        self.assertTrue([p for p in found if "undeclared type 'nope'" in p], found)

    def test_view_keys_without_id_name_icon(self):
        m = module()
        m["view"]["name"] = "Remote"
        self.assertTrue([p for p in problems_of(m) if "name" in p])

    def test_list_filters_accepted_and_checked(self):
        ok = module()
        ok["view"]["filters"] = {"tag": ["a", "b"], "source": "web"}
        self.assertEqual(problems_of(ok), [])
        for key, bad in (("tag", []), ("tag", [1]), ("source", {"x": 1})):
            m = module()
            m["view"]["filters"] = {key: bad}
            found = problems_of(m)
            self.assertTrue([p for p in found if f"filters.{key}" in p], (key, bad, found))

    def test_empty_scope_strings_refused(self):
        for key, bad in (("tag", ""), ("tag", [""]), ("source", "   "), ("source", ["web", ""])):
            m = module()
            m["view"]["filters"] = {key: bad}
            found = problems_of(m)
            self.assertTrue([p for p in found if f"filters.{key}" in p], (key, bad, found))

    def test_non_string_view_type_is_a_lint_message(self):
        for bad in (["role"], {"t": "role"}, 7, None):
            m = module()
            m["view"]["type"] = bad
            found = problems_of(m)
            self.assertTrue([p for p in found if "undeclared type" in p], (bad, found))

    def test_fields_must_name_type_fields(self):
        self.assertTrue(problems_of(module(fields={"nope": "salary-band"})))
        self.assertTrue(problems_of(module(fields={"salary": "Bad Id"})))

    def test_conflicting_field_maps_refused(self):
        a = module(id="a-one", fields={"salary": "a-one"})
        b = module(id="b-two", fields={"salary": "b-two"})
        found = problems_of(a, b)
        self.assertEqual(len(found), 1, found)
        self.assertIn("salary", found[0])
        self.assertEqual(problems_of(a, module(id="b-two", fields={"salary": "a-one"})), [])

    def test_duplicate_id_in_one_producer_refused(self):
        self.assertTrue([p for p in problems_of(EXAMPLE, EXAMPLE) if "more than once" in p])

    def test_label_copy_scan(self):
        self.assertTrue(problems_of(module(label="x" * 41)))
        self.assertEqual(problems_of(module(label="x" * 40)), [])
        self.assertTrue(problems_of(module(label="Magic roles")))
        self.assertTrue(problems_of(module(label="Roles " + EM_DASH + " remote")))

    def test_desk_shape(self):
        self.assertTrue(definition.lint(dict(job_defn(), desk=[]), []))
        self.assertEqual(definition.lint(dict(job_defn(), desk={"modules": [], "pages": []}), []), [])
        self.assertTrue(definition.lint(dict(job_defn(), desk={"pages": "x"}), []))
        self.assertTrue(definition.lint(dict(job_defn(), desk={"modules": ["x"]}), []))

    def test_no_desk_block_lints_as_before(self):
        self.assertEqual(definition.lint(job_defn(), []), [])

    def test_banned_words_match_the_bundle_scan(self):
        import test_desk_bundle
        self.assertEqual(tuple(test_desk_bundle.BANNED_WORDS), tuple(definition.BANNED_WORDS))

    def test_desk_is_a_definition_key(self):
        self.assertIn("desk", pack.DEFINITION_KEYS)
        p = pack_fixtures.minimal_pack()
        p["definition"]["types"]["item"]["fields"]["title"] = {"label": "Title", "type": "text"}
        p["definition"]["desk"] = {"modules": [{"id": "recent", "kind": "view", "label": "Recent",
                                                "view": {"type": "item", "window": "week"}}]}
        self.assertEqual([x for x in pack.validate(p) if "desk" in x], [])
        p["definition"]["desk"]["modules"][0]["id"] = "send-list"
        self.assertTrue([x for x in pack.validate(p) if "send-list" in x])
        top = pack_fixtures.minimal_pack()
        top["desk"] = {"modules": []}
        self.assertTrue([x for x in pack.validate(top) if "desk" in x])

    def test_schema_allows_desk(self):
        import jsonschema_subset
        with open(os.path.join(ROOT, "catalog", "schema", "pack.v1.schema.json"), encoding="utf-8") as fh:
            schema = json.load(fh)
        self.assertIn("desk", schema["$defs"]["definition"]["properties"])
        self.assertEqual(schema["$defs"]["module"]["properties"]["icon"]["enum"], list(definition.NAV_ICONS))
        p = pack_fixtures.minimal_pack()
        p["definition"]["desk"] = {"modules": [{"id": "recent", "kind": "view", "label": "Recent",
                                                "view": {"type": "item", "filters": {"tag": ["a", "b"]}},
                                                "fields": {"url": "link-cell"}}]}
        self.assertEqual(jsonschema_subset.validate(p, schema), [])
        p["definition"]["desk"]["modules"][0]["script"] = "x"
        self.assertTrue(jsonschema_subset.validate(p, schema))


def producer(pid, defn, settings=()):
    return {"id": pid, "label": pid, "schedule": "0 22 * * 1", "definition": defn, "settings": list(settings)}


def template_producer(name):
    import schema
    d = os.path.join(ROOT, "templates", name)
    return producer(name, definition.load(os.path.join(d, "definition.json")),
                    schema.load(os.path.join(d, "routine.toml")).get("setting", []))


def digest_081(out):
    """The 0.8.1 version formula: the first 12 hex of sha256 over producers, types and views."""
    import hashlib
    body = {k: out[k] for k in ("producers", "types", "views")}
    return hashlib.sha256(json.dumps(body, sort_keys=True).encode("utf-8")).hexdigest()[:12]


def other_defn(*modules):
    defn = job_defn(*modules)
    defn["types"] = {"lead": {"label": "Lead", "identity": "name", "fields": {"name": {"type": "text"}}}}
    for m in defn.get("desk", {}).get("modules", []):
        m["view"] = {"type": "lead"}
        m.pop("fields", None)
    return defn


class ModuleCompile(unittest.TestCase):
    def test_no_desk_same_bytes_and_digest(self):
        prods = [template_producer("watch"), template_producer("jobs-watch")]
        out = definition.compile(copy.deepcopy(prods))
        self.assertNotIn("desk", out)
        self.assertEqual(out["version"], digest_081(out))
        # An empty desk block compiles exactly as no desk block.
        empty = copy.deepcopy(prods)
        for p in empty:
            p["definition"]["desk"] = {"modules": []}
        self.assertEqual(json.dumps(definition.compile(empty), sort_keys=True), json.dumps(out, sort_keys=True))

    def test_no_desk_matches_081_golden(self):
        # Captured from the 0.8.1 compile before the desk key existed.
        defn = job_defn()
        defn["views"] = [{"id": "all-jobs", "type": "job", "name": "All", "columns": ["title", "salary"]}]
        out = definition.compile([producer("p1", defn)])
        self.assertEqual(out["version"], "462db062089d")
        import hashlib
        self.assertEqual(hashlib.sha256(json.dumps(out, sort_keys=True).encode("utf-8")).hexdigest(),
                         "11d952c721e67d5c6a46da2d3eb9a77941ff09e451da04fc9ec4730062690830")

    def test_modules_embedded_with_producer(self):
        out = definition.compile([producer("p1", job_defn(module(id="a1"))),
                                  producer("p2", other_defn(module(id="b1")))])
        mods = out["desk"]["modules"]
        self.assertEqual([m["id"] for m in mods], ["a1", "b1"])
        self.assertEqual([m["producer"] for m in mods], ["p1", "p2"])
        self.assertEqual(mods[0]["fields"], {"salary": "salary-band"})
        self.assertEqual(out["version"], definition.compile([producer("p1", job_defn(module(id="a1"))),
                                                             producer("p2", other_defn(module(id="b1")))])["version"])

    def test_defaults_never_embedded(self):
        out = definition.compile([producer("p1", job_defn(module(id="a1")))])
        self.assertEqual([m for m in out["desk"]["modules"] if m.get("kind") == "page"], [])
        self.assertEqual(len(out["desk"]["modules"]), 1)

    def test_duplicate_id_across_producers(self):
        with self.assertRaises(definition.DefinitionError) as cm:
            definition.compile([producer("p1", job_defn(module(id="a1"))), producer("p2", other_defn(module(id="a1")))])
        self.assertIn("desk module 'a1' is declared by p1 and p2", cm.exception.problems)

    def test_digest_changes_when_modules_change(self):
        one = definition.compile([producer("p1", job_defn(module(id="a1")))])
        two = definition.compile([producer("p1", job_defn(module(id="a1", label="Remote roles")))])
        self.assertNotEqual(one["version"], two["version"])
        bare = definition.compile([producer("p1", job_defn())])
        self.assertNotEqual(one["version"], bare["version"])


DESK = os.path.join(ROOT, "skills", "routineos", "assets", "desk")
DEFAULTS = os.path.join(DESK, "modules", "defaults.json")


def desk_file(*parts):
    with open(os.path.join(DESK, *parts), encoding="utf-8") as fh:
        return fh.read()


def js_rows(text, name):
    import re
    m = re.search(r"var " + name + r" = (\[.*?\]);\n", text)
    return json.loads(m.group(1))


class Defaults(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(DEFAULTS, encoding="utf-8") as fh:
            cls.doc = json.load(fh)
        cls.rows = cls.doc["modules"]
        cls.palette, cls.shell, cls.router = desk_file("core", "palette.js"), desk_file("app", "Shell.jsx"), desk_file("core", "router.js")
        cls.app = desk_file("app", "App.jsx")

    def test_shape(self):
        self.assertEqual(self.doc["version"], 1)
        for row in self.rows:
            self.assertEqual(set(row), {"id", "kind", "label", "route", "nav", "current", "icon"}, row)
            self.assertEqual(row["kind"], "page")
            self.assertIn(row["nav"], ("head", "tail", "type", "join", "none"))

    def test_head_and_tail_match_palette(self):
        for nav, name in (("head", "NAV_HEAD"), ("tail", "NAV_TAIL")):
            want = js_rows(self.palette, name)
            got = [[r["id"], r["label"], r["route"], r["icon"]] for r in self.rows if r["nav"] == nav]
            self.assertEqual(got, want, nav)

    def test_join_row_matches_workers_entry(self):
        joins = [r for r in self.rows if r["nav"] == "join"]
        self.assertEqual(len(joins), 1)
        r = joins[0]
        self.assertIn(json.dumps([r["id"], r["label"], r["route"], r["icon"]])[1:-1], self.palette)

    def test_non_nav_pages_mark_themselves(self):
        got = {r["id"]: r["current"] for r in self.rows if r["nav"] == "none" and r["current"] not in (r["id"], "type")}
        self.assertEqual(got, {})

    def test_type_pages_mark_their_type_entry(self):
        self.assertIn('id: "type:" + t.id', self.palette)
        self.assertEqual({r["id"]: r["current"] for r in self.rows if r["current"] == "type"},
                         {"browse": "type", "entity": "type"})

    def test_labels_match_page_titles(self):
        import re
        titles = dict(re.findall(r'(\w+): "([^"]+)"', re.search(r"var PAGE_TITLES = \{([^}]*)\}", self.shell).group(1)))
        for r in self.rows:
            if r["id"] in titles:
                self.assertEqual(r["label"], titles[r["id"]], r["id"])
        self.assertEqual(titles["entity"], "Record")

    def test_routes_resolve(self):
        import re
        listed = re.search(r'\[("today"[^\]]*)\]\.indexOf\(seg\[0\]\)', self.router).group(1)
        pages = set(json.loads("[" + listed + "]"))
        registered = set(re.findall(r"^PAGES\.(\w+) = ", self.app, re.M))  # the Shell draws PAGES[r.page]
        for r in self.rows:
            if "<" in r["route"]:
                head = r["route"][2:].split("/")[0]
                self.assertIn('seg[0] === "' + head + '"', self.router, r["id"])
            else:
                self.assertEqual(r["route"], "#/" + r["id"])
                self.assertIn(r["id"], pages, r["id"])
            self.assertIn(r["id"], registered, r["id"])

    def test_retired_pages_redirect(self):
        self.assertEqual(definition.RETIRED_PAGE_IDS, ("inbox", "suggestions", "views"))
        for pid in definition.RETIRED_PAGE_IDS:
            self.assertNotIn(pid, {r["id"] for r in self.rows})
            self.assertIn('seg[0] === "' + pid + '"', self.router, pid)
        self.assertIn("runs", {r["id"] for r in self.rows})

    def test_ids_equal_page_ids(self):
        self.assertEqual({r["id"] for r in self.rows}, set(definition.PAGE_IDS))
        self.assertEqual(len(self.rows), len(definition.PAGE_IDS))


if __name__ == "__main__":
    unittest.main()
