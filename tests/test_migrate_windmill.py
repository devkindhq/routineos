"""Tests for migrate_windmill.py: OpenFlow JSON to a migration plan."""
import copy
import json
import os
import unittest

import migrate_fixtures as fx  # noqa: F401  (sets sys.path)
import migrate
import migrate_windmill as w
import pack

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIX = os.path.join(ROOT, "tests", "fixtures", "migrate", "windmill")


def load(name):
    with open(os.path.join(FIX, name), encoding="utf-8") as fh:
        return json.load(fh)


def flow(modules, **over):
    f = {"summary": "Unit flow", "value": {"modules": modules}}
    f.update(over)
    return f


def raw(mid, **kw):
    m = {"id": mid, "summary": f"Step {mid}", "value": {"type": "rawscript", "language": "python3",
                                                         "content": "def main():\n    return 1\n",
                                                         "input_transforms": {}}}
    m.update(kw)
    return m


def step(plan, sid):
    return next(s for s in plan["steps"] if s["id"] == sid)


def issues(plan, **match):
    return [i for i in plan["issues"] if all(i.get(k) == v for k, v in match.items())]


class Roots(unittest.TestCase):
    def test_root_fields(self):
        plan = w.parse(flow([raw("a")], description="What it does."), "my-flow.json")
        self.assertEqual(plan["source"], {"tool": "windmill", "name": "Unit flow", "ref": "my-flow.json"})
        self.assertEqual(plan["title"], "Unit flow")
        self.assertEqual(plan["summary"], "What it does.")
        self.assertEqual(plan["id"], "unit-flow")
        self.assertEqual(plan["trigger"]["cron"], migrate.DEFAULT_CRON)
        self.assertEqual(issues(plan, concept="trigger.schedule"), [])
        self.assertEqual([i for i in plan["issues"] if "schedule" in i["message"].lower()], [])

    def test_refuses_bad_roots(self):
        for bad in ([], "x", {}, {"value": {}}, {"value": []}, {"value": {"modules": "x"}}):
            with self.assertRaises(migrate.MigrateError):
                w.parse(bad)

    def test_yaml_is_refused(self):
        for text in ("summary: x\nvalue:\n  modules: []\n", "- a\n", "", "[1]"):
            with self.assertRaises(migrate.MigrateError) as cm:
                w.load_text(text)
            self.assertIn("JSON", str(cm.exception))

    def test_load_text_reads_json_and_rejects_broken_json(self):
        self.assertEqual(w.load_text('  {"a": 1}')["a"], 1)
        with self.assertRaises(migrate.MigrateError):
            w.load_text("{not json")

    def test_ignored_flow_keys_are_named(self):
        f = flow([raw("a")])
        f["value"]["early_return"] = "a"
        plan = w.parse(f)
        self.assertTrue(any("early_return" in i["message"] for i in plan["issues"]))


class Modules(unittest.TestCase):
    def test_rawscript_is_code_with_source(self):
        plan = w.parse(flow([raw("a")]))
        s = step(plan, "a")
        self.assertEqual(s["concept"], "step.code")
        self.assertEqual(s["code"], {"language": "python3", "text": "def main():\n    return 1\n"})
        self.assertEqual(plan["kind"], "code")

    def test_script_and_flow_are_subworkflows_naming_the_path(self):
        mods = [{"id": "a", "value": {"type": "script", "path": "f/demo/helper"}},
                {"id": "b", "value": {"type": "script", "path": "hub/1/demo/thing"}},
                {"id": "c", "value": {"type": "flow", "path": "f/demo/child"}}]
        plan = w.parse(flow(mods))
        for sid, path in (("a", "f/demo/helper"), ("b", "hub/1/demo/thing"), ("c", "f/demo/child")):
            self.assertEqual(step(plan, sid)["concept"], "step.subworkflow")
            self.assertIn(path, step(plan, sid)["does"])
            found = issues(plan, concept="step.subworkflow", where=sid)
            self.assertEqual(found[0]["level"], "needs-person")
            self.assertIn(path, found[0]["message"])
        self.assertIn("hub", issues(plan, where="b")[0]["message"])

    def test_identity_is_noop(self):
        plan = w.parse(flow([{"id": "a", "value": {"type": "identity"}}]))
        self.assertEqual(step(plan, "a")["concept"], "step.noop")

    def test_unknown_module_type_is_unmapped(self):
        plan = w.parse(flow([{"id": "a", "value": {"type": "futuretype"}}]))
        self.assertEqual(step(plan, "a")["concept"], "step.unknown")
        self.assertEqual(issues(plan, concept="step.unknown")[0]["level"], "unmapped")

    def test_loop_flattens_inner_modules_with_prefix(self):
        for kind, extra in (("forloopflow", {"iterator": {"type": "javascript", "expr": "results.a.rows"}}),
                            ("whileloopflow", {})):
            loop = {"id": "L", "value": dict({"type": kind, "modules": [raw("in1"), raw("in2")]}, **extra)}
            plan = w.parse(flow([raw("a"), loop]))
            ids = [s["id"] for s in plan["steps"]]
            self.assertEqual(ids, ["a", "l", "in1", "in2"])
            self.assertEqual(step(plan, "l")["concept"], "step.loop")
            for sid in ("in1", "in2"):
                self.assertTrue(step(plan, sid)["does"].startswith("For each item: "))

    def test_loop_iterator_becomes_an_input(self):
        loop = {"id": "L", "value": {"type": "forloopflow", "modules": [],
                                     "iterator": {"type": "javascript", "expr": "results.a.rows"}}}
        plan = w.parse(flow([raw("a"), loop]))
        self.assertIn("`rows` from step `a`", step(plan, "l")["inputs"])

    def test_loop_skip_failures_continues(self):
        loop = {"id": "L", "value": {"type": "forloopflow", "skip_failures": True, "modules": []}}
        self.assertEqual(step(w.parse(flow([loop])), "l")["on_error"], "continue")

    def test_branchone_states_branches_and_flattens_default(self):
        b = {"id": "B", "value": {"type": "branchone", "branches": [
            {"summary": "Big", "expr": "results.a.n", "modules": [raw("x1")]},
            {"expr": "flow_input.limit", "modules": [raw("x2")]}],
            "default": [raw("x3")]}}
        plan = w.parse(flow([raw("a"), b]))
        s = step(plan, "b")
        self.assertEqual(s["concept"], "step.branch")
        self.assertIn("Branch Big", s["does"])
        self.assertIn("Branch 2", s["does"])
        self.assertIn("default", s["does"])
        self.assertTrue(step(plan, "x1")["does"].startswith("Branch Big: "))
        self.assertTrue(step(plan, "x2")["does"].startswith("Branch 2: "))
        self.assertTrue(step(plan, "x3")["does"].startswith("Branch default: "))
        self.assertEqual([s["id"] for s in plan["steps"]], ["a", "b", "x1", "x2", "x3"])

    def test_branchall_is_a_branch_step(self):
        b = {"id": "B", "value": {"type": "branchall", "branches": [
            {"summary": "One", "modules": [raw("x1")]}]}}
        plan = w.parse(flow([b]))
        self.assertEqual(step(plan, "b")["concept"], "step.branch")
        self.assertTrue(step(plan, "x1")["does"].startswith("Branch One: "))

    def test_nested_prefixes_stack(self):
        inner = {"id": "B", "value": {"type": "branchall", "branches": [{"summary": "One", "modules": [raw("x")]}]}}
        loop = {"id": "L", "value": {"type": "forloopflow", "modules": [inner]}}
        plan = w.parse(flow([loop]))
        self.assertTrue(step(plan, "x")["does"].startswith("For each item: Branch One: "))

    def test_aidecision_is_a_branch(self):
        m = {"id": "D", "value": {"type": "aidecision", "input_transforms": {
            "questions": {"type": "static", "value": {"urgency": {"type": "choice"}}}}}}
        s = step(w.parse(flow([m])), "d")
        self.assertEqual(s["concept"], "step.branch")
        self.assertIn("urgency", s["does"])


class Agents(unittest.TestCase):
    def agent(self, tr, **kw):
        return {"id": "ag", "value": dict({"type": "aiagent", "input_transforms": tr}, **kw)}

    def test_static_prompts_become_the_skill(self):
        m = self.agent({"system_prompt": {"type": "static", "value": "Be careful."},
                        "user_message": {"type": "static", "value": "Find facts."}})
        s = step(w.parse(flow([m])), "ag")
        self.assertEqual(s["concept"], "step.agent")
        self.assertEqual(s["skill"], {"system": "Be careful.", "prompt": "Find facts."})

    def test_javascript_prompts_become_inputs_and_an_issue(self):
        m = self.agent({"system_prompt": {"type": "static", "value": "Be careful."},
                        "user_message": {"type": "javascript", "expr": "results.a.title"}})
        plan = w.parse(flow([raw("a"), m]))
        s = step(plan, "ag")
        self.assertEqual(s["skill"], {"system": "Be careful."})
        self.assertIn("`title` from step `a`", s["inputs"])
        found = issues(plan, concept="step.agent", where="ag")
        self.assertEqual(found[0]["level"], "needs-person")
        self.assertIn("user_message", found[0]["message"])

    def test_single_agent_flow_is_a_skill_kind(self):
        m = self.agent({"user_message": {"type": "static", "value": "Go."}})
        self.assertEqual(w.parse(flow([m]))["kind"], "skill")


class Suspend(unittest.TestCase):
    def test_suspend_inserts_an_approval_after_the_module(self):
        m = raw("a", suspend={"required_events": 2, "timeout": 60})
        plan = w.parse(flow([raw("first"), m]))
        self.assertEqual([s["id"] for s in plan["steps"]], ["first", "a", "a-approval"])
        s = step(plan, "a-approval")
        self.assertEqual(s["concept"], "step.wait-approval")
        self.assertIn("2 approvals", s["does"])
        self.assertIn("60 seconds", s["does"])

    def test_the_next_module_follows_the_approval(self):
        plan = w.parse(flow([raw("a", suspend={}), raw("b")]))
        self.assertEqual([s["id"] for s in plan["steps"]], ["a", "a-approval", "b"])
        self.assertIn("after 'Step a' has run", step(plan, "a-approval")["does"])

    def test_suspend_on_a_loop_waits_after_its_inner_modules(self):
        loop = {"id": "l", "summary": "Loop", "suspend": {}, "value": {"type": "forloopflow", "modules": [raw("in")]}}
        plan = w.parse(flow([loop]))
        self.assertEqual([s["id"] for s in plan["steps"]], ["l", "in", "l-approval"])

    def test_a_writing_suspend_module_lands_after_the_gate(self):
        for label, tr in (("resource", {"g": {"type": "static", "value": "$res:u/demo/gmail_main"}}),
                          ("http post", {"method": {"type": "static", "value": "POST"},
                                         "url": {"type": "static", "value": "https://example.test/send"}})):
            with self.subTest(label=label):
                writer = raw("send", suspend={})
                writer["value"]["input_transforms"] = tr
                plan = w.parse(flow([raw("first"), writer, raw("last")]))
                pk, _ = migrate.emit(plan)
                self.assertEqual(pk["routine"]["routine"]["type"], "approval-gated")
                kinds = [(s["id"], s["kind"]) for s in pk["stages"]]
                gate = next(i for i, (_, k) in enumerate(kinds) if k == "gate")
                self.assertIn("send", json.dumps(pk["stages"][gate + 1:]), kinds)
                self.assertNotIn("send", json.dumps(pk["stages"][:gate]), kinds)

    def test_approval_gates_the_pack(self):
        plan = w.parse(flow([raw("a", suspend={})]))
        pk, _ = migrate.emit(plan)
        self.assertEqual(pk["routine"]["routine"]["type"], "approval-gated")


class FailureAndExtras(unittest.TestCase):
    def test_failure_module(self):
        f = flow([raw("a")])
        f["value"]["failure_module"] = raw("failure", summary="Alert me")
        plan = w.parse(f)
        self.assertTrue(plan["failure"]["alert"])
        found = issues(plan, concept="failure.workflow")
        self.assertEqual(found[0]["level"], "needs-person")
        self.assertNotIn("failure", [s["id"] for s in plan["steps"]])

    def test_no_failure_module_means_no_failure_block(self):
        self.assertNotIn("failure", w.parse(flow([raw("a")])))

    def test_stop_skip_sleep_retry_continue(self):
        m = raw("a", stop_after_if={"expr": "result.done", "skip_if_stopped": True},
                skip_if={"expr": "flow_input.dry_run"}, sleep={"type": "static", "value": 5},
                retry={"constant": {"attempts": 3, "seconds": 1}}, continue_on_error=True)
        plan = w.parse(flow([m]))
        s = step(plan, "a")
        self.assertEqual(s["on_error"], "continue")
        for text in ("Stops the flow", "Skipped when", "Waits 5 seconds", "Retries on failure"):
            self.assertIn(text, s["does"])
        self.assertIn("Setting `dry_run`", s["inputs"])
        self.assertTrue(issues(plan, concept="failure.node", where="a"))
        self.assertTrue(issues(plan, concept="step.wait-time", where="a"))
        self.assertTrue(issues(plan, concept="expression", where="a", level="needs-person"))


class Transforms(unittest.TestCase):
    def mod(self, tr):
        return raw("a", value={"type": "rawscript", "language": "python3", "content": "x", "input_transforms": tr})

    def test_resource_maps_to_an_unverified_connector(self):
        plan = w.parse(flow([self.mod({"g": {"type": "static", "value": "$res:u/demo/gmail_main"}})]))
        self.assertEqual(plan["credentials"], [{"type": "windmill resource", "name": "u/demo/gmail_main", "step": "a"}])
        self.assertEqual(plan["connectors"], [{"id": "gmail-write", "app": "gmail", "access": "write"}])
        self.assertEqual(step(plan, "a")["connectors"], ["gmail-write"])
        self.assertEqual(issues(plan, level="unverified", where="a")[0]["level"], "unverified")

    def test_resource_matches_by_label_and_token(self):
        self.assertEqual(w._app_for("u/x/google_sheets"), "googleSheets")
        self.assertEqual(w._app_for("f/team/slack_bot_prod"), "slack")
        self.assertIsNone(w._app_for("u/x/mystery"))

    def test_unmapped_resource_is_a_setup_credential(self):
        plan = w.parse(flow([self.mod({"g": {"type": "static", "value": "$res:u/demo/mystery"}})]))
        self.assertEqual(plan["connectors"], [])
        found = issues(plan, concept="credential", level="setup")
        self.assertIn("u/demo/mystery", found[0]["message"])
        self.assertEqual(issues(plan, concept="credential", level="needs-person"), [])

    def test_variable_is_by_path_only(self):
        plan = w.parse(flow([self.mod({"t": {"type": "static", "value": "$var:f/demo/key_one"}})]))
        self.assertEqual(plan["credentials"], [{"type": "windmill variable", "name": "f/demo/key_one", "step": "a"}])
        self.assertEqual(plan["connectors"], [])
        self.assertEqual(len(issues(plan, concept="credential", level="setup")), 1)
        self.assertEqual(issues(plan, concept="credential", level="needs-person"), [])

    def test_nested_resource_in_static_object(self):
        plan = w.parse(flow([self.mod({"p": {"type": "static", "value": {"k": {"r": "$res:u/demo/notion_main"}}}})]))
        self.assertEqual(plan["connectors"][0]["app"], "notion")

    def test_results_and_flow_input_references(self):
        m = self.mod({"x": {"type": "javascript", "expr": "results.fetch.items.first"},
                      "y": {"type": "javascript", "expr": "flow_input.max_rows"}})
        plan = w.parse(flow([raw("fetch"), m]))
        s = step(plan, "a")
        self.assertIn("`items.first` from step `fetch`", s["inputs"])
        self.assertIn("Setting `max_rows`", s["inputs"])
        self.assertEqual(issues(plan, concept="expression", where="a", level="needs-person"), [])

    def test_other_expressions_are_kept_verbatim_with_an_issue(self):
        plan = w.parse(flow([self.mod({"x": {"type": "javascript", "expr": "Math.max(1, `2`)"}})]))
        s = step(plan, "a")
        self.assertTrue(any("Math.max(1, '2')" in i for i in s["inputs"]))
        self.assertEqual(len(issues(plan, concept="expression", where="a", level="needs-person")), 1)

    def test_reference_to_unknown_step_id_is_slugged(self):
        plan = w.parse(flow([self.mod({"x": {"type": "javascript", "expr": "results.Other_Step"}})]))
        self.assertIn("`result` from step `other-step`", step(plan, "a")["inputs"])


class Settings(unittest.TestCase):
    def settings(self, props):
        plan = w.parse(flow([raw("a")], schema={"properties": props}))
        return {s["name"]: s for s in plan["settings"]}, plan

    def test_each_type(self):
        by, plan = self.settings({
            "dry_run": {"type": "boolean", "default": True},
            "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 10},
            "ratio": {"type": "number"},
            "tone": {"type": "string", "enum": ["formal", "casual"], "default": "casual"},
            "keywords": {"type": "array", "items": {"type": "string"}, "default": ["a", "b"]},
            "approver_list": {"type": "array", "items": {"type": "string"}, "default": ["x"]},
            "title": {"type": "string"}, "blob": {"type": "object"}})
        self.assertEqual(by["dry_run"]["type"], "toggle")
        self.assertIs(by["dry_run"]["default"], True)
        self.assertEqual((by["limit"]["type"], by["limit"]["min"], by["limit"]["max"], by["limit"]["default"]),
                         ("number", 1, 50, 10))
        self.assertEqual(by["ratio"]["default"], 0)
        self.assertEqual((by["tone"]["type"], by["tone"]["choices"], by["tone"]["default"]),
                         ("choice", ["formal", "casual"], "casual"))
        self.assertEqual(by["keywords"]["default"], ["a", "b"])
        self.assertEqual(by["approver_list"]["default"], [])
        self.assertNotIn("title", by)
        self.assertNotIn("blob", by)
        for name in ("title", "blob"):
            self.assertTrue(issues(plan, level="needs-person", where=f"settings.{name}"))

    def test_number_default_is_clamped(self):
        by, _ = self.settings({"n": {"type": "number", "minimum": 5, "default": 1}})
        self.assertEqual(by["n"]["default"], 5)

    def test_names_are_valid_and_unique(self):
        by, _ = self.settings({"Max Rows": {"type": "integer"}, "max-rows": {"type": "integer"},
                               "9lives": {"type": "boolean"}, "max_inbox_per_run": {"type": "integer"}})
        for name in by:
            self.assertRegex(name, migrate.SETTING_NAME_RE.pattern)
        self.assertEqual(len(by), 4)
        self.assertNotIn("max_inbox_per_run", by)

    def test_settings_survive_emit(self):
        _, plan = self.settings({"limit": {"type": "integer", "minimum": 1, "maximum": 9, "default": 3}})
        pk, _ = migrate.emit(plan)
        self.assertEqual(pack.validate(pk), [])

    def test_unknown_flow_input_gets_an_info_issue(self):
        m = raw("a", value={"type": "rawscript", "language": "python3", "content": "x", "input_transforms": {
            "x": {"type": "javascript", "expr": "flow_input.ghost"}}})
        plan = w.parse(flow([m]))
        self.assertTrue(any("ghost" in i["message"] and i["level"] == "info" for i in plan["issues"]))


class Fixtures(unittest.TestCase):
    def check(self, name):
        plan = w.parse(load(name), name)
        self.assertEqual(migrate.validate_plan(plan), [])
        pk, md = migrate.emit(plan)
        self.assertEqual(pack.validate(pk), [])
        self.assertIn("Windmill", md)
        return plan

    def test_minimal(self):
        plan = self.check("minimal.json")
        self.assertEqual([s["id"] for s in plan["steps"]], ["a"])
        self.assertEqual(plan["kind"], "code")

    def test_all_modules(self):
        plan = self.check("all-modules.json")
        seen = {s["concept"] for s in plan["steps"]}
        for cid in ("step.code", "step.subworkflow", "step.loop", "step.branch", "step.noop", "step.agent",
                    "step.wait-approval"):
            self.assertIn(cid, seen)
        self.assertTrue(plan["failure"]["alert"])
        self.assertTrue(issues(plan, concept="failure.workflow"))
        self.assertGreaterEqual({s["type"] for s in plan["settings"]}, {"toggle", "number", "choice", "list"})
        self.assertEqual(plan["source"]["tool"], "windmill")

    def test_plan_is_deterministic(self):
        a, b = w.parse(load("all-modules.json")), w.parse(load("all-modules.json"))
        self.assertEqual(json.dumps(a, sort_keys=True), json.dumps(b, sort_keys=True))
        self.assertEqual(migrate.emit(a), migrate.emit(copy.deepcopy(b)))

    def test_credentials_never_carry_values(self):
        plan = w.parse(load("all-modules.json"))
        self.assertTrue(plan["credentials"])
        for c in plan["credentials"]:
            self.assertEqual(set(c), {"type", "name", "step"})
            self.assertTrue(c["type"].startswith("windmill "))
        text = json.dumps(plan)
        self.assertNotIn("$res:", text)
        self.assertNotIn("$var:", text)

    def test_secret_in_a_static_value_is_removed(self):
        key = "sk-" + "a1b2c3d4e5f6g7h8i9j0k1l2"
        m = raw("a", value={"type": "rawscript", "language": "python3", "content": "token = '" + key + "'",
                            "input_transforms": {}})
        plan = w.parse(flow([m]))
        self.assertNotIn(key, json.dumps(plan))
        self.assertTrue(any(i.get("kind") == "removed" for i in plan["issues"]))
        self.assertEqual(pack.validate(migrate.emit(plan)[0]), [])


if __name__ == "__main__":
    unittest.main()


class SourceInputs(unittest.TestCase):
    def schema(self, props):
        return flow([raw("a")], schema={"properties": props})

    def test_min_above_max_blames_the_input(self):
        with self.assertRaises(migrate.MigrateError) as cm:
            w.parse(self.schema({"n": {"type": "number", "minimum": 10, "maximum": 1}}))
        msg = str(cm.exception)
        self.assertIn("`n`", msg)
        self.assertIn("source flow", msg)
        self.assertNotIn("converter bug", msg)

    def test_equal_min_and_max_is_fine(self):
        plan = w.parse(self.schema({"n": {"type": "number", "minimum": 3, "maximum": 3}}))
        self.assertEqual(plan["settings"][0]["default"], 3)

    def test_odd_labels_do_not_break_the_plan(self):
        for title in (5, None, "", "  ", "x" * 500, ["a"]):
            with self.subTest(title=title):
                plan = w.parse(self.schema({"n": {"type": "boolean", "title": title}}))
                migrate.emit(plan)


class TypeSwapFuzz(unittest.TestCase):
    """A seeded type-swap fuzz: a malformed flow either converts or raises MigrateError, never anything else."""
    WEIRD = [None, 1, -1, 1.5, True, "", "=", "x" * 300, [], {}, [None], {"a": None}, [[]], "$res:", "$var:"]

    @staticmethod
    def paths(o, p=()):
        yield p
        if isinstance(o, dict):
            for k, v in o.items():
                yield from TypeSwapFuzz.paths(v, p + (k,))
        elif isinstance(o, list):
            for i, v in enumerate(o):
                yield from TypeSwapFuzz.paths(v, p + (i,))

    def run_fuzz(self, name, rounds):
        import random
        base = load(name)
        ps = [p for p in self.paths(base) if p]
        rng = random.Random(20261030)
        for i in range(rounds):
            o = copy.deepcopy(base)
            picks = []
            for _ in range(rng.randint(1, 3)):
                p = rng.choice(ps)
                v = copy.deepcopy(rng.choice(self.WEIRD))
                picks.append((p, v))
                try:
                    t = o
                    for k in p[:-1]:
                        t = t[k]
                    t[p[-1]] = v
                except (KeyError, IndexError, TypeError):
                    pass
            try:
                migrate.emit(w.parse(o, {"untrusted": True}))
            except migrate.MigrateError:
                pass
            except Exception as exc:  # noqa: BLE001
                self.fail(f"{name} round {i}: {type(exc).__name__}: {exc}; mutations {picks!r}")

    def test_all_modules_fixture(self):
        self.run_fuzz("all-modules.json", 1500)

    def test_minimal_fixture(self):
        self.run_fuzz("minimal.json", 500)

    def test_ai_agent_with_non_dict_transforms(self):
        for bad in (1, "x", [], None, True):
            m = {"id": "ag", "value": {"type": "aiagent", "input_transforms": bad}}
            try:
                w.parse(flow([m]))
            except migrate.MigrateError:
                pass
