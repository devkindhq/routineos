"""Lane lifecycle: who holds a lane, joining it and leaving it."""
import copy
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "skills", "routineos", "scripts"))

import desk_contract as dc  # noqa: E402
import join_flow  # noqa: E402
from join_fixtures import TWO_LANE_CARD  # noqa: E402

PARAMS = {"mailbox": "sales" + "@example.com"}
LANE = TWO_LANE_CARD["lanes"][0]
LANE_G = TWO_LANE_CARD["lanes"][1]
LK = dc.lane_key("sender", PARAMS)
LKG = dc.lane_key("sender-gated", PARAMS)
JOINED = "2026-10-01T00:00:00Z"
AT = "2026-10-31T00:00:00Z"
CRON = "0 21 * * 1-5"


def doc(data, version=1):
    return {"version": version, "data": data}


def worker(lane="sender", by="u-b", status="active", joined=JOINED, rid="trig_1"):
    return {"lane": lane, "kind": "mail-draft", "params": dict(PARAMS), "status": status, "joinedAt": joined,
            "by": by, "name": "Alex Rivera", "routineId": rid, "schedule": CRON}


def owner(docs, by="u-owner"):
    docs["meta/owner"] = doc({"by": by, "at": "2026-09-01T00:00:00Z"})
    return docs


def release(docs, at, by="u-owner", lk=LK):
    docs[dc.person_path(by, f"release--{lk}")] = doc({"decision": "release", "at": at, "by": by})
    return docs


class LaneStateTests(unittest.TestCase):
    def test_release_naming_the_holder_frees_the_lane_whatever_joinedAt_says(self):
        docs = owner({f"workers/{LK}": doc(worker(joined="2099-01-01T00:00:00Z"))})
        docs[dc.person_path("u-owner", f"release--{LK}")] = doc({"decision": "release", "at": "2026-10-02T00:00:00Z",
                                                                  "by": "u-owner", "holder": "u-b"})
        self.assertTrue(join_flow.lane_state(docs, LK)["free"])
        docs[f"workers/{LK}"] = doc(worker(by="u-c"), 2)
        self.assertFalse(join_flow.lane_state(docs, LK)["free"])

    def test_absent_lane_is_free(self):
        self.assertEqual(join_flow.lane_state(owner({}), LK),
                         {"free": True, "holder": None, "since": None, "version": None})
        ops = join_flow.plan_join_write({}, LANE, LK, PARAMS, "u-c", "trig_2", CRON, AT, name="Alex Rivera")
        self.assertEqual(len(ops), 1)
        op = ops[0]
        self.assertEqual((op["op"], op["collection"], op["doc_id"]), ("set", "workers", LK))
        self.assertIsNone(op.get("if_version"))
        self.assertEqual(op["data"], {"lane": "sender", "kind": "mail-draft", "params": PARAMS,
                                      "status": "active", "joinedAt": AT, "by": "u-c", "name": "Alex Rivera",
                                      "routineId": "trig_2", "schedule": CRON})

    def test_taken_lane_raises_with_holder_and_since(self):
        docs_taken = owner({f"workers/{LK}": doc(worker())})
        self.assertEqual(join_flow.lane_state(docs_taken, LK),
                         {"free": False, "holder": "u-b", "since": JOINED, "version": 1})
        with self.assertRaises(join_flow.LaneTaken) as cm:
            join_flow.plan_join_write(docs_taken, LANE, LK, PARAMS, "u-c", "trig_2", CRON, AT)
        self.assertEqual((cm.exception.by, cm.exception.since), ("u-b", "2026-10-01T00:00:00Z"))

    def test_left_lane_is_free_and_replace_pins_version(self):
        docs = owner({f"workers/{LK}": doc(worker(status="left"), version=4)})
        self.assertTrue(join_flow.lane_state(docs, LK)["free"])
        ops = join_flow.plan_join_write(docs, LANE, LK, PARAMS, "u-c", "trig_2", CRON, AT)
        self.assertEqual(ops[0]["if_version"], 4)
        self.assertEqual(ops[0]["data"]["by"], "u-c")
        self.assertNotIn("name", ops[0]["data"])

    def test_release_newer_than_join_frees_the_lane(self):
        docs = release(owner({f"workers/{LK}": doc(worker(), version=2)}), "2026-10-15T00:00:00Z")
        state = join_flow.lane_state(docs, LK)
        self.assertEqual((state["free"], state["version"]), (True, 2))
        self.assertEqual(join_flow.plan_join_write(docs, LANE, LK, PARAMS, "u-c", "t", CRON, AT)[0]["if_version"], 2)

    def test_release_older_than_the_current_join_does_not_free_it(self):
        docs = release(owner({f"workers/{LK}": doc(worker(joined="2026-10-20T00:00:00Z"))}), "2026-10-15T00:00:00Z")
        self.assertFalse(join_flow.lane_state(docs, LK)["free"])

    def test_release_by_non_owner_does_not_free_the_lane(self):
        docs = release(owner({f"workers/{LK}": doc(worker())}), "2026-10-15T00:00:00Z", by="u-b")
        self.assertFalse(join_flow.lane_state(docs, LK)["free"])
        no_owner = release({f"workers/{LK}": doc(worker())}, "2026-10-15T00:00:00Z")
        self.assertFalse(join_flow.lane_state(no_owner, LK)["free"])

    def test_join_refuses_a_lane_key_that_does_not_match_lane_and_params(self):
        with self.assertRaises(ValueError):
            join_flow.plan_join_write({}, LANE, LKG, PARAMS, "u-c", "t", CRON, AT)

    def test_name_that_looks_like_an_email_is_refused(self):
        with self.assertRaises(ValueError):
            join_flow.plan_join_write({}, LANE, LK, PARAMS, "u-c", "t", CRON, AT, name="a" + "@example.com")


class LaneLinesTests(unittest.TestCase):
    def test_card_strings_are_json_quoted_inside_one_data_block(self):
        card = copy.deepcopy(TWO_LANE_CARD)
        card["lanes"][0]["params"]["tone"] = {"type": "enum", "ask": "Tone?", "choices": ["warm", "plain"]}
        card["lanes"][0]["label"] = "Sender for {mailbox} \\ end"
        lines = join_flow.lane_lines(card)
        self.assertEqual(lines[0], join_flow.DATA_BEGIN)
        self.assertEqual(lines[-1], join_flow.DATA_END)
        self.assertIn('1. "Sender for <mailbox> \\\\ end" (Mail drafts)', lines[2])
        self.assertIn('Choices: tone one of ["warm", "plain"]', lines[2])


class LeaveTests(unittest.TestCase):
    def test_leave_touches_only_the_joiners_lanes(self):
        other_params = {"mailbox": "ops" + "@example.com"}
        lk_other = dc.lane_key("sender", other_params)
        docs = owner({
            f"workers/{LK}": doc(worker(rid="trig_1"), version=3),
            f"workers/{LK}--health": doc({"by": "u-b", "status": "active"}),
            f"workers/{LKG}": doc(worker("sender-gated", status="left", rid="trig_9")),
            f"workers/{lk_other}": doc(dict(worker(by="u-c", rid="trig_5"), params=other_params)),
        })
        ops, rids = join_flow.plan_leave_write(docs, "u-b", AT)
        self.assertEqual(rids, ["trig_1"])
        self.assertEqual([(o["collection"], o["doc_id"]) for o in ops], [("workers", LK)])
        self.assertEqual(ops[0]["if_version"], 3)
        self.assertEqual(ops[0]["data"], dict(worker(rid="trig_1"), status="left", leftAt=AT))
        self.assertEqual(join_flow.plan_leave_write(docs, "u-z", AT), ([], []))

    def test_join_and_leave_ops_pass_the_worker_guard(self):
        ops = join_flow.plan_join_write({}, LANE, LK, PARAMS, "u-c", "t", CRON, AT)
        dc.guard(ops, worker=LK)
        docs = owner({f"workers/{LK}": doc(worker())})
        leave_ops, _ = join_flow.plan_leave_write(docs, "u-b", AT)
        dc.guard(leave_ops, worker=LK)
        with self.assertRaises(dc.ContractError):
            dc.guard(ops)


if __name__ == "__main__":
    unittest.main()
