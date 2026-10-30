"""Tests for migrate_n8n.py: schedules, expressions, classification, AI folding, fixtures, search and fetch."""
import copy
import glob
import io
import json
import os
import unittest
import urllib.error

import migrate_fixtures as fx  # noqa: F401  (sets sys.path)
import migrate
import migrate_n8n as n8n
import pack

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURES = os.path.join(ROOT, "tests", "fixtures", "migrate", "n8n")
N = "n8n-nodes-base."
L = "@n8n/n8n-nodes-langchain."


def fake_email():
    return "someone" + chr(64) + "example.test"


def fake_slack_id():
    return "U" + "A1B2C3D4E5"


def fake_key():
    return "sk-" + "a1b2c3d4e5f6g7h8i9j0k1l2"


def load(name, swap=None):
    with open(os.path.join(FIXTURES, name), encoding="utf-8") as fh:
        text = fh.read()
    for k, v in (swap or {}).items():
        text = text.replace(k, v)
    return json.loads(text)


def node(name, type_, params=None, **kw):
    d = {"id": name.lower().replace(" ", "-"), "name": name, "type": type_, "typeVersion": 1, "position": [0, 0],
         "parameters": params or {}}
    d.update(kw)
    return d


def link(src, dst, ctype="main", index=0):
    return src, dst, ctype, index


def wf(nodes, *edges, **extra):
    conns = {}
    for src, dst, ctype, index in edges:
        slots = conns.setdefault(src, {}).setdefault(ctype, [])
        while len(slots) <= index:
            slots.append([])
        slots[index].append({"node": dst, "type": ctype, "index": 0})
    out = {"name": "Test flow", "nodes": nodes, "connections": conns}
    out.update(extra)
    return out


def sched(*items):
    return {"rule": {"interval": list(items)}}


def issues_of(plan, level=None, concept=None, where=None):
    return [i for i in plan["issues"] if (level is None or i["level"] == level)
            and (concept is None or i.get("concept") == concept) and (where is None or i.get("where") == where)]


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.close()


class FakeOpener:
    def __init__(self, body=b"{}"):
        self.body, self.calls = body, []

    def open(self, req, timeout=None):
        self.calls.append((req.full_url, timeout))
        return FakeResponse(self.body)


class RaisingOpener:
    def __init__(self, exc):
        self.exc = exc

    def open(self, req, timeout=None):
        raise self.exc


class ScheduleMapping(unittest.TestCase):
    def cron(self, *items):
        return n8n.schedule_cron(sched(*items))

    def test_defaults_are_daily_at_midnight(self):
        self.assertEqual(n8n.schedule_cron({}), ("0 0 * * *", []))
        self.assertEqual(self.cron({}), ("0 0 * * *", []))

    def test_seconds_and_minutes_become_hourly_with_an_issue(self):
        for field in ("seconds", "minutes"):
            cron, notes = self.cron({"field": field})
            self.assertEqual(cron, "0 * * * *")
            self.assertEqual(notes[0][0], "needs-person")
            self.assertIn("at most hourly", notes[0][1])

    def test_hours(self):
        self.assertEqual(self.cron({"field": "hours"}), ("0 * * * *", []))
        self.assertEqual(self.cron({"field": "hours", "hoursInterval": 6, "triggerAtMinute": 20}), ("20 */6 * * *", []))

    def test_hours_over_a_day_is_daily_with_an_issue(self):
        cron, notes = self.cron({"field": "hours", "hoursInterval": 30, "triggerAtMinute": 5})
        self.assertEqual(cron, "5 0 * * *")
        self.assertTrue(notes)

    def test_days(self):
        self.assertEqual(self.cron({"field": "days", "triggerAtHour": 9, "triggerAtMinute": 30}), ("30 9 * * *", []))
        self.assertEqual(self.cron({"field": "days", "daysInterval": 3, "triggerAtHour": 7}), ("0 7 */3 * *", []))

    def test_weeks_use_triggerAtDay_and_default_to_sunday(self):
        self.assertEqual(self.cron({"field": "weeks"}), ("0 0 * * 0", []))
        self.assertEqual(self.cron({"field": "weeks", "triggerAtDay": [5, 1, 1], "triggerAtHour": 8}),
                         ("0 8 * * 1,5", []))

    def test_week_interval_above_one_is_reported(self):
        cron, notes = self.cron({"field": "weeks", "weeksInterval": 2})
        self.assertEqual(cron, "0 0 * * 0")
        self.assertIn("2 weeks", notes[0][1])

    def test_months(self):
        self.assertEqual(self.cron({"field": "months"}), ("0 0 1 * *", []))
        self.assertEqual(self.cron({"field": "months", "monthsInterval": 3, "triggerAtDayOfMonth": 15,
                                    "triggerAtHour": 6, "triggerAtMinute": 45}), ("45 6 15 */3 *", []))

    def test_cron_expression_five_fields(self):
        self.assertEqual(self.cron({"field": "cronExpression", "expression": "30 8 * * 1-5"}),
                         ("30 8 * * 1-5", []))

    def test_cron_expression_six_fields_drops_seconds(self):
        self.assertEqual(self.cron({"field": "cronExpression", "expression": "0 30 8 * * 1-5"}),
                         ("30 8 * * 1-5", []))

    def test_cron_minute_that_is_not_one_number_uses_its_first_number(self):
        cron, notes = self.cron({"field": "cronExpression", "expression": "0,30 8 * * *"})
        self.assertEqual(cron, "0 8 * * *")
        self.assertEqual(notes[0][0], "needs-person")
        cron, _ = self.cron({"field": "cronExpression", "expression": "* * * * *"})
        self.assertEqual(cron, "0 * * * *")

    def test_unreadable_cron_uses_the_default(self):
        for expr in ("nonsense", "=={{ $json.x }}", None):
            cron, notes = self.cron({"field": "cronExpression", "expression": expr})
            self.assertEqual(cron, migrate.DEFAULT_CRON)
            self.assertTrue(notes)

    def test_extra_rules_are_reported(self):
        cron, notes = self.cron({"field": "days", "triggerAtHour": 4}, {"field": "hours"})
        self.assertEqual(cron, "0 4 * * *")
        self.assertIn("2 rules", notes[0][1])

    def test_every_result_passes_the_schedule_lint(self):
        import schema
        for item in ({}, {"field": "minutes"}, {"field": "hours", "hoursInterval": 4},
                     {"field": "cronExpression", "expression": "*/5 * * * *"}, {"field": "months"}):
            self.assertEqual(schema._lint_schedule(self.cron(item)[0]), [])


class Rewriter(unittest.TestCase):
    NAMES = {"Get orders": "get-orders", "Lookup": "lookup"}

    def rw(self, text):
        return n8n.rewrite(text, self.NAMES)

    def test_plain_text_is_untouched(self):
        self.assertEqual(self.rw("hello"), ("hello", [], []))
        self.assertEqual(self.rw(5), (5, [], []))

    def test_equals_prefix_without_braces_is_stripped(self):
        self.assertEqual(self.rw("=hello")[0], "hello")

    def test_previous_step_forms(self):
        for expr in ("$json.a.b", "$json[\"a\"][\"b\"]", "$json['a'].b", "$input.item.json.a.b",
                     "$input.first().json.a.b"):
            text, inputs, issues = self.rw("={{ " + expr + " }}")
            self.assertEqual(text, "`a.b` from the previous step", expr)
            self.assertEqual(inputs, ["`a.b` from the previous step"])
            self.assertEqual(issues, [])

    def test_indexes_in_a_path(self):
        self.assertEqual(self.rw("={{ $json.items[0].name }}")[0], "`items[0].name` from the previous step")

    def test_whole_previous_item(self):
        self.assertEqual(self.rw("={{ $json }}")[0], "the previous step's output")

    def test_named_step_forms(self):
        for expr in ("$('Get orders').item.json.a", "$('Get orders').first().json.a",
                     "$node[\"Get orders\"].json.a", "$node['Get orders'].json['a']"):
            text, inputs, issues = self.rw("={{ " + expr + " }}")
            self.assertEqual(text, "`a` from step `get-orders`", expr)
            self.assertEqual(inputs, ["`a` from step `get-orders`"])
            self.assertEqual(issues, [])

    def test_unknown_step_name_is_kept_with_an_issue(self):
        text, inputs, issues = self.rw("={{ $('Nope').item.json.a }}")
        self.assertIn("$('Nope')", text)
        self.assertEqual(inputs, [])
        self.assertEqual(issues[0]["level"], "needs-person")
        self.assertEqual(issues[0]["concept"], "expression")

    def test_now_and_today(self):
        self.assertEqual(self.rw("=at {{ $now }}")[0], "at the run's start time")
        self.assertEqual(self.rw("={{ $today }}")[0], "the run's start time")
        self.assertEqual(self.rw("={{ $now.toISO() }}")[0], "the run's start time")

    def test_resume_url_is_the_gate_decision_with_an_issue(self):
        text, _, issues = self.rw("={{ $execution.resumeUrl }}")
        self.assertEqual(text, "the gate decision")
        self.assertEqual(issues[0]["concept"], "expression")

    def test_anything_else_is_kept_in_backticks_with_a_needs_person_issue(self):
        text, _, issues = self.rw("={{ $json.a.map(x => x * 2) + 'z' }}")
        self.assertEqual(text, "`$json.a.map(x => x * 2) + 'z'`")
        self.assertEqual(issues[0]["level"], "needs-person")

    def test_braces_without_equals_are_rewritten_too(self):
        self.assertEqual(self.rw("Hi {{ $json.name }}!")[0], "Hi `name` from the previous step!")

    def test_several_references_keep_order_and_deduplicate(self):
        text, inputs, _ = self.rw("={{ $json.a }} {{ $('Lookup').item.json.b }} {{ $json.a }}")
        self.assertEqual(inputs, ["`a` from the previous step", "`b` from step `lookup`"])
        self.assertEqual(text.count("`a` from the previous step"), 2)


class Classification(unittest.TestCase):
    def one(self, node_obj, *more, edges=()):
        flow = wf([node("Every day", N + "scheduleTrigger", sched({"field": "days"})), node_obj] + list(more),
                  link("Every day", node_obj["name"]), *edges)
        plan = n8n.parse(flow)
        self.assertEqual(migrate.validate_plan(plan), [])
        migrate.emit(plan)
        return plan

    def test_access_follows_the_operation(self):
        for op, access in (("getAll", "read"), ("get", "read"), ("send", "write"), ("post", "write"), (None, "write")):
            params = {"operation": op} if op else {}
            step = self.one(node("Mail", N + "gmail", params))["steps"][0]
            self.assertEqual((step["app"], step["access"]), ("gmail", access), op)

    def test_expression_operation_counts_as_a_write(self):
        step = self.one(node("Mail", N + "gmail", {"operation": "={{ $json.op }}"}))["steps"][0]
        self.assertEqual(step["access"], "write")

    def test_a_missing_operation_is_reported(self):
        plan = self.one(node("Mail", N + "gmail", {}))
        self.assertTrue(any("treated as a write" in i["message"] for i in plan["issues"]))

    def test_delete_operations_carry_op_delete(self):
        step = self.one(node("Gone", N + "gmail", {"operation": "deleteMessage"}))["steps"][0]
        self.assertEqual(step["op"], "delete")
        step = self.one(node("Kept", N + "gmail", {"operation": "getAll"}))["steps"][0]
        self.assertEqual(step["op"], "getAll")

    def test_http_method_decides_access_and_headers_are_not_copied(self):
        params = {"method": "GET", "url": "https://api.example.invalid/v1/items?key=abc", "sendHeaders": True,
                  "headerParameters": {"parameters": [{"name": "X-Key", "value": "hidden-value"}]}}
        plan = self.one(node("Fetch", N + "httpRequest", params))
        step = plan["steps"][0]
        self.assertEqual((step["concept"], step["app"], step["access"]), ("step.http", "http", "read"))
        text = json.dumps(plan)
        for leak in ("hidden-value", "key=abc", "X-Key", "/v1/items"):
            self.assertNotIn(leak, text)
        self.assertIn("api.example.invalid", step["does"])
        self.assertTrue(issues_of(plan, "info", "step.http"))
        for method in ("HEAD", "GET"):
            self.assertEqual(self.one(node("F", N + "httpRequest", {"method": method}))["steps"][0]["access"], "read")
        for method in ("POST", "PUT", "DELETE", "PATCH"):
            self.assertEqual(self.one(node("F", N + "httpRequest", {"method": method}))["steps"][0]["access"],
                             "write")

    def test_http_without_a_method_is_a_get(self):
        self.assertEqual(self.one(node("F", N + "httpRequest", {"url": "https://a.example.invalid"}))
                         ["steps"][0]["access"], "read")

    def test_code_languages_and_text(self):
        js = self.one(node("C", N + "code", {"jsCode": "return items;"}))["steps"][0]
        self.assertEqual(js["code"], {"language": "javascript", "text": "return items;"})
        py = self.one(node("C", N + "code", {"language": "python", "pythonCode": "return _items"}))["steps"][0]
        self.assertEqual(py["code"], {"language": "python", "text": "return _items"})
        old = self.one(node("C", N + "function", {"functionCode": "return items;"}))["steps"][0]
        self.assertEqual(old["code"]["text"], "return items;")

    def test_agent_prompt_and_system_are_rewritten(self):
        step = self.one(node("A", L + "agent", {"text": "={{ $json.q }}", "options": {"systemMessage": "Be kind."}}))
        step = step["steps"][0]
        self.assertEqual(step["concept"], "step.agent")
        self.assertEqual(step["skill"], {"system": "Be kind.", "prompt": "`q` from the previous step"})
        self.assertEqual(step["inputs"], ["`q` from the previous step"])

    def test_chain_llm_reads_messages(self):
        params = {"messages": {"messageValues": [{"message": "One."}, {"message": "Two."}]}, "text": "Go"}
        step = self.one(node("A", L + "chainLlm", params))["steps"][0]
        self.assertEqual(step["concept"], "step.llm")
        self.assertEqual(step["skill"]["system"], "One.\n\nTwo.")

    def test_if_v2_conditions_are_stated(self):
        params = {"conditions": {"combinator": "or", "conditions": [
            {"leftValue": "={{ $json.n }}", "rightValue": 3, "operator": {"operation": "gte"}},
            {"leftValue": "={{ $json.s }}", "operator": {"operation": "notEmpty"}}]}}
        step = self.one(node("Check", N + "if", params))["steps"][0]
        self.assertIn("`n` from the previous step is at least 3 or `s` from the previous step is not empty",
                      step["does"])

    def test_legacy_if_conditions_are_stated(self):
        params = {"conditions": {"string": [{"value1": "={{ $json.k }}", "operation": "contains", "value2": "bug"}],
                                 "number": [{"value1": "={{ $json.c }}", "operation": "larger", "value2": 3}]}}
        step = self.one(node("Check", N + "if", params))["steps"][0]
        self.assertIn('`k` from the previous step contains "bug" and `c` from the previous step is greater than 3',
                      step["does"])

    def test_unreadable_branch_adds_an_info_issue(self):
        plan = self.one(node("Check", N + "if", {}))
        self.assertTrue(issues_of(plan, "info", "step.branch"))

    def test_if_outputs_name_their_targets(self):
        flow = wf([node("Every day", N + "scheduleTrigger", sched({"field": "days"})), node("Check", N + "if", {}),
                   node("Yes", N + "noOp"), node("No", N + "noOp")],
                  link("Every day", "Check"), link("Check", "Yes", "main", 0), link("Check", "No", "main", 1))
        step = next(s for s in n8n.parse(flow)["steps"] if s["id"] == "check")
        self.assertIn("The true output goes to `yes`.", step["does"])
        self.assertIn("The false output goes to `no`.", step["does"])

    def test_wait_modes(self):
        gate = self.one(node("W", N + "wait", {"resume": "webhook"}))["steps"][0]
        self.assertEqual(gate["concept"], "step.wait-approval")
        gate = self.one(node("W", N + "wait", {"resume": "form"}))["steps"][0]
        self.assertEqual(gate["concept"], "step.wait-approval")
        timed = self.one(node("W", N + "wait", {"resume": "timeInterval", "amount": 2, "unit": "hours"}))["steps"][0]
        self.assertEqual(timed["concept"], "step.wait-time")
        self.assertEqual(self.one(node("W", N + "wait", {}))["steps"][0]["concept"], "step.wait-time")

    def test_respond_and_subworkflow_are_needs_person(self):
        plan = self.one(node("R", N + "respondToWebhook"))
        self.assertTrue(issues_of(plan, "needs-person", "step.respond", "r"))
        sub = {"workflowId": {"__rl": True, "value": "x", "cachedResultName": "Child flow"}}
        plan = self.one(node("S", N + "executeWorkflow", sub))
        self.assertEqual(plan["steps"][0]["concept"], "step.subworkflow")
        self.assertIn("Child flow", plan["steps"][0]["does"])
        self.assertTrue(issues_of(plan, "needs-person", "step.subworkflow", "s"))

    def test_unknown_type_is_a_placeholder_with_an_unmapped_issue(self):
        plan = self.one(node("Mystery", "@acme/n8n-nodes-thing.thing"))
        step = plan["steps"][0]
        self.assertEqual(step["concept"], "step.unknown")
        self.assertEqual(step["title"], "Mystery")
        self.assertTrue(issues_of(plan, "unmapped", "step.unknown", "mystery"))
        pk, _ = migrate.emit(plan)
        self.assertTrue(any(s["title"] == "Needs a person: Mystery" for s in pk["stages"]))

    def test_node_error_settings(self):
        for extra in ({"onError": "continueRegularOutput"}, {"continueOnFail": True}):
            plan = self.one(node("F", N + "httpRequest", {}, **extra))
            self.assertEqual(plan["steps"][0]["on_error"], "continue")
            self.assertTrue(issues_of(plan, "info", "failure.node", "f"))
        plan = self.one(node("F", N + "httpRequest", {}, onError="stopWorkflow"))
        self.assertEqual(plan["steps"][0]["on_error"], "stop")

    def test_unverified_app_is_reported_once(self):
        plan = self.one(node("A", N + "shopify", {"operation": "get"}), node("B", N + "shopify", {"operation": "get"}),
                        edges=[link("A", "B")])
        self.assertEqual(len(issues_of(plan, "unverified", "step.app")), 1)
        plan = self.one(node("A", N + "gmail", {"operation": "get"}))
        self.assertEqual(issues_of(plan, "unverified"), [])


class Graph(unittest.TestCase):
    def test_breadth_first_with_ties_by_file_order(self):
        nodes = [node("T", N + "scheduleTrigger", sched({"field": "days"})), node("D", N + "noOp"),
                 node("B", N + "noOp"), node("C", N + "noOp"), node("A", N + "noOp")]
        plan = n8n.parse(wf(nodes, link("T", "B"), link("T", "C"), link("B", "D"), link("C", "A")))
        self.assertEqual([s["id"] for s in plan["steps"]], ["b", "c", "d", "a"])

    def test_unreachable_nodes_come_last_in_file_order_with_an_info_issue(self):
        nodes = [node("Lost", N + "noOp"), node("T", N + "scheduleTrigger", sched({"field": "days"})),
                 node("A", N + "noOp"), node("Also lost", N + "noOp")]
        plan = n8n.parse(wf(nodes, link("T", "A")))
        self.assertEqual([s["id"] for s in plan["steps"]], ["a", "lost", "also-lost"])
        self.assertEqual(len([i for i in plan["issues"] if "not connected" in i["message"]]), 2)

    def test_disabled_nodes_are_skipped_but_the_flow_passes_through(self):
        nodes = [node("T", N + "scheduleTrigger", sched({"field": "days"})), node("Off", N + "noOp", disabled=True),
                 node("After", N + "noOp")]
        plan = n8n.parse(wf(nodes, link("T", "Off"), link("Off", "After")))
        self.assertEqual([s["id"] for s in plan["steps"]], ["after"])
        self.assertTrue(any("disabled" in i["message"] for i in plan["issues"]))

    def test_loops_do_not_repeat_steps(self):
        nodes = [node("T", N + "scheduleTrigger", sched({"field": "days"})), node("A", N + "noOp"),
                 node("B", N + "noOp")]
        plan = n8n.parse(wf(nodes, link("T", "A"), link("A", "B"), link("B", "A")))
        self.assertEqual([s["id"] for s in plan["steps"]], ["a", "b"])

    def test_sticky_notes_become_notes_not_steps(self):
        nodes = [node("T", N + "scheduleTrigger", sched({"field": "days"})),
                 node("Sticky", N + "stickyNote", {"content": "Read me first."})]
        plan = n8n.parse(wf(nodes))
        self.assertEqual(plan["steps"], [])
        self.assertEqual(plan["notes"], ["Read me first."])

    def test_template_response_with_the_workflow_nested(self):
        inner = wf([node("T", N + "scheduleTrigger", sched({"field": "days"})), node("A", N + "noOp")],
                   link("T", "A"))
        del inner["name"]
        plan = n8n.parse({"id": 5, "name": "Named by the gallery", "workflow": inner})
        self.assertEqual(plan["title"], "Named by the gallery")
        self.assertEqual(plan["id"], "named-by-the-gallery")

    def test_not_a_workflow_raises(self):
        for bad in ([], {"nodes": "x"}, {"hello": 1}, "text"):
            with self.assertRaises(migrate.MigrateError):
                n8n.parse(bad)

    def test_source_is_kept_and_cleaned(self):
        flow = wf([node("T", N + "scheduleTrigger", sched({"field": "days"}))])
        src = {"tool": "other", "name": "Nice name", "ref": "n8n template 7", "url": "https://api.n8n.io/x",
               "untrusted": True}
        plan = n8n.parse(flow, src)
        self.assertEqual(plan["source"], {"tool": "n8n", "name": "Nice name", "ref": "n8n template 7",
                                          "url": "https://api.n8n.io/x", "untrusted": True})
        self.assertEqual(n8n.parse(flow)["source"], {"tool": "n8n", "name": "Test flow"})

    def test_fallback_id_and_title(self):
        flow = wf([node("T", N + "scheduleTrigger", sched({"field": "days"}))])
        del flow["name"]
        plan = n8n.parse(flow)
        self.assertEqual(plan["id"], "migrated-routine")
        self.assertTrue(plan["title"])


class Malformed(unittest.TestCase):
    def test_broken_shapes_raise_migrate_error_only(self):
        good = node("T", N + "scheduleTrigger", sched({"field": "days"}))
        cases = [
            [], "x", None, 5, {"nodes": None}, {"nodes": {}},
            {"nodes": ["text"]}, {"nodes": [None]}, {"nodes": [{"name": "A"}]}, 
            {"nodes": [{"name": 1, "type": "x"}]}, {"nodes": [{"name": "A", "type": 3}]},
            {"nodes": [{"name": "A", "type": ""}]},
            {"nodes": [dict(good, parameters=[])]},
            {"nodes": [good], "connections": []},
            {"nodes": [good], "connections": "no"},
        ]
        for case in cases:
            with self.assertRaises(migrate.MigrateError, msg=repr(case)):
                n8n.parse(case)

    def test_nameless_sticky_note_and_nameless_nodes(self):
        good = node("T", N + "scheduleTrigger", sched({"field": "days"}))
        sticky = {"type": N + "stickyNote", "parameters": {"content": "A real note."}}
        plan = n8n.parse({"nodes": [sticky, good, {"type": N + "noOp"}], "connections": {}})
        self.assertEqual(plan["notes"], ["A real note."])
        self.assertEqual(plan["steps"], [])
        found = [i for i in plan["issues"] if "has no name" in i["message"]]
        self.assertEqual([i["level"] for i in found], ["needs-person"])
        self.assertIn("A noOp node (position 3)", found[0]["message"])
        self.assertNotIn(N, found[0]["message"])
        self.assertEqual(migrate.validate_plan(plan), [])
        with self.assertRaises(migrate.MigrateError):
            n8n.parse({"nodes": [good, {"name": "", "type": N + "noOp"}]})

    def test_error_names_the_index_not_the_value(self):
        with self.assertRaises(migrate.MigrateError) as cm:
            n8n.parse({"nodes": [node("T", N + "scheduleTrigger"), {"name": "secret-ish", "type": 5}]})
        self.assertIn("node 2", str(cm.exception))
        self.assertNotIn("secret-ish", str(cm.exception))

    def test_malformed_connection_entries_are_skipped(self):
        good = node("T", N + "scheduleTrigger", sched({"field": "days"}))
        flow = {"nodes": [good, node("A", N + "noOp")], "connections": {
            "T": {"main": [[{"node": ["A"]}, "x", {"node": None}, {"node": "A"}], "bad", None]},
            "A": "nope", "Ghost": {"main": [[{"node": "A"}]]}}}
        plan = n8n.parse(flow)
        self.assertEqual([s["id"] for s in plan["steps"]], ["a"])
        self.assertEqual(migrate.validate_plan(plan), [])


class Needs(unittest.TestCase):
    def flow(self):
        nodes = [node("T", N + "scheduleTrigger", sched({"field": "days"})),
                 node("Note", N + "stickyNote", {"content": "hi"}),
                 node("Read", N + "gmail", {"operation": "getAll"}),
                 node("Agent", L + "agent", {"text": "={{ $json.subject }}"}),
                 node("Model", L + "lmChatOpenAi", {"model": "={{ $('Read').item.json.m }}"}),
                 node("Off", N + "noOp", disabled=True),
                 node("Send", N + "gmail", {"operation": "send", "message": "={{ $('Agent').item.json.text }}"}),
                 node("Log", N + "googleSheets", {"operation": "append", "value": "={{ $json.id }}"})]
        return wf(nodes, link("T", "Read"), link("Read", "Agent"), link("Model", "Agent", "ai_languageModel"),
                  link("Agent", "Off"), link("Off", "Send"), link("Send", "Log"))

    def needs(self, plan):
        return {s["id"]: s.get("needs") for s in plan["steps"]}

    def test_needs_follow_references_and_flow(self):
        plan = n8n.parse(self.flow())
        self.assertEqual(self.needs(plan), {"read": None, "agent": ["read"], "send": ["agent"], "log": ["send"]})

    def test_trigger_and_sticky_note_never_appear(self):
        plan = n8n.parse(self.flow())
        for s in plan["steps"]:
            self.assertFalse({"trigger", "note"} & set(s.get("needs", [])))

    def test_named_reference_to_a_skipped_node_uses_its_ancestor(self):
        flow = self.flow()
        flow["nodes"][6]["parameters"]["message"] = "={{ $node[\"Off\"].json.x }} and $node.Note"
        self.assertEqual(self.needs(n8n.parse(flow))["send"], ["agent"])

    def test_flow_predecessor_is_always_a_need_beside_explicit_references(self):
        flow = self.flow()
        flow["nodes"].append(node("Late", N + "gmail", {"operation": "get", "id": "={{ $('Read').item.json.id }}"}))
        flow["connections"]["Log"] = {"main": [[{"node": "Late", "type": "main", "index": 0}]]}
        plan = n8n.parse(flow)
        self.assertEqual(self.needs(plan)["late"], ["read", "log"])

    def test_no_expressions_means_the_previous_step(self):
        plan = n8n.parse(wf([node("T", N + "scheduleTrigger", sched({"field": "days"})),
                             node("A", N + "gmail", {"operation": "getAll"}), node("B", N + "noOp")],
                            link("T", "A"), link("A", "B")))
        self.assertEqual(self.needs(plan), {"a": None, "b": ["a"]})

    def test_no_self_reference_and_sorted_without_duplicates(self):
        nodes = [node("T", N + "scheduleTrigger", sched({"field": "days"})), node("A", N + "noOp"),
                 node("B", N + "noOp"),
                 node("C", N + "gmail", {"operation": "send", "m": "={{ $('B').item.json.a }}{{ $('A').item.json.a }}"
                                         "{{ $('B').item.json.b }}{{ $('C').item.json.c }}"})]
        plan = n8n.parse(wf(nodes, link("T", "A"), link("A", "B"), link("B", "C")))
        self.assertEqual(self.needs(plan)["c"], ["a", "b"])

    def test_data_free_expressions_behave_like_no_expressions(self):
        plan = n8n.parse(wf([node("T", N + "scheduleTrigger", sched({"field": "days"})),
                             node("A", N + "gmail", {"operation": "getAll"}),
                             node("B", N + "gmail", {"operation": "send", "subject": "=At {{ $now }}"})],
                            link("T", "A"), link("A", "B")))
        self.assertEqual(self.needs(plan), {"a": None, "b": ["a"]})

    def test_explicit_reference_plus_json_keeps_the_predecessor(self):
        flow = self.flow()
        flow["nodes"][6]["parameters"]["message"] = "={{ $('Read').item.json.a }} {{ $json.b }}"
        self.assertEqual(self.needs(n8n.parse(flow))["send"], ["read", "agent"])

    def test_reference_to_a_missing_node_is_reported_and_not_explicit(self):
        flow = self.flow()
        flow["nodes"][6]["parameters"]["message"] = ("={{ $('Gone').item.json.a }} {{ $('Gone').item.json.b }} "
                                                      "{{ $node[\"Gone\"].json.c }}")
        plan = n8n.parse(flow)
        self.assertEqual(self.needs(plan)["send"], ["agent"])
        found = [i for i in plan["issues"] if "refers to a node named" in i["message"]]
        self.assertEqual(len(found), 1)
        self.assertEqual((found[0]["level"], found[0]["where"]), ("needs-person", "send"))
        self.assertIn("'Gone' that is not in this workflow", found[0]["message"])

    def test_missing_node_name_is_cleaned_and_cut(self):
        flow = self.flow()
        flow["nodes"][6]["parameters"]["message"] = "={{ $('" + fake_key() + "').item.json.a }}"
        found = [i["message"] for i in n8n.parse(flow)["issues"] if "refers to a node named" in i["message"]]
        self.assertEqual(len(found), 1)
        self.assertNotIn(fake_key(), found[0])
        self.assertIn("[removed]", found[0])
        flow["nodes"][6]["parameters"]["message"] = "={{ $('" + "x" * 200 + "').item.json.a }}"
        found = [i["message"] for i in n8n.parse(flow)["issues"] if "refers to a node named" in i["message"]]
        self.assertNotIn("x" * 81, found[0])

    def test_poll_step_is_a_valid_need(self):
        flow = wf([node("New mail", N + "gmailTrigger", {}), node("Next", N + "noOp")], link("New mail", "Next"))
        self.assertEqual(self.needs(n8n.parse(flow)), {"new-mail": None, "next": ["new-mail"]})

    def test_deterministic_and_every_fixture_needs_name_real_steps(self):
        self.assertEqual(json.dumps(n8n.parse(self.flow())), json.dumps(n8n.parse(self.flow())))
        for path in sorted(glob.glob(os.path.join(FIXTURES, "*.json"))):
            plan = n8n.parse(load(os.path.basename(path)))
            ids = [s["id"] for s in plan["steps"]]
            for i, s in enumerate(plan["steps"]):
                for need in s.get("needs", []):
                    self.assertIn(need, ids[:i], path)

    EXPECTED = {
        "approval-write.json": {
            "read-sheet": None,
            "wait-for-approval": [
                "read-sheet"
            ],
            "post-to-channel": [
                "wait-for-approval"
            ],
            "send-summary": ["post-to-channel"],
            "pause-a-day": [
                "send-summary"
            ],
            "remove-row": [
                "pause-a-day"
            ]
        },
        "chat-agent.json": {
            "support-agent": None
        },
        "control-flow.json": {
            "fetch-items": None,
            "big-enough": [
                "fetch-items"
            ],
            "legacy-check": [
                "big-enough"
            ],
            "skip": [
                "big-enough"
            ],
            "route-by-kind": [
                "legacy-check"
            ],
            "tag-bug": [
                "fetch-items",
                "route-by-kind"
            ],
            "tag-idea": [
                "route-by-kind"
            ],
            "combine": [
                "tag-bug",
                "tag-idea"
            ],
            "each-batch": [
                "combine"
            ],
            "strange-set": [
                "each-batch"
            ]
        },
        "schedule-app.json": {
            "get-orders": None,
            "summarise-orders": [
                "get-orders"
            ],
            "post-digest": [
                "summarise-orders"
            ]
        },
        "static-unknown.json": {
            "hourly-poll": None,
            "community-step": [
                "hourly-poll"
            ],
            "lonely-code": None
        },
        "subworkflow-error.json": {
            "call-helper": None,
            "tell-someone": None,
            "fragile-call": [
                "call-helper"
            ],
            "stop-here": [
                "fragile-call"
            ]
        },
        "webhook-code-respond.json": {
            "score-lead": None,
            "python-tidy": [
                "score-lead"
            ],
            "call-scoring-service": [
                "python-tidy"
            ],
            "reply": [
                "call-scoring-service"
            ]
        }
    }

    def test_exact_needs_for_each_fixture(self):
        for name, want in self.EXPECTED.items():
            plan = n8n.parse(load(name))
            self.assertEqual({s["id"]: s.get("needs") for s in plan["steps"]}, want, name)


class Triggers(unittest.TestCase):
    def trigger(self, node_obj, **extra):
        plan = n8n.parse(wf([node_obj], **extra))
        self.assertEqual(migrate.validate_plan(plan), [])
        return plan

    def test_event_triggers_get_the_default_schedule_and_an_issue(self):
        cases = {N + "webhook": "trigger.webhook", N + "formTrigger": "trigger.form",
                 L + "chatTrigger": "trigger.chat", N + "manualTrigger": "trigger.manual",
                 N + "executeWorkflowTrigger": "trigger.subworkflow"}
        for t, cid in cases.items():
            plan = self.trigger(node("In", t))
            self.assertEqual(plan["trigger"]["concept"], cid, t)
            self.assertEqual(plan["trigger"]["cron"], migrate.DEFAULT_CRON, t)
            self.assertTrue(issues_of(plan, concept=cid, where="trigger"), t)
        self.assertTrue(issues_of(self.trigger(node("In", N + "webhook")), "needs-person"))

    def test_app_trigger_polls_hourly_with_a_read_step_at_the_front(self):
        flow = wf([node("New mail", N + "gmailTrigger", {}, credentials={"gmailOAuth2": {"id": "x1", "name": "Box"}}),
                   node("Next", N + "noOp")], link("New mail", "Next"))
        plan = n8n.parse(flow)
        self.assertEqual(plan["trigger"], {"concept": "trigger.app", "cron": "0 * * * *",
                                           "note": plan["trigger"]["note"]})
        first = plan["steps"][0]
        self.assertEqual((first["id"], first["concept"], first["app"], first["access"]),
                         ("new-mail", "step.app", "gmail", "read"))
        self.assertEqual(plan["connectors"], [{"id": "gmail", "app": "gmail", "access": "read"}])
        self.assertEqual(plan["credentials"], [{"type": "gmailOAuth2", "name": "Box", "step": "new-mail"}])
        self.assertEqual(plan["steps"][1]["id"], "next")
        self.assertEqual(migrate.validate_plan(plan), [])
        migrate.emit(plan)

    def test_rss_trigger_polls_through_http(self):
        plan = self.trigger(node("Feed", N + "rssFeedReadTrigger"))
        self.assertEqual((plan["steps"][0]["app"], plan["steps"][0]["access"]), ("http", "read"))

    def test_unknown_trigger_is_a_placeholder_poll(self):
        plan = self.trigger(node("Odd", "@acme/n8n-nodes-thing.thingTrigger"))
        self.assertEqual(plan["trigger"]["concept"], "trigger.app")
        self.assertEqual(plan["steps"][0]["concept"], "step.unknown")
        self.assertTrue(issues_of(plan, "unmapped", "step.unknown"))

    def test_legacy_cron_is_unverified_and_gets_the_default(self):
        plan = self.trigger(node("Old", N + "cron", {"triggerTimes": {"item": [{"mode": "everyHour"}]}}))
        self.assertEqual(plan["trigger"]["cron"], migrate.DEFAULT_CRON)
        self.assertTrue(issues_of(plan, "unverified", "trigger.schedule", "trigger"))

    def test_schedule_trigger_reads_its_rule(self):
        plan = self.trigger(node("S", N + "scheduleTrigger", sched({"field": "hours", "hoursInterval": 3})))
        self.assertEqual(plan["trigger"], {"concept": "trigger.schedule", "cron": "0 */3 * * *"})

    def test_sub_hourly_schedule_is_reported(self):
        plan = self.trigger(node("S", N + "scheduleTrigger", sched({"field": "minutes"})))
        self.assertEqual(plan["trigger"]["cron"], "0 * * * *")
        self.assertTrue(issues_of(plan, "needs-person", "trigger.schedule", "trigger"))

    def test_timezone_is_kept_and_reported(self):
        plan = self.trigger(node("S", N + "scheduleTrigger", sched({"field": "days"})),
                            settings={"timezone": "Asia/Tokyo"})
        self.assertEqual(plan["trigger"]["timezone"], "Asia/Tokyo")
        self.assertTrue(any("Asia/Tokyo" in i["message"] for i in issues_of(plan, "info", where="trigger")))

    def test_schedule_beats_manual_and_the_other_is_reported(self):
        plan = n8n.parse(wf([node("Hand", N + "manualTrigger"),
                             node("S", N + "scheduleTrigger", sched({"field": "days"}))]))
        self.assertEqual(plan["trigger"]["concept"], "trigger.schedule")
        self.assertTrue(any("second trigger" in i["message"] for i in plan["issues"]))

    def test_no_trigger_uses_the_default_and_says_so(self):
        plan = n8n.parse(wf([node("A", N + "noOp")]))
        self.assertEqual(plan["trigger"]["cron"], migrate.DEFAULT_CRON)
        self.assertEqual([s["id"] for s in plan["steps"]], ["a"])


class FailureAndState(unittest.TestCase):
    def test_error_workflow_setting_sets_failure_alert(self):
        base = wf([node("T", N + "scheduleTrigger", sched({"field": "days"}))])
        self.assertNotIn("failure", n8n.parse(base))
        for ew in ("DEFAULT", "", None):
            self.assertNotIn("failure", n8n.parse(dict(base, settings={"errorWorkflow": ew})))
        plan = n8n.parse(dict(base, settings={"errorWorkflow": "wf-1"}))
        self.assertTrue(plan["failure"]["alert"])
        self.assertTrue(issues_of(plan, "info", "failure.workflow"))

    def test_error_trigger_sets_failure_alert(self):
        plan = n8n.parse(wf([node("On error", N + "errorTrigger"), node("Tell", N + "noOp")],
                            link("On error", "Tell")))
        self.assertEqual(plan["trigger"]["concept"], "trigger.error")
        self.assertTrue(plan["failure"]["alert"])
        self.assertEqual([s["id"] for s in plan["steps"]], ["tell"])

    def test_static_data_becomes_a_state_collection(self):
        base = wf([node("T", N + "scheduleTrigger", sched({"field": "days"}))])
        self.assertNotIn("collections", n8n.parse(dict(base, staticData={})))
        plan = n8n.parse(dict(base, staticData={"global": {"cursor": 9}}))
        self.assertEqual(plan["collections"], ["state/workflow"])
        self.assertTrue(issues_of(plan, "info", "step.store"))
        self.assertNotIn("cursor", json.dumps(plan))


class AiFolding(unittest.TestCase):
    def setUp(self):
        self.plan = n8n.parse(load("chat-agent.json"))

    def test_sub_nodes_are_not_steps(self):
        self.assertEqual([s["id"] for s in self.plan["steps"]], ["support-agent"])

    def test_model_provider_is_recorded_as_info(self):
        found = issues_of(self.plan, "info", "step.ai-model", "support-agent")
        self.assertEqual(len(found), 1)
        self.assertIn("lmChatOpenAi", found[0]["message"])
        self.assertIn("Claude", found[0]["message"])

    def test_memory_becomes_a_collection(self):
        self.assertEqual(self.plan["collections"], ["memory/support-agent"])
        self.assertTrue(issues_of(self.plan, "info", "step.ai-memory", "support-agent"))

    def test_app_tools_become_connectors_with_access_from_the_operation(self):
        step = self.plan["steps"][0]
        self.assertEqual(sorted(step["connectors"]), ["gmail", "gmail-write"])
        self.assertEqual(sorted((c["id"], c["access"]) for c in self.plan["connectors"]),
                         [("gmail", "read"), ("gmail-write", "write")])

    def test_workflow_tool_is_needs_person_with_the_cached_name(self):
        found = issues_of(self.plan, "needs-person", "step.subworkflow", "support-agent")
        self.assertEqual(len(found), 1)
        self.assertIn("Escalation helper", found[0]["message"])

    def test_vector_and_embeddings_are_unmapped(self):
        found = issues_of(self.plan, "unmapped", "step.ai-vector", "support-agent")
        self.assertEqual(len(found), 2)

    def test_credentials_of_sub_nodes_belong_to_the_root_step(self):
        steps = {c["step"] for c in self.plan["credentials"]}
        self.assertEqual(steps, {"support-agent"})
        self.assertEqual({c["type"] for c in self.plan["credentials"]}, {"openAiApi", "gmailOAuth2"})

    def test_trigger_reference_names_the_trigger(self):
        self.assertEqual(self.plan["steps"][0]["inputs"], ["`chatInput` from step `trigger`"])

    def test_kind_is_skill_and_the_write_tool_gates_the_pack(self):
        self.assertEqual(self.plan["kind"], "skill")
        pk, _ = migrate.emit(self.plan)
        self.assertEqual(pk["routine"]["routine"]["type"], "approval-gated")

    def test_output_parser_shape_goes_into_the_system_text(self):
        flow = wf([node("T", N + "scheduleTrigger", sched({"field": "days"})),
                   node("Agent", L + "agent", {"text": "Go", "options": {"systemMessage": "Be exact."}}),
                   node("Parser", L + "outputParserStructured", {"jsonSchemaExample": "{\"a\": 1}"})],
                  link("T", "Agent"), link("Parser", "Agent", "ai_outputParser"))
        plan = n8n.parse(flow)
        self.assertEqual([s["id"] for s in plan["steps"]], ["agent"])
        self.assertIn("Output shape: {\"a\": 1}", plan["steps"][0]["skill"]["system"])
        self.assertTrue(issues_of(plan, "info", "step.ai-output-parser", "agent"))

    def test_http_tool_becomes_an_http_connector(self):
        flow = wf([node("T", N + "scheduleTrigger", sched({"field": "days"})),
                   node("Agent", L + "agent", {"text": "Go"}),
                   node("Web", L + "toolHttpRequest", {"method": "GET", "url": "https://x.example.invalid/a"})],
                  link("T", "Agent"), link("Web", "Agent", "ai_tool"))
        plan = n8n.parse(flow)
        self.assertEqual(plan["steps"][0]["connectors"], ["http"])
        self.assertEqual(plan["connectors"], [{"id": "http", "app": "http", "access": "read"}])

    def test_disabled_sub_node_is_skipped(self):
        flow = wf([node("T", N + "scheduleTrigger", sched({"field": "days"})),
                   node("Agent", L + "agent", {"text": "Go"}),
                   node("Mail", N + "gmailTool", {"operation": "send"}, disabled=True)],
                  link("T", "Agent"), link("Mail", "Agent", "ai_tool"))
        plan = n8n.parse(flow)
        self.assertNotIn("connectors", plan["steps"][0])


class Credentials(unittest.TestCase):
    def test_type_and_name_only_never_the_id(self):
        for path in sorted(glob.glob(os.path.join(FIXTURES, "*.json"))):
            plan = n8n.parse(load(os.path.basename(path)))
            self.assertNotIn("cred-id-0001", json.dumps(plan), path)
            for c in plan.get("credentials", []):
                self.assertEqual(set(c) - {"step"}, {"type", "name"})

    def test_a_credential_needs_a_person(self):
        plan = n8n.parse(load("schedule-app.json"))
        self.assertEqual(plan["credentials"], [{"type": "shopifyApi", "name": "Example shop", "step": "get-orders"},
                                               {"type": "slackApi", "name": "Example workspace",
                                                "step": "post-digest"}])
        self.assertTrue(issues_of(plan, "setup", "credential", "get-orders"))


class Fixtures(unittest.TestCase):
    NAMES = sorted(os.path.basename(p) for p in glob.glob(os.path.join(FIXTURES, "*.json")))

    def swap(self):
        return {"@@KEY@@": fake_key(), "@@EMAIL@@": fake_email(), "@@SLACK@@": fake_slack_id()}

    def test_every_fixture_is_present(self):
        self.assertEqual(self.NAMES, ["approval-write.json", "chat-agent.json", "control-flow.json",
                                      "schedule-app.json", "static-unknown.json", "subworkflow-error.json",
                                      "token-leak.json", "webhook-code-respond.json"])

    def test_every_fixture_converts_and_the_pack_validates(self):
        for name in self.NAMES:
            plan = n8n.parse(load(name, self.swap()))
            self.assertEqual(migrate.validate_plan(plan), [], name)
            pk, report = migrate.emit(plan)
            self.assertEqual(pack.validate(pk), [], name)
            self.assertTrue(report, name)
            self.assertEqual(plan["category"], "general")

    def test_parse_is_deterministic(self):
        for name in self.NAMES:
            self.assertEqual(json.dumps(n8n.parse(load(name))), json.dumps(n8n.parse(load(name))), name)

    def test_parse_does_not_change_its_input(self):
        for name in self.NAMES:
            flow = load(name)
            before = copy.deepcopy(flow)
            n8n.parse(flow)
            self.assertEqual(flow, before, name)

    def test_schedule_app(self):
        plan = n8n.parse(load("schedule-app.json"))
        self.assertEqual(plan["trigger"], {"concept": "trigger.schedule", "cron": "15 9 * * 1,2,3,4,5",
                                           "timezone": "Europe/Berlin"})
        self.assertEqual([(s["id"], s["concept"]) for s in plan["steps"]],
                         [("get-orders", "step.app"), ("summarise-orders", "step.llm"), ("post-digest", "step.app")])
        self.assertEqual(plan["steps"][1]["inputs"], ["`title` from the previous step",
                                                      "`shop` from step `get-orders`"])
        self.assertEqual(plan["notes"], ["Runs each weekday morning. Synthetic example."])
        self.assertEqual(plan["source"], {"tool": "n8n", "name": "Weekday order digest"})
        self.assertEqual(migrate.emit(plan)[0]["routine"]["routine"]["type"], "approval-gated")

    def test_webhook_code_respond(self):
        plan = n8n.parse(load("webhook-code-respond.json"))
        self.assertEqual(plan["trigger"]["concept"], "trigger.webhook")
        self.assertEqual([s["concept"] for s in plan["steps"]], ["step.code", "step.code", "step.http", "step.respond"])
        self.assertEqual([s.get("code", {}).get("language") for s in plan["steps"][:2]], ["javascript", "python"])
        self.assertEqual(plan["steps"][2]["access"], "write")
        self.assertEqual(plan["kind"], "hybrid")
        text = json.dumps(plan)
        for leak in ("not-copied", "token=abc", "X-Auth"):
            self.assertNotIn(leak, text)

    def test_control_flow(self):
        plan = n8n.parse(load("control-flow.json"))
        concepts = {s["id"]: s["concept"] for s in plan["steps"]}
        self.assertEqual(concepts, {"fetch-items": "step.http", "big-enough": "step.branch",
                                    "legacy-check": "step.branch", "skip": "step.noop", "route-by-kind": "step.branch",
                                    "tag-bug": "step.transform", "tag-idea": "step.transform", "combine": "step.merge",
                                    "each-batch": "step.loop", "strange-set": "step.transform"})
        does = {s["id"]: s["does"] for s in plan["steps"]}
        self.assertIn("is greater than 10 and", does["big-enough"])
        self.assertIn("bugs:", does["route-by-kind"])
        self.assertIn('`label` = "bug"', does["tag-bug"])
        self.assertIn("`tag-bug`, `tag-idea`", does["combine"])
        self.assertEqual(plan["trigger"]["concept"], "trigger.manual")

    def test_approval_write(self):
        plan = n8n.parse(load("approval-write.json"))
        self.assertEqual([s["concept"] for s in plan["steps"]], [
            "step.app", "step.wait-approval", "step.app", "step.app", "step.wait-time", "step.app"])
        self.assertEqual([s.get("access") for s in plan["steps"] if s["concept"] == "step.app"],
                         ["read", "write", "write", "write"])
        self.assertEqual(plan["steps"][-1]["op"], "delete")
        self.assertEqual(plan["trigger"]["cron"], "0 12 * * *")
        pk, _ = migrate.emit(plan)
        self.assertEqual(pk["routine"]["routine"]["type"], "approval-gated")
        self.assertTrue(any(a["kind"] == "delete" for a in pk["routine"]["action"]))
        self.assertTrue(any(a["kind"] == "send" for a in pk["routine"]["action"]))

    def test_subworkflow_error(self):
        plan = n8n.parse(load("subworkflow-error.json"))
        self.assertEqual(plan["trigger"]["cron"], "10 */2 * * *")
        self.assertTrue(issues_of(plan, "needs-person", "trigger.schedule", "trigger"))
        concepts = {s["id"]: s for s in plan["steps"]}
        self.assertEqual(concepts["call-helper"]["concept"], "step.subworkflow")
        self.assertIn("Helper flow", concepts["call-helper"]["does"])
        self.assertEqual(concepts["fragile-call"]["on_error"], "continue")
        self.assertEqual(concepts["stop-here"]["concept"], "failure.node")
        self.assertTrue(plan["failure"]["alert"])
        self.assertTrue(issues_of(plan, "info", "failure.workflow"))

    def test_static_unknown(self):
        plan = n8n.parse(load("static-unknown.json"))
        self.assertEqual(plan["collections"], ["state/workflow"])
        concepts = {s["id"]: s["concept"] for s in plan["steps"]}
        self.assertEqual(concepts, {"hourly-poll": "step.unknown", "community-step": "step.unknown",
                                    "lonely-code": "step.code"})
        self.assertTrue(issues_of(plan, "unmapped", "step.unknown", "community-step"))
        self.assertTrue(any("disabled" in i["message"] for i in plan["issues"]))
        self.assertTrue(any("not connected" in i["message"] for i in plan["issues"]))

    def test_every_non_mapped_concept_has_an_issue_at_the_right_level(self):
        for name in self.NAMES:
            plan = n8n.parse(load(name, self.swap()))
            pairs = [("trigger", plan["trigger"]["concept"])] + [(s["id"], s["concept"]) for s in plan["steps"]]
            for where, cid in pairs:
                status = migrate.concept(cid)["status"]
                if status in ("needs-person", "unmapped"):
                    self.assertTrue(issues_of(plan, status, cid, where), f"{name}: {cid} at {where}")
                elif status == "partial" and cid in ("trigger.app", "trigger.manual", "step.wait-time"):
                    self.assertTrue(issues_of(plan, "info", cid, where), f"{name}: {cid} at {where}")

    def test_secrets_are_removed_and_reported_by_field(self):
        swap = self.swap()
        plan = n8n.parse(load("token-leak.json", swap))
        pk, report = migrate.emit(plan)
        blob = json.dumps(plan) + json.dumps(pk) + report
        for value in swap.values():
            self.assertNotIn(value, blob)
        self.assertEqual(pack.validate(pk), [])
        removed = [i for i in plan["issues"] if i.get("kind") == "removed"]
        text = " ".join(i["message"] for i in removed)
        self.assertIn("secret-shaped value", text)
        self.assertIn("an email address", text)
        self.assertIn("a Slack-style id", text)
        self.assertTrue(plan["title"].startswith("Notify [removed]"))
        self.assertNotIn(swap["@@KEY@@"], plan["id"])
        self.assertIn("[removed]", plan["steps"][0]["does"])
        self.assertIn("[removed]", plan["steps"][2]["code"]["text"])
        self.assertEqual(plan["trigger"]["cron"], "5 9 * * 1-5")

    def test_no_literal_secret_email_or_slack_id_in_the_fixtures(self):
        import re
        import appmodel
        for name in self.NAMES:
            with open(os.path.join(FIXTURES, name), encoding="utf-8") as fh:
                text = fh.read()
            self.assertIsNone(pack.EMAIL_RE.search(text), name)
            self.assertIsNone(pack.SLACK_ID_RE.search(text), name)
            self.assertFalse(any(p.search(text) for p in appmodel.SECRET_PATTERNS), name)
            self.assertNotIn(chr(0x2014), text)
            self.assertIsNone(re.search(r"https?://(?!api\.n8n\.io)[^\"/]*(?<!\.invalid)[/\"]", text), name)


class Gallery(unittest.TestCase):
    def search_body(self, count=3):
        return json.dumps({"totalWorkflows": 1234, "filters": [], "workflows": [
            {"id": 100 + i, "name": f"Template {i}", "totalViews": 50 - i, "user": {"username": "someone"}}
            for i in range(count)]}).encode()

    def test_search_url_and_result_shape(self):
        opener = FakeOpener(self.search_body())
        out = n8n.search("send emails", rows=5, opener=opener)
        self.assertEqual(opener.calls[0][0],
                         "https://api.n8n.io/api/templates/search?rows=5&page=1&search=send%20emails")
        self.assertEqual(opener.calls[0][1], pack.FETCH_TIMEOUT)
        self.assertEqual(out["total"], 1234)
        self.assertEqual(out["results"][0], {"id": 100, "name": "Template 0", "views": 50})
        self.assertEqual(len(out["results"]), 3)

    def test_search_quotes_the_query(self):
        opener = FakeOpener(self.search_body())
        n8n.search("a&b=c/d é", opener=opener)
        url = opener.calls[0][0]
        self.assertTrue(url.endswith("&search=a%26b%3Dc%2Fd%20%C3%A9"), url)

    def test_rows_are_clamped(self):
        for given, used in ((None, 10), (0, 1), (-4, 1), (1, 1), (20, 20), (500, 20), ("7", 7)):
            opener = FakeOpener(self.search_body())
            if given is None:
                n8n.search("x", opener=opener)
            else:
                n8n.search("x", rows=given, opener=opener)
            self.assertIn(f"rows={used}&page=1", opener.calls[0][0], given)

    def test_results_never_exceed_rows(self):
        out = n8n.search("x", rows=2, opener=FakeOpener(self.search_body(6)))
        self.assertEqual(len(out["results"]), 2)

    def test_search_refuses_bad_input_before_any_call(self):
        for q, rows in (("", 5), ("   ", 5), (None, 5), ("x" * 201, 5), ("x", "many")):
            opener = FakeOpener()
            with self.assertRaises(migrate.MigrateError, msg=repr((q, rows))):
                n8n.search(q, rows=rows, opener=opener)
            self.assertEqual(opener.calls, [])

    def test_search_is_capped_at_one_mebibyte(self):
        with self.assertRaises(migrate.MigrateError) as cm:
            n8n.search("x", opener=FakeOpener(b" " * (n8n.SEARCH_CAP + 1)))
        self.assertIn("limit", str(cm.exception))
        self.assertEqual(n8n.SEARCH_CAP, 1024 * 1024)

    def test_search_names_are_sanitised(self):
        body = json.dumps({"totalWorkflows": 1, "workflows": [{"id": 1, "name": "Mail " + fake_email(),
                                                               "totalViews": 3}]}).encode()
        out = n8n.search("x", opener=FakeOpener(body))
        self.assertEqual(out["results"][0]["name"], "Mail [removed]")

    def test_search_errors_are_migrate_errors(self):
        with self.assertRaises(migrate.MigrateError):
            n8n.search("x", opener=FakeOpener(b"not json"))
        with self.assertRaises(migrate.MigrateError):
            n8n.search("x", opener=FakeOpener(b"[]"))
        err = urllib.error.HTTPError("https://api.n8n.io/x", 503, "no", {}, None)
        with self.assertRaises(migrate.MigrateError) as cm:
            n8n.search("x", opener=RaisingOpener(err))
        self.assertIn("HTTP 503", str(cm.exception))

    def test_search_with_no_workflows_key(self):
        out = n8n.search("x", opener=FakeOpener(b'{"totalWorkflows": 0}'))
        self.assertEqual(out, {"total": 0, "results": []})

    def template_body(self, **over):
        inner = load("schedule-app.json")
        del inner["name"]
        meta = {"id": 4321, "name": "Gallery name", "description": "A short blurb.", "views": 0, "totalViews": 77,
                "nodes": [{"id": 1, "name": "Gallery node", "displayName": "Gallery node"}],
                "workflow": {"meta": {}, "pinData": {}, "nodes": inner["nodes"],
                             "connections": inner["connections"]}}
        meta.update(over)
        return json.dumps({"workflow": meta}).encode()

    def test_fetch_url_source_and_workflow(self):
        opener = FakeOpener(self.template_body())
        workflow, source = n8n.fetch("4321", opener=opener)
        self.assertEqual(opener.calls[0][0], "https://api.n8n.io/api/templates/workflows/4321")
        self.assertEqual(source, {"tool": "n8n", "name": "Gallery name", "ref": "n8n template 4321",
                                  "url": "https://api.n8n.io/api/templates/workflows/4321", "untrusted": True})
        self.assertEqual(workflow["name"], "Gallery name")
        self.assertTrue(workflow["nodes"])

    def test_fetched_workflow_parses_with_its_source(self):
        workflow, source = n8n.fetch(4321, opener=FakeOpener(self.template_body()))
        plan = n8n.parse(workflow, source)
        self.assertEqual(plan["source"], source)
        self.assertEqual(plan["title"], "Gallery name")
        self.assertEqual(plan["summary"], "A short blurb.")
        self.assertEqual(migrate.validate_plan(plan), [])
        pk, report = migrate.emit(plan)
        self.assertEqual(pack.validate(pk), [])
        self.assertIn("n8n template 4321", report)

    def test_fetch_refuses_anything_but_digits_before_any_call(self):
        for bad in ("", "abc", "12a", "../1", "1/2", "1\n", " 1", "-1", "1" * 13, "1?x=2", None, True, 1.5, [1]):
            opener = FakeOpener()
            with self.assertRaises(migrate.MigrateError, msg=repr(bad)):
                n8n.fetch(bad, opener=opener)
            self.assertEqual(opener.calls, [], repr(bad))

    def test_fetch_accepts_twelve_digits(self):
        opener = FakeOpener(self.template_body())
        n8n.fetch("123456789012", opener=opener)
        self.assertTrue(opener.calls[0][0].endswith("/workflows/123456789012"))

    def test_fetch_is_capped_at_two_mebibytes(self):
        with self.assertRaises(migrate.MigrateError) as cm:
            n8n.fetch("1", opener=FakeOpener(b" " * (n8n.FETCH_CAP + 1)))
        self.assertIn("limit", str(cm.exception))
        self.assertEqual(n8n.FETCH_CAP, 2 * 1024 * 1024)

    def test_fetch_flat_shape_needs_connections(self):
        flat = json.dumps({"workflow": {"name": "Flat", "nodes": [], "connections": {}}}).encode()
        self.assertEqual(n8n.fetch("1", opener=FakeOpener(flat))[0]["name"], "Flat")
        with self.assertRaises(migrate.MigrateError):
            n8n.fetch("1", opener=FakeOpener(b'{"workflow": {"nodes": [{"name": "meta only"}]}}'))

    def test_search_prefers_total_views(self):
        body = json.dumps({"totalWorkflows": 1, "workflows": [{"id": 1, "name": "A", "views": 0,
                                                               "totalViews": 9}]}).encode()
        self.assertEqual(n8n.search("x", opener=FakeOpener(body))["results"][0]["views"], 9)

    def test_fetch_without_nodes_is_an_error(self):
        for body in (b'{"name": "x"}', b'{"workflow": {"name": "x"}}', b'{"workflow": {"nodes": "no"}}'):
            with self.assertRaises(migrate.MigrateError):
                n8n.fetch("1", opener=FakeOpener(body))

    def test_fetch_http_error_is_a_migrate_error(self):
        err = urllib.error.HTTPError("https://api.n8n.io/x", 404, "no", {}, None)
        with self.assertRaises(migrate.MigrateError) as cm:
            n8n.fetch("1", opener=RaisingOpener(err))
        self.assertIn("HTTP 404", str(cm.exception))

    def test_fetch_name_is_sanitised(self):
        body = self.template_body(name="Mail " + fake_email())
        _, source = n8n.fetch("5", opener=FakeOpener(body))
        self.assertEqual(source["name"], "Mail [removed]")

    def test_nothing_is_written_to_disk(self):
        import tempfile
        before = os.getcwd()
        with tempfile.TemporaryDirectory() as tmp:
            os.chdir(tmp)
            try:
                n8n.fetch("5", opener=FakeOpener(self.template_body()))
                n8n.search("x", opener=FakeOpener(self.search_body()))
                self.assertEqual(os.listdir(tmp), [])
            finally:
                os.chdir(before)


class Rewriting(unittest.TestCase):
    def test_references_reach_the_pack_prompt_as_explicit_inputs(self):
        plan = n8n.parse(load("schedule-app.json"))
        pk, _ = migrate.emit(plan)
        self.assertRegex(pk["prompt"], r"[`'\"]shop[`'\"] from step [`'\"]get-orders[`'\"]")

class ReviewRound(unittest.TestCase):
    """Fixes from the migrate review: control dependencies, ordering, write detection, approvals, errors."""

    def stage_ids(self, plan):
        pk, _ = migrate.emit(plan)
        self.assertEqual(pack.validate(pk), [])
        return [x["id"] if isinstance(x, dict) else x for x in pk["stages"]]

    def gate_flow(self):
        ref = "={{ $('Fetch').item.json.a }}"
        nodes = [node("Cron", N + "scheduleTrigger", sched({"field": "days"})),
                 node("Fetch", N + "gmail", {"operation": "getAll"}),
                 node("Approve", N + "wait", {"resume": "webhook"}),
                 node("Notify", N + "code", {"jsCode": "const d = $('Fetch').all(); return d;"}),
                 node("Sub", N + "executeWorkflow", {"workflowId": {"value": "7"}, "x": ref}),
                 node("Mystery", "n8n-nodes-community.fooBar", {"op": ref}),
                 node("Pub", N + "redis", {"operation": "publish", "v": ref}),
                 node("Ask", L + "agent", {"text": ref}),
                 node("ToolW", L + "toolWorkflow", {})]
        return wf(nodes, link("Cron", "Fetch"), link("Fetch", "Approve"), link("Approve", "Notify"),
                  link("Notify", "Sub"), link("Sub", "Mystery"), link("Mystery", "Pub"), link("Pub", "Ask"),
                  link("ToolW", "Ask", "ai_tool"))

    def test_steps_wired_after_a_gate_stay_after_it_despite_explicit_refs(self):
        plan = n8n.parse(self.gate_flow())
        gate = next(s["id"] for s in plan["steps"] if s["concept"] == "step.wait-approval")
        notify = next(s for s in plan["steps"] if s["id"] == "notify")
        self.assertIn(gate, notify["needs"])
        ids = self.stage_ids(plan)
        for sid in ("notify", "sub", "mystery", "pub", "ask"):
            self.assertGreater(ids.index(sid), ids.index(gate), sid)

    def test_an_agent_with_a_workflow_tool_is_a_write_and_gated(self):
        plan = n8n.parse(self.gate_flow())
        ask = next(s for s in plan["steps"] if s["id"] == "ask")
        self.assertEqual(ask["access"], "write")

    def test_agent_with_a_write_connector_tool_is_gated(self):
        flow = wf([node("T", N + "scheduleTrigger", sched({"field": "days"})),
                   node("Agent", L + "agent", {"text": "Go"}),
                   node("Mail", N + "gmailTool", {"operation": "send"})],
                  link("T", "Agent"), link("Mail", "Agent", "ai_tool"))
        plan = n8n.parse(flow)
        self.assertTrue(any(c["access"] == "write" for c in plan["connectors"]))

    def test_agent_with_an_unmapped_tool_fails_closed(self):
        for tool in ("n8n-nodes-community.mysteryTool", L + "toolCalculator"):
            flow = wf([node("T", N + "scheduleTrigger", sched({"field": "days"})),
                       node("Fetch", N + "gmail", {"operation": "getAll"}),
                       node("Agent", L + "agent", {"text": "Go"}),
                       node("Tool", tool, {})],
                      link("T", "Fetch"), link("Fetch", "Agent"), link("Tool", "Agent", "ai_tool"))
            plan = n8n.parse(flow)
            agent = next(s for s in plan["steps"] if s["id"] == "agent")
            self.assertEqual(agent["access"], "write", tool)
            found = issues_of(plan, "needs-person", "step.ai-tool", "agent")
            self.assertTrue(found and "waits for approval" in found[0]["message"], tool)
            pk, _ = migrate.emit(plan)
            self.assertEqual(pk["routine"]["routine"]["type"], "approval-gated", tool)
            ids = self.stage_ids(plan)
            self.assertLess(ids.index("fetch"), ids.index(migrate.APPROVE_ID), tool)
            self.assertGreater(ids.index("agent"), ids.index(migrate.APPROVE_ID), tool)

    def test_order_is_topological_when_a_reference_points_forward(self):
        nodes = [node("T", N + "scheduleTrigger", sched({"field": "days"})), node("A", N + "noOp"),
                 node("B", N + "gmail", {"operation": "send", "m": "={{ $('C').item.json.a }}"}),
                 node("C", N + "gmail", {"operation": "getAll"})]
        plan = n8n.parse(wf(nodes, link("T", "A"), link("A", "B"), link("A", "C")))
        ids = [s["id"] for s in plan["steps"]]
        for s in plan["steps"]:
            for need in s.get("needs", []):
                self.assertLess(ids.index(need), ids.index(s["id"]))
        self.assertEqual(ids, ["a", "c", "b"])

    def test_a_reference_cycle_never_leaves_a_later_need(self):
        nodes = [node("T", N + "scheduleTrigger", sched({"field": "days"})),
                 node("A", N + "gmail", {"operation": "getAll", "m": "={{ $('B').item.json.a }}"}),
                 node("B", N + "gmail", {"operation": "getAll", "m": "={{ $('A').item.json.a }}"})]
        plan = n8n.parse(wf(nodes, link("T", "A"), link("A", "B")))
        ids = [s["id"] for s in plan["steps"]]
        for s in plan["steps"]:
            for need in s.get("needs", []):
                self.assertLess(ids.index(need), ids.index(s["id"]))
        found = [i for i in plan["issues"] if "part of a loop" in i["message"]]
        self.assertEqual(len(found), 1, found)
        self.assertEqual(found[0]["level"], "needs-person")
        self.assertTrue(found[0]["message"].startswith("A is part of a loop in the source connections"))

    def test_no_loop_issue_without_a_cycle(self):
        plan = n8n.parse(self.gate_flow())
        self.assertEqual([i for i in plan["issues"] if "part of a loop" in i["message"]], [])

    def http_flow(self, params, tool=False):
        if tool:
            return wf([node("T", N + "scheduleTrigger", sched({"field": "days"})),
                       node("Agent", L + "agent", {"text": "Go"}),
                       node("Web", L + "toolHttpRequest", params)],
                      link("T", "Agent"), link("Web", "Agent", "ai_tool"))
        return wf([node("T", N + "scheduleTrigger", sched({"field": "days"})),
                   node("Call", N + "httpRequest", params)], link("T", "Call"))

    def test_get_with_a_mutating_segment_is_a_write(self):
        for url in ("https://x.example.invalid/api/send", "https://x.example.invalid/v1/Delete/3",
                    "https://x.example.invalid/a?action=publish", "https://x.example.invalid/sendMessage?id=1",
                    "https://x.example.invalid/a/create-user", "https://x.example.invalid/a/run_job"):
            plan = n8n.parse(self.http_flow({"method": "GET", "url": url}))
            self.assertEqual(plan["steps"][0]["access"], "write", url)

    def test_plain_get_stays_a_read_with_a_confirm_note(self):
        for url in ("https://x.example.invalid/api/items", "https://x.example.invalid/sender?x=1",
                    "https://x.example.invalid/posts/3", "https://x.example.invalid/runway"):
            plan = n8n.parse(self.http_flow({"method": "GET", "url": url}))
            self.assertEqual(plan["steps"][0]["access"], "read", url)
            self.assertIn("Confirm this request changes nothing.", [i["message"] for i in plan["issues"]])

    def test_a_write_get_has_no_confirm_note(self):
        plan = n8n.parse(self.http_flow({"method": "GET", "url": "https://x.example.invalid/notify"}))
        self.assertNotIn("Confirm this request changes nothing.", [i["message"] for i in plan["issues"]])

    def test_http_tool_without_a_method_is_a_write(self):
        plan = n8n.parse(self.http_flow({"url": "https://x.example.invalid/a"}, tool=True))
        self.assertEqual(plan["connectors"], [{"id": "http-write", "app": "http", "access": "write"}])
        plan = n8n.parse(self.http_flow({"method": "GET", "url": "https://x.example.invalid/a/send"}, tool=True))
        self.assertEqual(plan["connectors"][0]["access"], "write")

    def test_form_node_is_an_approval(self):
        flow = wf([node("T", N + "scheduleTrigger", sched({"field": "days"})), node("Ask", N + "form", {}),
                   node("Next", N + "noOp")], link("T", "Ask"), link("Ask", "Next"))
        plan = n8n.parse(flow)
        self.assertEqual(plan["steps"][0]["concept"], "step.wait-approval")

    def test_send_and_wait_is_one_approval_and_no_write_step(self):
        for app, op in (("gmail", "sendAndWait"), ("slack", "sendAndWait")):
            flow = wf([node("T", N + "scheduleTrigger", sched({"field": "days"})),
                       node("Ask", N + app, {"operation": op, "message": "Ok?"}),
                       node("Next", N + "noOp")], link("T", "Ask"), link("Ask", "Next"))
            plan = n8n.parse(flow)
            step = plan["steps"][0]
            self.assertEqual(step["concept"], "step.wait-approval", app)
            self.assertNotIn("connectors", step)
            self.assertNotIn("access", step)
            self.assertEqual(plan["connectors"], [])
            self.assertEqual([s for s in plan["steps"] if s["concept"] == "step.app"], [])
            self.assertFalse([i for i in plan["issues"] if i["level"] == "setup"], app)
            self.assertEqual(pack.validate(migrate.emit(plan)[0]), [])

    def error_flow(self):
        nodes = [node("T", N + "scheduleTrigger", sched({"field": "days"})),
                 node("Fetch", N + "httpRequest", {"method": "GET", "url": "https://x.example.invalid/a"},
                      onError="continueErrorOutput"),
                 node("Next", N + "noOp"), node("Alert", N + "slack", {"operation": "post"}),
                 node("After", N + "noOp")]
        return wf(nodes, link("T", "Fetch"), link("Fetch", "Next", index=0), link("Fetch", "Alert", index=1),
                  link("Alert", "After"))

    def test_error_branch_steps_are_marked_and_raise_needs_person(self):
        plan = n8n.parse(self.error_flow())
        by = {s["id"]: s for s in plan["steps"]}
        self.assertTrue(by["alert"]["does"].startswith("Only if an earlier step failed: "))
        self.assertTrue(by["after"]["does"].startswith("Only if an earlier step failed: "))
        self.assertFalse(by["next"]["does"].startswith("Only if"))
        hit = [i for i in plan["issues"] if i["level"] == "needs-person" and i.get("where") == "alert"]
        self.assertEqual(len(hit), 1)

    def test_a_node_also_on_the_normal_path_is_not_marked(self):
        flow = self.error_flow()
        flow["connections"]["Next"] = {"main": [[{"node": "After", "type": "main", "index": 0}]]}
        by = {s["id"]: s for s in n8n.parse(flow)["steps"]}
        self.assertTrue(by["alert"]["does"].startswith("Only if"))
        self.assertFalse(by["after"]["does"].startswith("Only if"))

    def test_a_missing_node_reference_is_reported_once(self):
        flow = wf([node("T", N + "scheduleTrigger", sched({"field": "days"})),
                   node("A", N + "gmail", {"operation": "send", "m": "={{ $('Gone').item.json.a }}"})],
                  link("T", "A"))
        plan = n8n.parse(flow)
        found = [i for i in plan["issues"] if i["level"] == "needs-person" and i.get("where") == "a"]
        self.assertEqual(len(found), 1, found)
        self.assertIn("refers to a node named", found[0]["message"])


class TypeSwapFuzz(unittest.TestCase):
    """Deterministic type swaps over a rich workflow: only MigrateError may escape, never another exception."""

    def test_swapped_values_raise_only_migrate_error(self):
        import random
        base = {"name": "F", "settings": {"timezone": "UTC"}, "staticData": {"a": 1},
                "nodes": [node("T", N + "scheduleTrigger", sched({"field": "cronExpression",
                                                                  "expression": "0 9 * * *"})),
                          node("Fetch", N + "httpRequest", {"method": "GET", "url": "https://x.example.invalid/a"},
                               onError="continueErrorOutput"),
                          node("If", N + "if", {"conditions": {"conditions": [
                              {"leftValue": "={{ $json.a }}", "rightValue": 1,
                               "operator": {"type": "number", "operation": "gt"}}], "combinator": "and"}}),
                          node("Agent", L + "agent", {"text": "={{ $('Fetch').item.json.a }}"}),
                          node("Tool", L + "toolHttpRequest", {"url": "https://x.example.invalid/send"}),
                          node("Mail", N + "gmail", {"operation": "sendAndWait", "message": "Ok?"}),
                          node("Wait", N + "wait", {"resume": "webhook"}),
                          node("Code", N + "code", {"jsCode": "return $input.all();"})],
                "connections": {"T": {"main": [[{"node": "Fetch", "type": "main", "index": 0}]]},
                                "Fetch": {"main": [[{"node": "If", "type": "main", "index": 0}],
                                                   [{"node": "Mail", "type": "main", "index": 0}]]},
                                "If": {"main": [[{"node": "Agent", "type": "main", "index": 0}],
                                                [{"node": "Wait", "type": "main", "index": 0}]]},
                                "Tool": {"ai_tool": [[{"node": "Agent", "type": "ai_tool", "index": 0}]]},
                                "Wait": {"main": [[{"node": "Code", "type": "main", "index": 0}]]}}}
        n8n.parse(copy.deepcopy(base))
        swaps = [None, 7, True, "x", [], {}, [1], {"a": 1}, 3.5]
        paths = []

        def walk(v, path):
            paths.append(path)
            if isinstance(v, dict):
                for k, x in v.items():
                    walk(x, path + [k])
            elif isinstance(v, list):
                for i, x in enumerate(v):
                    walk(x, path + [i])
        walk(base, [])
        rng = random.Random(1234)
        for _ in range(400):
            doc = copy.deepcopy(base)
            path = rng.choice(paths[1:])
            parent = doc
            for key in path[:-1]:
                parent = parent[key]
            parent[path[-1]] = copy.deepcopy(rng.choice(swaps))
            try:
                plan = n8n.parse(doc)
                migrate.emit(plan)
            except migrate.MigrateError:
                pass

    def test_wrong_typed_settings_name_the_node_position(self):
        cases = [
            (lambda d: d["nodes"][2]["parameters"]["conditions"]["conditions"][0].update(operator={"operation": {}}),
             "node 3"),
            (lambda d: d["nodes"][0]["parameters"]["rule"]["interval"][0].update(field={"a": 1}), "node 1"),
        ]
        for mutate, where in cases:
            doc = wf([node("T", N + "scheduleTrigger", sched({"field": "days"})), node("X", N + "noOp"),
                      node("If", N + "if", {"conditions": {"conditions": [
                          {"leftValue": "a", "rightValue": "b", "operator": {"type": "string",
                                                                                "operation": "equals"}}]}})],
                     link("T", "X"), link("X", "If"))
            mutate(doc)
            with self.assertRaises(migrate.MigrateError) as cm:
                n8n.parse(doc)
            self.assertIn(where, str(cm.exception))

    def test_a_dict_node_name_is_a_migrate_error(self):
        doc = wf([node("T", N + "scheduleTrigger", sched({"field": "days"})), node("X", N + "noOp")], link("T", "X"))
        doc["nodes"][1]["name"] = {"a": 1}
        with self.assertRaises(migrate.MigrateError) as cm:
            n8n.parse(doc)
        self.assertIn("node 2", str(cm.exception))


if __name__ == "__main__":
    unittest.main()
