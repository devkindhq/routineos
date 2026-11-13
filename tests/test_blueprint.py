import json
import os
import shutil
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "skills", "routineos", "scripts")
sys.path.insert(0, SCRIPTS)

import blueprint  # noqa: E402

TEMPLATES = os.path.join(ROOT, "templates")
FIX = os.path.join(ROOT, "tests", "fixtures", "blueprint")
GOLDEN = os.path.join(FIX, "golden")


def template_dirs():
    return sorted(
        os.path.join(TEMPLATES, n) for n in os.listdir(TEMPLATES)
        if os.path.isfile(os.path.join(TEMPLATES, n, "routine.toml"))
    )


def tpl(name):
    return blueprint.derive(os.path.join(TEMPLATES, name))


def pack_of(name):
    with open(os.path.join(TEMPLATES, name, "pack.json"), encoding="utf-8") as fh:
        return json.load(fh)


def edges(g, **kw):
    return [e for e in g["edges"] if all(e[k] == v for k, v in kw.items())]


def app_graph():
    app = os.path.join(FIX, "app_basic")
    return blueprint.derive(app, routine_dirs=[os.path.join(app, "routines", "one")])


class DeriveTemplateTests(unittest.TestCase):
    def test_every_template_derives(self):
        dirs = template_dirs()
        self.assertEqual(len(dirs), 12)
        for d in dirs:
            name = os.path.basename(d)
            with self.subTest(template=name):
                g = blueprint.derive(d)
                ids = [n["id"] for n in g["nodes"]]
                self.assertEqual(len(ids), len(set(ids)))
                for e in g["edges"]:
                    self.assertIn(e["from"], ids)
                    self.assertIn(e["to"], ids)
                    self.assertIn(e["type"], blueprint.EDGE_TYPES)
                for n in g["nodes"]:
                    self.assertIn(n["kind"], blueprint.NODE_KINDS)
                    self.assertNotEqual(n["state"], "verified")
                self.assertEqual([i for i in ids if i.startswith("trigger:")], ["trigger:schedule"])
                self.assertEqual([i for i in ids if i.startswith("routine:")], [f"routine:{name}"])
                meta = pack_of(name)
                for s in meta["stages"]:
                    self.assertIn(f"stage:{s['id']}", ids)
                for c in meta["connectors"]:
                    kind = c["kind"] if c["kind"] in ("mcp", "http") else "connector"
                    self.assertIn(f"{kind}:{c['id']}", ids)
                self.assertIn("store:artifact-db", ids)
                self.assertIn("output:desk", ids)
                self.assertEqual(g["format"], "routineos.blueprint.v1")
                self.assertEqual((g["requirements"], g["approval"], g["hash"], g["warnings"]), ([], None, None, []))

    def test_template_goldens(self):
        for d in template_dirs():
            name = os.path.basename(d)
            with self.subTest(template=name):
                with open(os.path.join(GOLDEN, f"{name}.graph.json"), encoding="utf-8") as fh:
                    want = fh.read()
                self.assertEqual(json.dumps(blueprint.derive(d), indent=2, sort_keys=True) + "\n", want)

    def test_read_connector_edge_points_into_stage(self):
        g = tpl("site-compliance-review")
        self.assertEqual(len(edges(g, **{"from": "http:worker", "to": "stage:fetch", "type": "reads"})), 1)
        self.assertEqual(edges(g, **{"from": "stage:fetch", "to": "http:worker"}), [])

    def test_write_connector_edge_points_out_of_stage(self):
        # site-compliance-review has no write connector; content-calendar does
        g = tpl("content-calendar")
        self.assertEqual(len(edges(g, **{"from": "stage:publish", "to": "mcp:cms", "type": "writes"})), 1)
        self.assertEqual(edges(g, **{"from": "mcp:cms", "to": "stage:publish"}), [])

    def test_stage_writes_become_store_edge(self):
        g = tpl("site-compliance-review")
        e = edges(g, **{"from": "stage:write", "to": "store:artifact-db", "type": "stores"})
        self.assertEqual([x["label"] for x in e], ["runs, entities, inbox"])

    def test_gate_and_actions(self):
        g = tpl("content-calendar")
        ids = {n["id"] for n in g["nodes"]}
        self.assertIn("gate:gate", ids)
        self.assertIn("output:publish-post", ids)
        for c in ("connector:gate-mail", "mcp:cms"):
            self.assertEqual(len(edges(g, **{"from": "gate:gate", "to": c, "type": "passes"})), 1)
        self.assertEqual(len(edges(g, **{"from": "gate:gate", "to": "output:publish-post", "type": "passes"})), 1)
        self.assertIn("output:send-reply", {n["id"] for n in tpl("inbox-triage")["nodes"]})

    def test_connectors_default_needs_research(self):
        seen = 0
        for d in template_dirs():
            for n in blueprint.derive(d)["nodes"]:
                if n["kind"] in blueprint.STATEFUL_KINDS:
                    seen += 1
                    self.assertEqual(n["state"], "needs-research")
                else:
                    self.assertIsNone(n["state"])
        self.assertGreater(seen, 10)

    def test_output_is_deterministic(self):
        d = os.path.join(TEMPLATES, "content-calendar")
        self.assertEqual(blueprint.derive(d), blueprint.derive(d))
        g = blueprint.derive(d)
        self.assertEqual([n["id"] for n in g["nodes"]], sorted(n["id"] for n in g["nodes"]))


class DeriveAppTests(unittest.TestCase):
    def test_app_folder_adds_integrations_and_secrets(self):
        g = app_graph()
        nodes = {n["id"]: n for n in g["nodes"]}
        self.assertEqual(nodes["connector:crm"]["kind"], "connector")
        self.assertEqual(nodes["mcp:notes"]["kind"], "mcp")
        self.assertEqual(nodes["http:billing"]["kind"], "http")
        self.assertEqual(nodes["http:billing"]["detail"]["integration_kind"], "secret-host")
        self.assertIn("secret:billing-key", nodes)
        self.assertIn("store:leads", nodes)
        self.assertIn("http:api.example.com", nodes)
        self.assertNotIn("SENTINEL-SECRET-VALUE-123", json.dumps(g))
        self.assertEqual(len(edges(g, **{"from": "secret:billing-key", "to": "http:billing", "type": "uses-secret"})), 1)
        self.assertEqual(len(edges(g, **{"from": "routine:one", "to": "store:leads", "type": "writes"})), 1)
        self.assertEqual(len(edges(g, **{"from": "routine:one", "to": "mcp:notes", "type": "writes"})), 1)

    def test_authored_state_kept_and_default_needs_research(self):
        nodes = {n["id"]: n for n in app_graph()["nodes"]}
        self.assertEqual((nodes["mcp:notes"]["state"], nodes["mcp:notes"]["needs"]), ("docs", "Confirm write scope."))
        self.assertEqual(nodes["connector:crm"]["state"], "needs-research")

    def test_registry_state_wins_and_conflict_is_shown(self):
        self.assertEqual(blueprint._part_state({"relies_on": "x"}, {"x": {"status": "pilot-verified"}})[0], "verified")
        self.assertEqual(blueprint._part_state({"relies_on": ["x", "y"]}, {"x": {"status": "pilot-verified"}, "y": {"status": "docs-stated"}})[0], "docs")
        self.assertEqual(blueprint._part_state({"relies_on": "x", "state": "verified"}, {"x": {"status": "broken"}})[0], "conflict")

    def test_unknown_app_tables_still_load(self):
        app = os.path.join(FIX, "app_zzz")
        g = blueprint.derive(app, routine_dirs=[app])
        self.assertIn("routine:one", {n["id"] for n in g["nodes"]})

    def test_missing_routine_toml_raises(self):
        with self.assertRaises(blueprint.BlueprintError):
            blueprint.derive(os.path.join(FIX, "golden"))


AUTH = os.path.join(FIX, "authored")
HEAD = """[routine]
name = "authored"
type = "serverless"
schedule = "0 6 * * *"

[store]
adapter = "artifact-db"

[workspace]
enabled = true
"""


class Authored(unittest.TestCase):
    """Builds a folder from the authored fixture's pack plus the given routine.toml tail."""

    def mk(self, tail, head=HEAD):
        t = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, t, True)
        for n in ("pack.json", "prompt.md"):
            shutil.copy(os.path.join(AUTH, n), t)
        with open(os.path.join(t, "routine.toml"), "w", encoding="utf-8") as fh:
            fh.write(head + tail)
        return t

    def g(self, tail, records=None, head=HEAD):
        return blueprint.derive(self.mk(tail, head), records=records)

    def node(self, g, nid):
        return next(n for n in g["nodes"] if n["id"] == nid)

    def warned(self, g, text):
        return any(text in w for w in g["warnings"])


class DefinitionTests(Authored):
    """definition.json (spec 6.1, 6.9): each record type is a store the routine keeps, and it counts towards drift."""

    REQ = '[[requirement]]\nid = "r"\ntext = "Shown in the Desk"\nserved_by = ["output:desk"]\n'

    def defn(self, t, text):
        with open(os.path.join(t, "definition.json"), "w", encoding="utf-8") as fh:
            fh.write(text)

    def test_template_record_types_are_stores(self):
        g = tpl("inbox-triage")
        n = next(x for x in g["nodes"] if x["id"] == "store:thread")
        self.assertEqual((n["kind"], n["label"], n["source"]), ("store", "Thread", {"file": "definition.json", "key": "types.thread"}))
        self.assertEqual(len(edges(g, **{"from": "store:artifact-db", "to": "store:thread", "type": "stores"})), 1)
        self.assertEqual(len(edges(g, **{"from": "store:thread", "to": "output:desk", "type": "shows"})), 1)

    def test_record_type_change_is_drift(self):
        t = self.mk(self.REQ)
        before = blueprint.derive(t)["hash"]
        self.defn(t, json.dumps({"version": 1, "types": {"page": {"label": "Page"}}}))
        one = blueprint.derive(t)
        self.assertIn("store:page", {n["id"] for n in one["nodes"]})
        self.assertNotEqual(one["hash"], before)
        self.defn(t, json.dumps({"version": 1, "types": {"page": {"label": "Page"}, "flag": {"label": "Flag"}}}))
        self.assertNotEqual(blueprint.derive(t)["hash"], one["hash"])

    def test_no_store_routine_writes_record_type(self):
        head = HEAD.replace('[store]\nadapter = "artifact-db"\n', "")
        self.assertNotIn("[store]", head)
        t = self.mk(self.REQ, head=head)
        self.defn(t, json.dumps({"version": 1, "types": {"page": {}}}))
        g = blueprint.derive(t)
        self.assertEqual(len(edges(g, **{"from": "routine:authored", "to": "store:page", "type": "writes"})), 1)

    def test_malformed_definition_warns_and_never_crashes(self):
        for text in ("{not json", "[1, 2]", json.dumps({"version": 1, "types": ["page"]})):
            with self.subTest(text=text):
                t = self.mk(self.REQ)
                self.defn(t, text)
                g = blueprint.derive(t)
                self.assertFalse([n for n in g["nodes"] if n["source"]["file"] == "definition.json"])
                self.assertTrue(self.warned(g, "blueprint: definition.json was not read, so its record types are left out"))

    def test_missing_definition_adds_nothing(self):
        g = self.g(self.REQ)
        self.assertFalse([n for n in g["nodes"] if n["source"]["file"] == "definition.json"])
        self.assertFalse(self.warned(g, "definition.json"))


class RegistryStateTests(Authored):
    def test_registry_status_maps(self):
        want = {"pilot-verified": "verified", "docs-stated": "docs", "unverified": "unverified", "conflict": "conflict", "broken": "conflict"}
        self.assertEqual(blueprint.REGISTRY_STATE, want)
        for status, state in want.items():
            with self.subTest(status=status):
                g = self.g('[[integration]]\nname = "x"\nrelies_on = "rid"\n', records={"rid": {"status": status}})
                self.assertEqual(self.node(g, "connector:x")["state"], state)

    def test_registry_wins_over_authored(self):
        g = self.g('[[integration]]\nname = "x"\nrelies_on = "rid"\nstate = "verified"\n', records={"rid": {"status": "docs-stated"}})
        self.assertEqual(self.node(g, "connector:x")["state"], "docs")
        self.assertTrue(self.warned(g, "registry says docs-stated"))

    def test_unknown_relies_on_is_needs_research_and_warns(self):
        g = self.g('[[integration]]\nname = "x"\nrelies_on = ["nope"]\nstate = "verified"\n', records={})
        self.assertEqual(self.node(g, "connector:x")["state"], "needs-research")
        self.assertTrue(self.warned(g, "relies_on 'nope' is not in the registry"))

    def test_any_unknown_relies_on_id_forces_needs_research(self):
        g = self.g('[[integration]]\nname = "x"\nrelies_on = ["rid", "nope"]\nstate = "verified"\n', records={"rid": {"status": "pilot-verified"}})
        self.assertEqual(self.node(g, "connector:x")["state"], "needs-research")
        self.assertTrue(self.warned(g, "relies_on 'nope' is not in the registry"))
        g = self.g('[[integration]]\nname = "x"\nrelies_on = ["rid"]\n', records={"rid": {"status": "pilot-verified"}})
        self.assertEqual(self.node(g, "connector:x")["state"], "verified")

    def test_authored_state_and_needs_apply(self):
        g = self.g('[[integration]]\nname = "web"\nstate = "unverified"\nneeds = "Read the docs."\n')
        n = self.node(g, "http:web")
        self.assertEqual((n["state"], n["needs"]), ("unverified", "Read the docs."))
        self.assertNotIn("connector:web", [x["id"] for x in g["nodes"]])

    def test_integration_name_unknown_adds_connector_node(self):
        g = self.g('[[integration]]\nname = "crm"\nstate = "docs"\n')
        self.assertEqual((self.node(g, "connector:crm")["kind"], self.node(g, "connector:crm")["state"]), ("connector", "docs"))

    def test_infra_nodes(self):
        g = self.g('[[infra]]\nname = "queue"\nkind = "queue"\ndeploys = "workers/q"\nstate = "needs-building"\n')
        n = self.node(g, "infra:queue")
        self.assertEqual((n["detail"]["infra_kind"], n["detail"]["deploys"], n["state"]), ("queue", "workers/q", "needs-building"))

    def test_bad_state_warns(self):
        g = self.g('[[infra]]\nname = "q"\nstate = "done"\n')
        self.assertEqual(self.node(g, "infra:q")["state"], "needs-research")
        self.assertTrue(self.warned(g, "state 'done' is not one of verified, docs, unverified, needs-research, needs-building"))

    def test_needs_research_warns_before_deploy(self):
        g = self.g('[[infra]]\nname = "q"\nneeds = "Find a queue."\n')
        self.assertTrue(self.warned(g, "'infra:q' is needs-research: Find a queue."))
        g = self.g('[[infra]]\nname = "q"\n')
        self.assertTrue(self.warned(g, "'infra:q' is needs-research: nothing recorded"))

    def test_never_verified_without_evidence(self):
        graphs = [blueprint.derive(d) for d in template_dirs()]
        graphs.append(blueprint.derive(AUTH))
        graphs.append(app_graph())
        graphs.append(self.g('[[integration]]\nname = "a"\nrelies_on = "r"\nstate = "verified"\n', records={}))
        graphs.append(self.g('[[integration]]\nname = "b"\nrelies_on = "r"\n', records={"r": {"status": "docs-stated"}}))
        for g in graphs:
            for n in g["nodes"]:
                self.assertNotEqual(n["state"], "verified", n["id"])
        ok = self.g('[[integration]]\nname = "a"\nstate = "verified"\n[[integration]]\nname = "b"\nrelies_on = "r"\n',
                    records={"r": {"status": "pilot-verified"}})
        self.assertEqual([self.node(ok, i)["state"] for i in ("connector:a", "connector:b")], ["verified", "verified"])

    def test_duplicate_name_across_files_warns_not_merged(self):
        app = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, app, True)
        with open(os.path.join(app, "app.toml"), "w", encoding="utf-8") as fh:
            fh.write('[app]\nid = "a"\ntitle = "A"\nstatus = "not live"\n\n[[infra]]\nname = "q"\nkind = "d1"\n')
        rd = self.mk('[[infra]]\nname = "q"\nkind = "queue"\nstate = "docs"\nneeds = "from routine"\n')
        g = blueprint.derive(app, routine_dirs=[rd])
        n = self.node(g, "infra:q")
        self.assertEqual((n["detail"]["infra_kind"], n["state"], n["needs"], n["source"]["file"]), ("d1", "needs-research", None, "app.toml"))
        self.assertTrue(self.warned(g, "'q' is declared in both routine.toml and app.toml; the app.toml entry is used"))

    def test_app_level_warnings_emitted_once(self):
        app = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, app, True)
        with open(os.path.join(app, "app.toml"), "w", encoding="utf-8") as fh:
            fh.write('[app]\nid = "a"\ntitle = "A"\nstatus = "not live"\n\n[[infra]]\nname = "q"\nkind = "d1"\nstate = "bad"\n')
        g = blueprint.derive(app, routine_dirs=[self.mk(""), self.mk("")])
        self.assertEqual(len([w for w in g["warnings"] if "'infra:q'" in w and "bad" in w]), 1)


class RequirementTests(Authored):
    def test_requirement_served(self):
        g = blueprint.derive(AUTH)
        r = {x["id"]: x for x in g["requirements"]}
        self.assertEqual(r["fresh"]["served_by"], ["stage:fetch", "infra:review-worker"])
        self.assertFalse(r["fresh"]["gap"])
        self.assertEqual(self.node(g, "stage:fetch")["serves"], ["fresh"])
        self.assertEqual(sorted(self.node(g, "stage:write")["serves"]), ["report"])

    def test_ambiguous_bare_name_is_not_served(self):
        t = '[[infra]]\nname = "web"\n[[requirement]]\nid = "r"\ntext = "t"\nserved_by = ["web"]\n'
        g = self.g(t)
        r = g["requirements"][0]
        self.assertEqual((r["served_by"], r["unresolved"], r["gap"]), ([], ["web"], True))
        self.assertTrue(self.warned(g, "requirement 'r': served_by 'web' is ambiguous (http:web, infra:web); use the full id"))
        g = self.g(t.replace('["web"]', '["http:web"]'))
        self.assertEqual((g["requirements"][0]["served_by"], g["requirements"][0]["gap"]), (["http:web"], False))

    def test_unknown_served_by_is_gap(self):
        g = self.g('[[requirement]]\nid = "r"\ntext = "t"\nserved_by = ["ghost"]\n')
        self.assertEqual((g["requirements"][0]["unresolved"], g["requirements"][0]["gap"]), (["ghost"], True))
        self.assertTrue(self.warned(g, "requirement 'r': served_by 'ghost' matches no part"))

    def test_empty_served_by_is_gap_and_warns(self):
        g = self.g('[[requirement]]\nid = "r"\ntext = "t"\nserved_by = []\n')
        self.assertTrue(g["requirements"][0]["gap"])
        self.assertTrue(self.warned(g, "requirement 'r' has no served_by"))

    def test_partial_resolution_is_not_a_gap(self):
        g = self.g('[[requirement]]\nid = "r"\ntext = "t"\nserved_by = ["fetch", "ghost"]\n')
        self.assertFalse(g["requirements"][0]["gap"])

    def test_approval_matches_hash(self):
        base = blueprint.derive(self.mk(""))
        self.assertIsNone(base["approval"])
        h = blueprint.derive(AUTH)["hash"]
        tail = '[approval]\nversion = 1\ndate = "2026-11-13"\nhash = "%s"\napproved_by = "A. Person"\n'
        with open(os.path.join(AUTH, "routine.toml"), encoding="utf-8") as fh:
            body = fh.read()
        t = self.mk("", head=body + "\n" + tail % h)
        g = blueprint.derive(t)
        self.assertEqual((g["approval"]["matches"], g["approval"]["file"], g["approval"]["version"]), (True, "routine.toml", 1))
        self.assertFalse(self.warned(g, "approved on"))
        t = self.mk("", head=body + "\n" + tail % "sha256:old")
        g = blueprint.derive(t)
        self.assertFalse(g["approval"]["matches"])
        self.assertTrue(self.warned(g, "changed since it was approved on 2026-11-13; run routineos blueprint approve again"))


class CompletenessTests(Authored):
    def test_completeness_warnings(self):
        g = self.g('[[infra]]\nname = "lonely"\nstate = "docs"\n')
        self.assertTrue(self.warned(g, "'infra:lonely' is connected to nothing"))
        g = blueprint.derive(AUTH)
        self.assertFalse(self.warned(g, "connected to nothing"))
        self.assertFalse(self.warned(g, "not reachable"))
        self.assertFalse(self.warned(g, "leads nowhere"))
        cut = dict(g, edges=[e for e in g["edges"] if e["type"] != "runs"])
        self.assertTrue(any("'stage:fetch' is not reachable from a trigger" in w for w in blueprint.warnings(cut)))
        cut = dict(g, edges=[e for e in g["edges"] if e["type"] != "stores"])
        self.assertTrue(any("'stage:write' leads nowhere (no output or store after it)" in w for w in blueprint.warnings(cut)))

    def test_stage_loop_with_no_exit_warns(self):
        g = blueprint.derive(AUTH)
        loop = [{"id": f"stage:{x}", "kind": "stage", "label": x, "name": x, "state": None, "needs": None,
                 "source": {"file": "pack.json", "key": x}, "serves": [], "detail": {}} for x in ("a", "b")]
        rid = next(n["id"] for n in g["nodes"] if n["kind"] == "routine")
        extra = [{"from": rid, "to": "stage:a", "type": "runs", "label": None},
                 {"from": "stage:a", "to": "stage:b", "type": "next", "label": None},
                 {"from": "stage:b", "to": "stage:a", "type": "next", "label": None}]
        w = blueprint.warnings(dict(g, nodes=g["nodes"] + loop, edges=g["edges"] + extra))
        for s in ("stage:a", "stage:b"):
            self.assertIn(f"blueprint: '{s}' leads nowhere (no output or store after it)", w)
        self.assertFalse(any("'stage:fetch' leads nowhere" in x for x in w))

    def test_stage_whose_only_next_step_dead_ends_warns(self):
        g = blueprint.derive(AUTH)
        cut = dict(g, edges=[e for e in g["edges"] if e["type"] != "stores"])
        w = blueprint.warnings(cut)
        self.assertIn("blueprint: 'stage:fetch' leads nowhere (no output or store after it)", w)
        self.assertIn("blueprint: 'stage:write' leads nowhere (no output or store after it)", w)

    def test_write_to_outside_app_counts_as_an_output(self):
        for name in ("content-calendar", "inbox-triage", "jobs-watch"):
            g = dict(tpl(name), requirements=[], approval=None)
            self.assertFalse([w for w in blueprint.warnings(g) if "leads nowhere" in w], name)

    def test_no_completeness_warnings_without_blueprint(self):
        for d in template_dirs():
            self.assertEqual(blueprint.derive(d)["warnings"], [])


class HashTests(Authored):
    def test_hash_ignores_state_and_needs(self):
        base = blueprint.derive(AUTH)["hash"]
        self.assertTrue(base.startswith("sha256:"))
        with open(os.path.join(AUTH, "routine.toml"), encoding="utf-8") as fh:
            body = fh.read()
        for old, new in (('state = "docs"', 'state = "unverified"'), ('needs = "Build the Worker."', 'needs = "Other."')):
            self.assertIn(old, body)
            self.assertEqual(blueprint.derive(self.mk("", head=body.replace(old, new)))["hash"], base)

    def test_hash_changes_on_structure_and_text(self):
        base = blueprint.derive(AUTH)["hash"]
        with open(os.path.join(AUTH, "routine.toml"), encoding="utf-8") as fh:
            body = fh.read()
        variants = [
            body.replace("Pages are checked every morning", "Pages are checked hourly"),
            body.replace('served_by = ["fetch", "review-worker"]', 'served_by = ["fetch"]'),
            body + '\n[[integration]]\nname = "extra"\n',
            body.replace('schedule = "0 6 * * *"', 'schedule = "0 7 * * *"'),
            body.replace('name = "web"', 'name = "web"\nhosts = ["a.example.com"]'),
        ]
        for v in variants:
            self.assertNotEqual(blueprint.derive(self.mk("", head=v))["hash"], base, v[-80:])
        g = blueprint.derive(AUTH)
        cut = dict(g, edges=g["edges"][1:])
        self.assertNotEqual(blueprint.graph_hash(cut), base)

    def test_has_blueprint(self):
        self.assertTrue(blueprint.has_blueprint(AUTH))
        self.assertFalse(blueprint.has_blueprint(self.mk("")))
        self.assertTrue(blueprint.has_blueprint(self.mk("[approval]\nversion = 1\n")))
        self.assertFalse(blueprint.has_blueprint(self.mk('[[integration]]\nname = "x"\n')))
        self.assertTrue(blueprint.has_blueprint(self.mk('[[integration]]\nname = "x"\nneeds = "y"\n')))
        self.assertTrue(blueprint.has_blueprint(os.path.join(FIX, "app_basic")))  # app.toml integration with state

    def test_has_blueprint_false_for_every_template(self):
        for d in template_dirs():
            self.assertFalse(blueprint.has_blueprint(d), d)


if __name__ == "__main__":
    unittest.main()
