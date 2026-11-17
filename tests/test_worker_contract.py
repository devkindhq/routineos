"""Worker write contract: the lane allow-list, outcomes, worker gates and write --worker."""
import copy
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "skills", "routineos", "scripts"))

import desk_contract as dc  # noqa: E402
from join_fixtures import CLOSED_CARD, TWO_LANE_CARD  # noqa: E402

CLI = os.path.join(HERE, "..", "skills", "routineos", "scripts", "routineos.py")
ADDR = "sales" + "@example.com"
OTHER = "ops" + "@example.com"
PARAMS = {"mailbox": ADDR}
LK = dc.lane_key("sender", PARAMS)
LKG = dc.lane_key("sender-gated", PARAMS)
JOINED = "2026-10-01T00:00:00Z"
START, END = "2026-10-31T09:00:00Z", "2026-10-31T09:05:00Z"


def set_op(path, data=None):
    coll, _, doc_id = path.rpartition("/")
    return {"op": "set", "collection": coll, "doc_id": doc_id, "data": data or {}}


def doc(data, version=1):
    return {"version": version, "data": data}


def entity(assignee, status="active"):
    return {"type": "draft", "key": "k", "status": status,
            "display": {"assignee": assignee, "subject": "Hello", "to": "a role", "body": "b"}}


def worker(lane, by="u-b", status="active", joined=JOINED):
    return {"lane": lane, "kind": "mail-draft" if lane == "sender" else "mail-send", "params": dict(PARAMS),
            "status": status, "joinedAt": joined, "by": by, "name": "Alex Rivera", "routineId": "trig_1",
            "schedule": "0 21 * * 1-5"}


def snapshot(verified=True, owner="u-owner"):
    docs = {
        "meta/join": doc(copy.deepcopy(TWO_LANE_CARD)),
        "entities/draft--d1": doc(entity("Sales" + "@Example.com")),
        "entities/draft--d2": doc(entity(OTHER)),
        "entities/draft--d3": doc(entity(ADDR, status="dropped")),
        f"workers/{LK}": doc(worker("sender")),
        f"workers/{LKG}": doc(worker("sender-gated")),
    }
    if owner:
        docs["meta/owner"] = doc({"by": owner, "at": "2026-09-01T00:00:00Z"})
    if verified:
        for lk in (LK, LKG):
            docs[dc.person_path("u-b", f"verified--{lk}")] = doc({"decision": "verified", "by": "u-b", "at": JOINED})
    return docs


def run_input(lk=LK, outcomes=(), gates=(), run_id="r1", by="u-b", upserts=()):
    return {"runId": run_id, "laneKey": lk, "by": by, "startedAt": START, "endedAt": END,
            "outcomes": list(outcomes), "gates": list(gates), "upserts": list(upserts),
            "health": {"outcome": "ok", "itemsHandled": len(outcomes), "alert": None, "overrides": []}}


def ops_of(phases, name=None):
    return [o for ph in phases if name is None or ph["name"] == name for o in ph["ops"]]


def paths(ops):
    return [f"{o['collection']}/{o['doc_id']}" for o in ops]


def apply(docs, phases):
    store = dc.FakeStore()
    store.docs = copy.deepcopy(docs)
    for ph in phases:
        if ph["ops"]:
            store.apply(ph["ops"])
    return store.snapshot()


GATE = {"transport": "email", "timeoutHours": 24, "correlation": "subject"}


class GuardTests(unittest.TestCase):
    def test_guard_refuses_producer_writes_to_workers_and_outcomes(self):
        for path in (f"workers/{LK}", f"outcomes/draft--d1--{LK}"):
            with self.subTest(path=path):
                with self.assertRaisesRegex(dc.ContractError, "only a lane's worker writes this path"):
                    dc.guard([set_op(path)])

    def test_worker_guard_allows_only_its_own_paths(self):
        lk = "sender--x"
        dc.guard([set_op("outcomes/draft--d1--sender--x"), set_op("workers/sender--x--health"),
                  set_op("workers/sender--x"), set_op("pending/r1--sender--x--g1")], worker=lk)
        for path in ("entities/draft--d1", "outcomes/draft--d1--other--x", "outcomes/draft--a--q--sender",
                     "outcomes/d1--sender--x", "outcomes/a--b--c--sender--x", "workers/other--x",
                     "workers/sender--x--other", "decisions/verified--sender--x", "people/u-b/decisions/verified--sender--x",
                     "pending/r1--g1",
                     "pending/r1--other--x--g1", "meta/owner", "state/budget", "settings/workspace"):
            with self.subTest(path=path):
                with self.assertRaises(dc.LanePathError):
                    dc.guard([set_op(path)], worker=lk)

    def test_worker_guard_allows_only_set(self):
        with self.assertRaises(dc.LanePathError):
            dc.guard([{"op": "delete", "collection": "workers", "doc_id": "sender--x"}], worker="sender--x")

    def test_worker_guard_allows_its_budget_and_learning_docs(self):
        dc.guard([set_op("workers/sender--x--budget"), set_op("workers/sender--x--learning")], worker="sender--x")

    def test_producer_and_seed_refuse_meta_owner(self):
        with self.assertRaisesRegex(dc.ContractError, "only the Desk page writes it"):
            dc.guard([set_op("meta/owner", {"by": "u-x"})])
        defn = {"version": "v1", "producers": [], "types": {}, "join": copy.deepcopy(TWO_LANE_CARD)}
        docs = {"meta/owner": doc({"by": "u-owner", "at": JOINED})}
        seeded = paths(ops_of(dc.plan_seed(defn, {"name": "d", "createdAt": JOINED}, docs)))
        self.assertNotIn("meta/owner", seeded)


class WorkerRunTests(unittest.TestCase):
    def plan(self, docs, inp, card=None):
        return dc.plan_worker_run(card or copy.deepcopy(TWO_LANE_CARD), docs, inp)

    def test_drafted_outcome_written_once_and_rerun_is_noop(self):
        docs = snapshot()
        inp = run_input(outcomes=[{"item": "draft--d1", "status": "drafted", "ref": "msg_1"}])
        phases = self.plan(docs, inp)
        out = ops_of(phases, "outcomes")
        self.assertEqual(paths(out), [f"outcomes/draft--d1--{LK}"])
        self.assertEqual(out[0]["data"], {"item": "draft--d1", "lane": LK, "status": "drafted", "reason": None,
                                          "at": END, "by": "u-b", "ref": "msg_1"})
        self.assertEqual(paths(ops_of(phases, "health")), [f"workers/{LK}--health"])
        self.assertEqual(ops_of(phases, "health")[0]["data"],
                         {"runAt": END, "outcome": "ok", "itemsHandled": 1, "alert": None, "overrides": []})
        for ph in phases:
            dc.guard(ph["ops"], worker=LK)
        after = apply(docs, phases)
        self.assertEqual(ops_of(self.plan(after, inp), "outcomes"), [])

    def test_drafted_may_move_to_sent_once_sent_is_final(self):
        docs = snapshot()
        gid = f"r0--{LKG}--g1"
        docs[f"outcomes/draft--d1--{LKG}"] = doc({"item": "draft--d1", "lane": LKG, "status": "drafted"})
        docs[f"pending/{gid}"] = doc({"status": "pending", "run": "r0", "lane": LKG, "item": "draft--d1"})
        docs[dc.person_path("u-b", gid)] = doc({"decision": "approve", "by": "u-b", "item": "draft--d1", "shown": {}})
        inp = run_input(LKG, outcomes=[{"item": "draft--d1", "status": "sent"}])
        out = ops_of(self.plan(docs, inp), "outcomes")
        self.assertEqual(out[0]["data"]["status"], "sent")
        self.assertEqual(out[0]["if_version"], 1)
        docs[f"outcomes/draft--d1--{LKG}"] = doc({"item": "draft--d1", "lane": LKG, "status": "sent"}, 2)
        for status in ("drafted", "failed", "skipped", "sent"):
            with self.subTest(status=status):
                inp = run_input(LKG, outcomes=[{"item": "draft--d1", "status": status}])
                self.assertEqual(ops_of(self.plan(docs, inp), "outcomes"), [])

    def test_failed_may_be_retried(self):
        docs = snapshot()
        docs[f"outcomes/draft--d1--{LK}"] = doc({"item": "draft--d1", "lane": LK, "status": "failed"})
        out = ops_of(self.plan(docs, run_input(outcomes=[{"item": "draft--d1", "status": "drafted"}])), "outcomes")
        self.assertEqual(out[0]["data"]["status"], "drafted")

    def test_outcome_for_unmatched_or_dropped_item_refused(self):
        for item in ("draft--d2", "draft--d3", "draft--missing"):
            with self.subTest(item=item):
                with self.assertRaises(dc.ContractError):
                    self.plan(snapshot(), run_input(outcomes=[{"item": item, "status": "skipped"}]))

    def test_outcome_status_and_ref_checked(self):
        for o in ({"item": "draft--d1", "status": "deleted"}, {"item": "draft--d1", "status": "skipped", "ref": "a b"}):
            with self.subTest(o=o):
                with self.assertRaises(dc.ContractError):
                    self.plan(snapshot(), run_input(outcomes=[o]))

    def test_outcome_reason_with_an_address_refused(self):
        for reason in ("sent to " + ADDR, "see https://example.com", "x" * 201):
            with self.subTest(reason=reason[:20]):
                with self.assertRaises(dc.ContractError):
                    self.plan(snapshot(), run_input(outcomes=[{"item": "draft--d1", "status": "skipped",
                                                                "reason": reason}]))
        out = ops_of(self.plan(snapshot(), run_input(outcomes=[{"item": "draft--d1", "status": "skipped",
                                                                 "reason": "already answered"}])), "outcomes")
        self.assertEqual(out[0]["data"]["reason"], "already answered")

    def test_report_only_refuses_drafted_sent_and_gates(self):
        docs = snapshot(verified=False)
        for inp in (run_input(outcomes=[{"item": "draft--d1", "status": "drafted"}]),
                    run_input(LKG, outcomes=[{"item": "draft--d1", "status": "sent"}]),
                    run_input(LKG, gates=[dict(GATE, id=f"r1--{LKG}--g1", item="draft--d1")])):
            with self.subTest(inp=inp["laneKey"]):
                with self.assertRaisesRegex(dc.ContractError, "report-only until people/u-b/decisions/verified--"):
                    self.plan(docs, inp)
        out = ops_of(self.plan(docs, run_input(outcomes=[{"item": "draft--d1", "status": "skipped"}])), "outcomes")
        self.assertEqual(out[0]["data"]["status"], "skipped")

    def test_mail_draft_lane_can_never_record_sent(self):
        docs = snapshot()
        docs[f"outcomes/draft--d1--{LK}"] = doc({"item": "draft--d1", "lane": LK, "status": "drafted"})
        with self.assertRaisesRegex(dc.ContractError, "gate"):
            self.plan(docs, run_input(outcomes=[{"item": "draft--d1", "status": "sent"}]))
        with self.assertRaises(dc.ContractError):
            self.plan(docs, run_input(gates=[dict(GATE, id=f"r1--{LK}--g1", item="draft--d1")]))

    def test_sent_needs_the_joiners_approval_not_the_owners(self):
        docs = snapshot()
        gid = f"r0--{LKG}--g1"
        docs[f"outcomes/draft--d1--{LKG}"] = doc({"item": "draft--d1", "lane": LKG, "status": "drafted"})
        docs[f"pending/{gid}"] = doc({"status": "pending", "run": "r0", "lane": LKG, "item": "draft--d1"})
        docs[dc.person_path("u-owner", gid)] = doc({"decision": "approve", "by": "u-owner", "item": "draft--d1", "shown": {}})
        inp = run_input(LKG, outcomes=[{"item": "draft--d1", "status": "sent"}])
        with self.assertRaisesRegex(dc.ContractError, "approved"):
            self.plan(docs, inp)
        self.assertIsNone(dc.accepted_decision(docs, gid, "u-b"))
        docs[dc.person_path("u-b", gid)] = doc({"decision": "approve", "by": "u-b", "item": "draft--d1", "shown": {}})
        out = ops_of(self.plan(docs, inp), "outcomes")
        self.assertEqual(out[0]["data"]["status"], "sent")

    def test_an_approval_counts_only_for_the_item_it_names(self):
        docs = snapshot()
        gid = f"r0--{LKG}--g1"
        docs["entities/draft--d4"] = doc(entity(ADDR))
        for item in ("draft--d1", "draft--d4"):
            docs[f"outcomes/{item}--{LKG}"] = doc({"item": item, "lane": LKG, "status": "drafted"})
        docs[f"pending/{gid}"] = doc({"status": "pending", "run": "r0", "lane": LKG, "item": "draft--d1"})
        docs[dc.person_path("u-b", gid)] = doc({"decision": "approve", "by": "u-b", "item": "draft--d1", "shown": {}})
        docs[f"pending/{gid}"] = doc({"status": "pending", "run": "r0", "lane": LKG, "item": "draft--d4"}, 2)
        with self.assertRaisesRegex(dc.ContractError, "approved"):
            self.plan(docs, run_input(LKG, outcomes=[{"item": "draft--d4", "status": "sent"}]))
        got = dc.worker_items(copy.deepcopy(TWO_LANE_CARD), docs, LKG, "u-b")
        self.assertEqual(got["approved"], [])
        docs[dc.person_path("u-b", gid)] = doc({"decision": "approve", "by": "u-b"})
        with self.assertRaisesRegex(dc.ContractError, "approved"):
            self.plan(docs, run_input(LKG, outcomes=[{"item": "draft--d4", "status": "sent"}]))

    def test_a_budget_only_input_plans_the_counter_and_a_started_health(self):
        inp = run_input(LKG)
        inp["budget"] = {"days": {"2026-10-31": {"runs": 1, "steps": 0}}}
        inp["health"] = {"outcome": "started", "itemsHandled": 0, "alert": None, "overrides": "none"}
        ops = ops_of(self.plan(snapshot(), inp))
        self.assertEqual(paths(ops), [f"workers/{LKG}--budget", f"workers/{LKG}--health"])

    def test_an_approval_counts_only_for_the_gate_content_it_saw(self):
        docs = snapshot()
        gid = f"r0--{LKG}--g1"
        shown = dict(GATE, correlation="gmail-draft-1")
        docs[f"outcomes/draft--d1--{LKG}"] = doc({"item": "draft--d1", "lane": LKG, "status": "drafted"})
        docs[f"pending/{gid}"] = doc(dict(shown, status="pending", run="r0", lane=LKG, item="draft--d1"))
        docs[dc.person_path("u-b", gid)] = doc({"decision": "approve", "by": "u-b", "item": "draft--d1",
                                                "shown": dict(shown)})
        sent = run_input(LKG, outcomes=[{"item": "draft--d1", "status": "sent"}])
        self.assertEqual(ops_of(self.plan(docs, sent), "outcomes")[0]["data"]["status"], "sent")
        got = dc.worker_items(copy.deepcopy(TWO_LANE_CARD), docs, LKG, "u-b")
        self.assertEqual(got["approved"], [{"gate": gid, "item": "draft--d1", "approved": shown}])
        for change in ({"correlation": "gmail-draft-2"}, {"transport": "slack"},
                       {"draft": {"subject": "s", "body": "b"}}, {"recipients": [{"role": "buyer"}]}):
            with self.subTest(change=change):
                edited = copy.deepcopy(docs)
                edited[f"pending/{gid}"] = doc(dict(shown, status="pending", run="r0", lane=LKG,
                                                    item="draft--d1", **change), 2)
                with self.assertRaisesRegex(dc.ContractError, "approved"):
                    self.plan(edited, sent)
                got = dc.worker_items(copy.deepcopy(TWO_LANE_CARD), edited, LKG, "u-b")
                self.assertEqual(got["approved"], [])
        docs[dc.person_path("u-b", gid)] = doc({"decision": "approve", "by": "u-b", "item": "draft--d1"})
        with self.assertRaisesRegex(dc.ContractError, "approved"):
            self.plan(docs, sent)

    def test_worker_gate_id_carries_lane_and_two_workers_same_minute_do_not_collide(self):
        other_lk = dc.lane_key("sender-gated", {"mailbox": OTHER})
        docs = snapshot()
        docs[f"workers/{other_lk}"] = doc(dict(worker("sender-gated", by="u-c"), params={"mailbox": OTHER}))
        docs[dc.person_path("u-c", f"verified--{other_lk}")] = doc({"decision": "verified", "by": "u-c"})
        docs["entities/draft--d2"] = doc(entity(OTHER))
        a = self.plan(docs, run_input(LKG, gates=[dict(GATE, id=f"r1--{LKG}--g1", item="draft--d1")]))
        b = self.plan(docs, run_input(other_lk, by="u-c",
                                      gates=[dict(GATE, id=f"r1--{other_lk}--g1", item="draft--d2")]))
        pa, pb = paths(ops_of(a, "gates")), paths(ops_of(b, "gates"))
        self.assertEqual(pa, [f"pending/r1--{LKG}--g1"])
        self.assertEqual(pb, [f"pending/r1--{other_lk}--g1"])
        self.assertNotEqual(pa, pb)
        g = ops_of(a, "gates")[0]["data"]
        self.assertEqual(g, dict(GATE, status="pending", run="r1", lane=LKG, item="draft--d1",
                                 createdAt=START, schema=1))
        m = dc.WORKER_GATE_ID_RE.match(f"r1--{LKG}--g1")
        self.assertEqual((m.group("run"), m.group("lane")), ("r1", LKG))
        for gid in (f"r1--g1", f"r2--{LKG}--g1", f"r1--{LK}--g1", f"r1--{LKG}--g0", f"r1-x--{LKG}"):
            with self.subTest(gid=gid):
                with self.assertRaises(dc.ContractError):
                    self.plan(docs, run_input(LKG, gates=[dict(GATE, id=gid, item="draft--d1")]))

    def test_worker_gate_keeps_producer_create_only_rules(self):
        docs = snapshot()
        gid = f"r1--{LKG}--g1"
        docs[dc.person_path("u-b", gid)] = doc({"decision": "approve", "by": "u-b", "item": "draft--d1", "shown": {}})
        self.assertEqual(ops_of(self.plan(docs, run_input(LKG, gates=[dict(GATE, id=gid, item="draft--d1")])),
                                "gates"), [])
        with self.assertRaises(dc.ContractError):
            self.plan(snapshot(), run_input(LKG, gates=[dict(GATE, id=gid, item="draft--d1",
                                                             recipients=[{"role": ADDR}])]))

    def test_run_id_must_not_contain_double_hyphen(self):
        with self.assertRaises(dc.ContractError):
            self.plan(snapshot(), run_input(run_id="r1--x"))

    def test_existing_producer_gate_ids_still_pass(self):
        for gid, ok in (("r1--g1", True), ("r1--g12", True), ("intro-note-1", False), ("r0--g1", False),
                        ("r1--1", False), ("r1--g0", False), ("r1-x--g1", False), ("R1--g1", False)):
            found = dc.GATE_ID_RE.match(gid)
            self.assertEqual(bool(found and found.group(1) == "r1"), ok, gid)

    def test_release_newer_than_join_stops_the_old_worker(self):
        docs = snapshot()
        docs[dc.person_path("u-owner", f"release--{LK}")] = doc({"decision": "release", "by": "u-owner", "at": "2026-10-02T00:00:00Z"})
        with self.assertRaises(dc.LaneStopped) as cm:
            self.plan(docs, run_input())
        self.assertEqual(cm.exception.reason, "released")

    def test_release_naming_the_holder_is_final_whatever_joinedAt_says(self):
        docs = snapshot()
        docs[dc.person_path("u-owner", f"release--{LK}")] = doc({"decision": "release", "by": "u-owner",
                                                                  "at": "2026-10-02T00:00:00Z", "holder": "u-b"})
        for joined in ("2026-10-03T00:00:00Z", "2099-01-01T00:00:00Z"):
            with self.subTest(joined=joined):
                docs[f"workers/{LK}"] = doc(worker("sender", joined=joined), 2)
                self.assertEqual(dc.lane_stop_reason(docs, LK, "u-b"), "released")
        docs[f"workers/{LK}"] = doc(worker("sender", by="u-c", joined="2026-10-03T00:00:00Z"), 3)
        self.assertIsNone(dc.lane_stop_reason(docs, LK, "u-c"))

    def test_missing_or_malformed_joinedAt_counts_as_released(self):
        docs = snapshot()
        for joined in (None, "", "soon", 5, "2026-10-01 00:00:00"):
            with self.subTest(joined=joined):
                w = worker("sender")
                if joined is None:
                    del w["joinedAt"]
                else:
                    w["joinedAt"] = joined
                docs[f"workers/{LK}"] = doc(w, 2)
                self.assertEqual(dc.lane_stop_reason(docs, LK, "u-b"), "released")

    def test_release_older_than_join_is_ignored(self):
        docs = snapshot()
        docs[dc.person_path("u-owner", f"release--{LK}")] = doc({"decision": "release", "by": "u-owner", "at": "2026-09-02T00:00:00Z"})
        self.assertIsNone(dc.lane_stop_reason(docs, LK, "u-b"))

    def test_release_by_non_owner_is_ignored(self):
        docs = snapshot()
        docs[dc.person_path("u-b", f"release--{LK}")] = doc({"decision": "release", "by": "u-b", "at": "2026-10-02T00:00:00Z"})
        self.assertIsNone(dc.lane_stop_reason(docs, LK, "u-b"))
        self.plan(docs, run_input())

    def test_desk_without_meta_owner_accepts_no_release(self):
        docs = snapshot(owner=None)
        docs[dc.person_path("u-owner", f"release--{LK}")] = doc({"decision": "release", "by": "u-owner", "at": "2026-10-02T00:00:00Z"})
        self.assertIsNone(dc.lane_stop_reason(docs, LK, "u-b"))

    def test_other_stop_reasons(self):
        docs = snapshot()
        self.assertEqual(dc.lane_stop_reason(docs, "sender--nobody-000000000000", "u-b"), "no worker document")
        self.assertEqual(dc.lane_stop_reason(docs, LK, "u-c"), "served by someone else")
        docs[f"workers/{LK}"] = doc(worker("sender", status="left"))
        self.assertEqual(dc.lane_stop_reason(docs, LK, "u-b"), "left")

    def test_closed_desk_does_not_stop_an_active_worker(self):
        out = self.plan(snapshot(), run_input(outcomes=[{"item": "draft--d1", "status": "drafted"}]),
                        card=copy.deepcopy(CLOSED_CARD))
        self.assertEqual(len(ops_of(out, "outcomes")), 1)

    def test_worker_whose_params_do_not_give_its_key_is_refused(self):
        docs = snapshot()
        docs[f"workers/{LK}"] = doc(dict(worker("sender"), params={"mailbox": OTHER}))
        with self.assertRaises(dc.ContractError):
            self.plan(docs, run_input())


class PersonPathTests(unittest.TestCase):
    """Who decided is read from the people/<id>/ path the Desk's db rules reserve for that person, never from
    a `by` field, which any writer can type."""

    def plan(self, docs, inp):
        return dc.plan_worker_run(copy.deepcopy(TWO_LANE_CARD), docs, inp)

    def test_db_rules_reserve_meta_for_the_owner_and_people_for_each_person(self):
        self.assertEqual(dc.DESK_DB_RULES, [
            {"path": "meta", "read": "view", "write": "owner"},
            {"path": "people", "read": "view", "write": "self"},
            {"path": "people/{self}", "read": "view", "write": "interact"},
        ])

    def test_comments_ride_the_people_self_rule_and_are_documented_with_what_is_unverified(self):
        import pathlib
        self.assertFalse([r for r in dc.DESK_DB_RULES if r["path"].endswith("comments")], "no comments rule: the platform refuses write view and a {self} rule must be last")
        self.assertFalse([r for r in dc.DESK_DB_RULES if r["write"] == "view"], "the platform refuses write view")
        refs = pathlib.Path(__file__).resolve().parents[1] / "skills/routineos/references"
        for name in ("dashboard.md", "write-contract.md", "join.md"):
            self.assertIn("people/<id>/comments" if name != "write-contract.md" else "people/<viewerId>/comments",
                          (refs / name).read_text(), name)
        for name in ("dashboard.md", "write-contract.md"):
            text = (refs / name).read_text()
            self.assertIn("unverified", text, name)
            self.assertIn("republish", text.lower(), name)
            self.assertNotIn("accepted risk", text, name)
            self.assertNotIn("overwrite another person's comment", text, name)

    def test_dashboard_reference_declares_the_same_rules(self):
        import json, pathlib, re
        text = (pathlib.Path(__file__).resolve().parents[1] / "skills/routineos/references/dashboard.md").read_text()
        self.assertIn("{db: {rules: DESK_DB_RULES}, user: {}, downloads: true, comments: {composer_only: true}}", text)
        block = re.search(r"```json\n(\[.*?\])\n```", text, re.S)
        self.assertEqual(json.loads(block.group(1)), dc.DESK_DB_RULES)

    def test_forged_by_on_shared_decisions_is_never_honoured(self):
        docs = snapshot(verified=False)
        gid = f"r0--{LKG}--g1"
        docs[f"decisions/verified--{LK}"] = doc({"decision": "verified", "by": "u-b"})
        with self.assertRaisesRegex(dc.ContractError, "report-only"):
            self.plan(docs, run_input(outcomes=[{"item": "draft--d1", "status": "drafted"}]))
        docs = snapshot()
        docs[f"outcomes/draft--d1--{LKG}"] = doc({"item": "draft--d1", "lane": LKG, "status": "drafted"})
        docs[f"pending/{gid}"] = doc({"status": "pending", "run": "r0", "lane": LKG, "item": "draft--d1"})
        docs[f"decisions/{gid}"] = doc({"decision": "approve", "by": "u-b"})
        with self.assertRaisesRegex(dc.ContractError, "approved"):
            self.plan(docs, run_input(LKG, outcomes=[{"item": "draft--d1", "status": "sent"}]))
        docs[f"decisions/release--{LK}"] = doc({"decision": "release", "by": "u-owner", "at": "2026-10-02T00:00:00Z"})
        self.assertIsNone(dc.lane_stop_reason(docs, LK, "u-b"))

    def test_a_person_path_whose_by_differs_or_whose_id_is_unsafe_counts_as_absent(self):
        docs = snapshot(verified=False)
        docs[dc.person_path("u-b", f"verified--{LK}")] = doc({"decision": "verified", "by": "u-owner"})
        self.assertIsNone(dc.person_decision(docs, "u-b", f"verified--{LK}"))
        for uid in (None, "", "a/b", "u b", "x" * 65):
            self.assertIsNone(dc.person_decision(docs, uid, f"verified--{LK}"))

    def test_producer_never_writes_a_persons_path(self):
        with self.assertRaises(dc.HumanPathError):
            dc.guard([set_op(dc.person_path("u-b", "verified--sender--x"))])


class WorkerItemsTests(unittest.TestCase):
    def items(self, docs, lk=LK, by="u-b"):
        return dc.worker_items(copy.deepcopy(TWO_LANE_CARD), docs, lk, by)

    def test_worker_items_lists_matching_items_without_outcomes(self):
        docs = snapshot()
        docs["entities/draft--d4"] = doc(entity(ADDR))
        docs[f"outcomes/draft--d4--{LK}"] = doc({"item": "draft--d4", "lane": LK, "status": "drafted"})
        got = self.items(docs)
        self.assertIsNone(got["stopped"])
        self.assertTrue(got["verified"])
        self.assertEqual(got["todo"], [{"item": "draft--d1", "values": docs["entities/draft--d1"]["data"]["display"]}])
        self.assertEqual((got["approved"], got["waiting"]), ([], []))
        self.assertFalse(self.items(snapshot(verified=False))["verified"])

    def test_worker_items_ignores_owner_approval(self):
        docs = snapshot()
        g1, g2 = f"r0--{LKG}--g1", f"r0--{LKG}--g2"
        docs["entities/draft--d4"] = doc(entity(ADDR))
        for gid, item in ((g1, "draft--d1"), (g2, "draft--d4")):
            docs[f"outcomes/{item}--{LKG}"] = doc({"item": item, "lane": LKG, "status": "drafted"})
            docs[f"pending/{gid}"] = doc({"status": "pending", "run": "r0", "lane": LKG, "item": item})
        docs[dc.person_path("u-owner", g1)] = doc({"decision": "approve", "by": "u-owner"})
        docs[dc.person_path("u-b", g2)] = doc({"decision": "approve", "by": "u-b", "item": "draft--d4", "shown": {}})
        got = self.items(docs, LKG)
        self.assertEqual(got["approved"], [{"gate": g2, "item": "draft--d4", "approved": {}}])
        self.assertEqual(got["waiting"], [g1])
        self.assertEqual(got["todo"], [])

    def test_worker_items_reports_stopped_when_left(self):
        docs = snapshot()
        docs[f"workers/{LK}"] = doc(worker("sender", status="left"))
        got = self.items(docs)
        self.assertEqual(got, {"stopped": "left", "verified": False, "todo": [], "approved": [], "waiting": []})

    def test_worker_items_retries_failed_only(self):
        docs = snapshot()
        docs["entities/draft--d4"] = doc(entity(ADDR))
        docs["entities/draft--d5"] = doc(entity(ADDR))
        docs[f"outcomes/draft--d1--{LK}"] = doc({"item": "draft--d1", "lane": LK, "status": "failed"})
        docs[f"outcomes/draft--d4--{LK}"] = doc({"item": "draft--d4", "lane": LK, "status": "skipped"})
        docs[f"outcomes/draft--d5--{LK}"] = doc({"item": "draft--d5", "lane": LK, "status": "drafted"})
        self.assertEqual([t["item"] for t in self.items(docs)["todo"]], ["draft--d1"])

    def test_cli_worker_items(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, True)
        dpath, out = os.path.join(tmp, "docs.json"), os.path.join(tmp, "items.json")
        with open(dpath, "w") as fh:
            json.dump(snapshot(), fh)
        res = subprocess.run([sys.executable, CLI, "worker-items", "--docs", dpath, "--worker", LK, "--by", "u-b",
                              "--out", out], capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, res.stderr)
        with open(out) as fh:
            self.assertEqual([t["item"] for t in json.load(fh)["todo"]], ["draft--d1"])
        res = subprocess.run([sys.executable, CLI, "worker-items", "--docs", dpath, "--worker", LK, "--by", "u-c",
                              "--out", out], capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertIn("stopped: served by someone else", res.stdout)


class BudgetInputsTests(unittest.TestCase):
    T = "2026-10-31"

    def run_inputs(self, docs, *mode):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, True)
        dpath, out = os.path.join(tmp, "docs.json"), os.path.join(tmp, "out")
        with open(dpath, "w") as fh:
            json.dump(docs, fh)
        res = subprocess.run([sys.executable, CLI, "budget-inputs", "--docs", dpath, *mode, "--out", out],
                             capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, res.stderr)
        return res.stdout, out, sorted(os.listdir(out))

    def counters(self, card_cap=None):
        docs = snapshot()
        if card_cap is not None:
            docs["meta/join"]["data"]["cap"] = card_cap
        docs["state/budget"] = doc({"days": {self.T: {"runs": 5}}})
        docs[f"workers/{LK}--budget"] = doc({"days": {self.T: {"runs": 0}}})
        docs[f"workers/{LKG}--budget"] = doc({"days": {self.T: {"runs": 2}}})
        return docs

    def test_default_cap_is_account_one(self):
        stdout, out, files = self.run_inputs(self.counters(), "--worker", LK)
        self.assertEqual(files, ["max-runs", "own.json"])
        with open(os.path.join(out, "max-runs")) as fh:
            self.assertEqual(fh.read().strip(), "1")
        self.assertIn("budget.py decide --max-runs 1 --state", stdout)
        self.assertNotIn("--also", stdout)

    def test_account_scope_counts_only_the_writers_own_counter(self):
        stdout, out, files = self.run_inputs(self.counters({"scope": "account", "maxRunsPerDay": 1}),
                                             "--worker", LK)
        with open(os.path.join(out, "own.json")) as fh:
            own = json.load(fh)
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "budget", os.path.join(HERE, "..", "skills", "routineos", "assets", "lib", "budget.py"))
        budget = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(budget)
        self.assertTrue(budget.decide(own, self.T, 1)["allow"])

    def test_budget_inputs_desk_scope_excludes_own_counter(self):
        docs = self.counters({"scope": "desk", "maxRunsPerDay": 3})
        stdout, out, files = self.run_inputs(docs, "--worker", LK)
        self.assertEqual(files, ["also-1.json", "also-2.json", "max-runs", "own.json"])
        seen = []
        for f in ("also-1.json", "also-2.json"):
            with open(os.path.join(out, f)) as fh:
                seen.append(json.load(fh)["days"][self.T]["runs"])
        self.assertEqual(sorted(seen), [2, 5])
        self.assertIn("--also", stdout)
        # The owner never counts joiner-written counters, so no joiner can block the owner's runs.
        stdout, out, files = self.run_inputs(docs, "--owner")
        self.assertEqual(files, ["max-runs", "own.json"])
        self.assertNotIn("--also", stdout)
        with open(os.path.join(out, "own.json")) as fh:
            self.assertEqual(json.load(fh)["days"][self.T]["runs"], 5)

    def test_desk_scope_skips_counters_of_stopped_off_card_or_invalid_workers(self):
        def also_runs(docs):
            stdout, out, files = self.run_inputs(docs, "--worker", LK)
            got = []
            for f in files:
                if f.startswith("also-"):
                    with open(os.path.join(out, f)) as fh:
                        got.append(json.load(fh)["days"][self.T]["runs"])
            return sorted(got)

        base = self.counters({"scope": "desk", "maxRunsPerDay": 3})
        self.assertEqual(also_runs(base), [2, 5])
        left = copy.deepcopy(base)
        left[f"workers/{LKG}"] = doc(worker("sender-gated", status="left"))
        self.assertEqual(also_runs(left), [5])
        released = copy.deepcopy(base)
        released[dc.person_path("u-owner", f"release--{LKG}")] = doc({"decision": "release", "by": "u-owner",
                                                                       "at": END, "holder": "u-b"})
        self.assertEqual(also_runs(released), [5])
        ghost = copy.deepcopy(base)
        ghost_lk = "ghost--x-0123456789ab"
        ghost[f"workers/{ghost_lk}"] = doc(dict(worker("sender"), lane="ghost"))
        ghost[f"workers/{ghost_lk}--budget"] = doc({"days": {self.T: {"runs": 9}}})
        self.assertEqual(also_runs(ghost), [2, 5])
        orphan = copy.deepcopy(base)
        orphan["workers/sender--nobody-000000000000--budget"] = doc({"days": {self.T: {"runs": 9}}})
        self.assertEqual(also_runs(orphan), [2, 5])
        bad = copy.deepcopy(base)
        bad[f"workers/{LKG}--budget"] = doc({"days": {self.T: {"runs": -100}}})
        self.assertEqual(also_runs(bad), [5])

    def test_absent_own_counter_writes_no_own_file(self):
        docs = self.counters({"scope": "desk", "maxRunsPerDay": 3})
        del docs[f"workers/{LK}--budget"]
        stdout, out, files = self.run_inputs(docs, "--worker", LK)
        self.assertNotIn("own.json", files)
        self.assertNotIn("--state", stdout)

    def test_worker_budget_write_passes_the_guard_and_owner_budget_is_refused(self):
        inp = run_input()
        inp["budget"] = {"days": {self.T: {"runs": 1, "steps": 2, "tokens": None}}}
        phases = dc.plan_worker_run(copy.deepcopy(TWO_LANE_CARD), snapshot(), inp)
        budget_ops = [o for o in ops_of(phases) if o["doc_id"] == f"{LK}--budget"]
        self.assertEqual(budget_ops[0]["data"], inp["budget"])
        for ph in phases:
            dc.guard(ph["ops"], worker=LK)
        with self.assertRaises(dc.LanePathError):
            dc.guard([set_op("state/budget", inp["budget"])], worker=LK)
        bad = dict(inp, budget={"days": {self.T: {"runs": "lots"}}})
        with self.assertRaises(dc.ContractError):
            dc.plan_worker_run(copy.deepcopy(TWO_LANE_CARD), snapshot(), bad)


class WriteWorkerCliTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def run_cli(self, docs, inp, lk=LK):
        dpath, rpath = os.path.join(self.tmp, "docs.json"), os.path.join(self.tmp, "run.json")
        out = os.path.join(self.tmp, "out")
        with open(dpath, "w") as fh:
            json.dump(docs, fh)
        with open(rpath, "w") as fh:
            json.dump(inp, fh)
        res = subprocess.run([sys.executable, CLI, "write", "--worker", lk, "--docs", dpath, "--run", rpath,
                              "--out", out], capture_output=True, text=True)
        return res, out

    def test_cli_write_worker_stopped_writes_nothing_and_exits_0(self):
        docs = snapshot()
        docs[f"workers/{LK}"] = doc(worker("sender", status="left"))
        res, out = self.run_cli(docs, run_input(outcomes=[{"item": "draft--d1", "status": "drafted"}]))
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertIn("stopped: left; nothing written", res.stdout)
        self.assertFalse(os.path.exists(out))

    def test_cli_write_worker_emits_batches_that_pass_the_guard(self):
        res, out = self.run_cli(snapshot(), run_input(outcomes=[{"item": "draft--d1", "status": "drafted"}]))
        self.assertEqual(res.returncode, 0, res.stderr)
        files = sorted(f for f in os.listdir(out) if f.startswith("batch-") and f.count(".") == 1)
        self.assertTrue(files)
        for f in files:
            with open(os.path.join(out, f)) as fh:
                dc.guard(json.load(fh)["writes"], worker=LK)

    def test_cli_lane_key_must_match_the_flag(self):
        res, out = self.run_cli(snapshot(), run_input(LKG), lk=LK)
        self.assertNotEqual(res.returncode, 0)
        self.assertFalse(os.path.exists(out))



class WorkerSharedTests(unittest.TestCase):
    """Issue #32: a lane whose join card names shared types may write those entities."""

    def shared_card(self):
        card = copy.deepcopy(TWO_LANE_CARD)
        card["lanes"][0]["shared"] = ["draft"]
        return card

    def shared_snapshot(self):
        docs = snapshot()
        docs["meta/join"] = doc(copy.deepcopy(self.shared_card()))
        docs["meta/definition"] = doc({"version": 1, "producers": [], "types": {
            "draft": {"label": "Draft", "identity": "field:subject", "shared": True,
                      "fields": {"subject": {"type": "text"}, "assignee": {"type": "text"}}}}})
        return docs

    def test_guard_allows_a_lanes_shared_entities_and_refuses_the_rest(self):
        shared = frozenset({"draft"})
        lk = "sender--x"
        dc.guard([set_op("entities/draft--d1")], worker=lk, shared=shared)
        for path in ("entities/topic--d1", "entities/draft", "entities/draft--d1--extra"):
            with self.subTest(path=path):
                with self.assertRaises(dc.LanePathError):
                    dc.guard([set_op(path)], worker=lk, shared=shared)

    def test_worker_shared_types_reads_the_lane_and_the_definition(self):
        docs = self.shared_snapshot()
        lk = dc.lane_key("sender", PARAMS)
        defn = docs["meta/definition"]["data"]
        self.assertEqual(dc.worker_shared_types(copy.deepcopy(self.shared_card()), docs, defn, lk), frozenset({"draft"}))
        # a definition that does not mark the type shared, or a lane that names none, allows nothing
        plain = copy.deepcopy(defn)
        del plain["types"]["draft"]["shared"]
        self.assertEqual(dc.worker_shared_types(copy.deepcopy(self.shared_card()), docs, plain, lk), frozenset())
        self.assertEqual(dc.worker_shared_types(copy.deepcopy(TWO_LANE_CARD), docs, defn, lk), frozenset())

    def test_plan_worker_run_upserts_shared_entities_with_stamps(self):
        docs = self.shared_snapshot()
        inp = run_input(upserts=[{"id": "draft--d1", "fields": {"status_note": "sent fine", "score": 2}}])
        phases = dc.plan_worker_run(copy.deepcopy(self.shared_card()), docs, inp)
        ops = ops_of(phases, "upserts")
        self.assertEqual(paths(ops), ["entities/draft--d1"])
        data = ops[0]["data"]
        self.assertEqual(data["fields"], {"status_note": "sent fine", "score": 2})
        self.assertEqual(data["display"]["status_note"], "sent fine")
        self.assertEqual(data["updatedBy"], f"worker:{LK}")
        self.assertEqual(data["updatedAt"], END)
        self.assertNotIn("bySource", data)  # a fresh doc; producer machinery is never invented here
        shared = dc.worker_shared_types(self.shared_card(), docs, docs["meta/definition"]["data"], LK)
        for ph in phases:
            dc.guard(ph["ops"], worker=LK, shared=shared)
        after = apply(docs, phases)
        self.assertEqual(after["entities/draft--d1"]["data"]["updatedBy"], f"worker:{LK}")
        # rerun with the same input plans no further entity write (stamps equal, values equal)
        self.assertEqual(ops_of(dc.plan_worker_run(copy.deepcopy(self.shared_card()), after, inp), "upserts"), [])

    def test_plan_worker_run_merges_into_an_existing_doc_without_touching_machinery(self):
        docs = self.shared_snapshot()
        docs["entities/draft--d1"] = doc({"type": "draft", "key": "d1", "status": "active",
                                          "bySource": {"p": {"subject": "Hello"}},
                                          "sightings": [{"run": "r0"}],
                                          "display": {"subject": "Hello"}, "fields": {"subject": "Hello"}})
        inp = run_input(upserts=[{"id": "draft--d1", "fields": {"score": 5}}])
        ops = ops_of(dc.plan_worker_run(copy.deepcopy(self.shared_card()), docs, inp), "upserts")
        data = ops[0]["data"]
        self.assertEqual(data["bySource"], {"p": {"subject": "Hello"}})
        self.assertEqual(data["sightings"], [{"run": "r0"}])
        self.assertEqual(data["fields"], {"subject": "Hello", "score": 5})
        self.assertEqual(data["display"], {"subject": "Hello", "score": 5})

    def test_plan_worker_run_refuses_upserts_outside_the_lanes_shared_types(self):
        docs = self.shared_snapshot()
        for bad in ({"id": "topic--t1", "fields": {"a": 1}},          # type not shared
                    {"id": "draft", "fields": {"a": 1}},              # not an entity id
                    {"id": "draft--d1", "fields": {"a": {"nested": 1}}},  # nested value
                    {"id": "draft--d1", "fields": "nope"}):           # not an object
            with self.subTest(bad=bad):
                with self.assertRaises(dc.ContractError):
                    dc.plan_worker_run(copy.deepcopy(self.shared_card()), docs, run_input(upserts=[bad]))
        # a lane that names no shared types refuses every upsert
        with self.assertRaises(dc.ContractError):
            dc.plan_worker_run(copy.deepcopy(TWO_LANE_CARD), docs, run_input(upserts=[{"id": "draft--d1", "fields": {"a": 1}}]))

    def test_plan_worker_run_refuses_upsert_ids_outside_the_desk_charset(self):
        """Review item 3: the Python path enforces the same id rule as the Desk's upsert verb."""
        docs = self.shared_snapshot()
        for eid in ("draft--a/b", "draft--..", "draft--two words", "draft--x" * 25, "draft--é",
                    "draft--d1\n", "draft--" + "a" * 121):
            with self.subTest(eid=eid):
                with self.assertRaises(dc.ContractError) as cm:
                    dc.plan_worker_run(copy.deepcopy(self.shared_card()), docs,
                                       run_input(upserts=[{"id": eid, "fields": {"a": 1}}]))
                self.assertIn(repr(eid)[1:-1], str(cm.exception))

    def test_plan_worker_run_pins_the_upsert_id_length_limit_at_120(self):
        """A valid-charset slug (single --) is accepted at 120 characters and refused at 121."""
        docs = self.shared_snapshot()
        dc.plan_worker_run(copy.deepcopy(self.shared_card()), docs,
                           run_input(upserts=[{"id": "draft--" + "a" * 120, "fields": {"a": 1}}]))
        with self.assertRaises(dc.ContractError):
            dc.plan_worker_run(copy.deepcopy(self.shared_card()), docs,
                               run_input(upserts=[{"id": "draft--" + "a" * 121, "fields": {"a": 1}}]))

    def test_plan_worker_run_refuses_upsert_field_names_outside_the_desk_charset(self):
        """Review item 3: field names follow the Desk verb's [A-Za-z0-9_-]{1,64}, not the looser
        1-64-chars-without-controls rule this path first shipped with."""
        docs = self.shared_snapshot()
        for name in ("status note", "a/b", "..", "x" * 65, "café", "score\n"):
            with self.subTest(name=name):
                with self.assertRaises(dc.ContractError) as cm:
                    dc.plan_worker_run(copy.deepcopy(self.shared_card()), docs,
                                       run_input(upserts=[{"id": "draft--d1", "fields": {name: 1}}]))
                self.assertIn("draft--d1", str(cm.exception))

    def test_guard_refuses_a_shared_entity_doc_whose_id_escapes_the_charset(self):
        shared = frozenset({"draft"})
        lk = "sender--x"
        dc.guard([set_op("entities/draft--d1")], worker=lk, shared=shared)
        for path in ("entities/draft--a/b", "entities/draft--..", "entities/draft--two words",
                     "entities/draft--d1\n"):
            with self.subTest(path=path):
                with self.assertRaises(dc.LanePathError):
                    dc.guard([set_op(path)], worker=lk, shared=shared)

    def test_worker_upsert_stamp_flips_when_a_person_writes_the_same_doc(self):
        """Review item 4: updatedBy tells the last writer; a person write after a worker upsert
        flips the stamp on the doc."""
        docs = self.shared_snapshot()
        docs["entities/draft--d1"] = doc({"type": "draft", "key": "d1", "fields": {}, "display": {},
                                          "updatedBy": f"worker:{LK}", "updatedAt": START})
        phases = dc.plan_worker_run(copy.deepcopy(self.shared_card()), copy.deepcopy(docs),
                                    run_input(upserts=[{"id": "draft--d1", "fields": {"score": 5}}]))
        after = apply(docs, phases)
        self.assertEqual(after["entities/draft--d1"]["data"]["updatedBy"], f"worker:{LK}")
        # a person writes the same doc after the worker (page upsert: last writer wins, no pin)
        doc_after = copy.deepcopy(after["entities/draft--d1"])
        docs2 = dict(after)
        docs2["entities/draft--d1"] = {"version": doc_after["version"] + 1,
                                       "data": dict(doc_after["data"], fields={"score": 6},
                                                    display={"score": 6}, updatedBy="u-9",
                                                    updatedAt="2026-10-31T10:00:00Z")}
        self.assertEqual(docs2["entities/draft--d1"]["data"]["updatedBy"], "u-9")  # the person's stamp stands
        # the worker's next run restamps even when its values are already stored (updatedAt differs),
        # and a new value takes the stamp anyway: updatedBy is simply the last writer
        phases2 = dc.plan_worker_run(copy.deepcopy(self.shared_card()), docs2,
                                     run_input(upserts=[{"id": "draft--d1", "fields": {"score": 6}}]))
        data2 = ops_of(phases2, "upserts")[0]["data"]
        self.assertEqual(data2["fields"]["score"], 6)
        self.assertEqual(data2["updatedBy"], f"worker:{LK}")
        after2 = apply(docs2, phases2)
        self.assertEqual(after2["entities/draft--d1"]["data"]["updatedBy"], f"worker:{LK}")

    def test_worker_upsert_interleaved_write_fails_the_version_pin_not_silently(self):
        """Review item 2 (worker path): the upsert op on an existing doc is version-pinned like
        every worker write, so a doc changed between the plan and the apply fails the pin
        instead of the person's write being lost. (A first create carries no pin, exactly as
        for every ArtifactData create; the Desk-side race is warned about on the page path.)"""
        docs = self.shared_snapshot()
        docs["entities/draft--d1"] = doc({"type": "draft", "key": "d1", "fields": {"note": "seen"},
                                          "display": {"note": "seen"}, "updatedBy": "u-1",
                                          "updatedAt": START})
        phases = dc.plan_worker_run(copy.deepcopy(self.shared_card()), copy.deepcopy(docs),
                                    run_input(upserts=[{"id": "draft--d1", "fields": {"score": 5}}]))
        up_ops = ops_of(phases, "upserts")
        self.assertEqual(up_ops[0]["if_version"], docs["entities/draft--d1"]["version"])
        # another writer lands a new version of the doc between the read and the apply
        interleaved = copy.deepcopy(docs)
        interleaved["entities/draft--d1"] = {"version": docs["entities/draft--d1"]["version"] + 1,
                                             "data": dict(docs["entities/draft--d1"]["data"],
                                                          fields={"note": "mine"}, updatedBy="u-2",
                                                          updatedAt="2026-10-31T09:02:00Z")}
        store = dc.FakeStore()
        for p, d in interleaved.items():
            store.docs[p] = copy.deepcopy(d)
        with self.assertRaises(dc.VersionMismatch):
            for ph in phases:
                store.apply(ph["ops"])
        self.assertNotIn("score", store.docs["entities/draft--d1"]["data"]["fields"])
        self.assertEqual(store.docs["entities/draft--d1"]["data"]["updatedBy"], "u-2")


if __name__ == "__main__":
    unittest.main()
