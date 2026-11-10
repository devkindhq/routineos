"""The walk fixture (tests/desk_fixtures/v2-walk.json) carries what the Verify walk needs and the plain v2 fixture
must not: a pending request, a note kind from an older run, notes outside the image, and run docs with and without
the optional Captured, Failed, New reds and Cost fields. The plain v2 fixture stays as the text goldens captured it."""
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, "desk_fixtures")
sys.path.insert(0, FIX)

import make_v2_demo  # noqa: E402


def load(name):
    with open(os.path.join(FIX, name), encoding="utf-8") as fh:
        return json.load(fh)


class WalkFixtureTests(unittest.TestCase):
    def setUp(self):
        self.walk = load("v2-walk.json")
        self.v2 = load("v2-demo.json")

    def test_committed_files_are_current(self):
        self.assertEqual(make_v2_demo.main(["--check"]), 0)

    def test_one_pending_request_for_a_listed_routine(self):
        reqs = {p: d["data"] for p, d in self.walk.items() if p.startswith("requests/")}
        self.assertEqual(len(reqs), 1)
        r = next(iter(reqs.values()))
        self.assertEqual((r["status"], r["kind"], r["routine"]), ("pending", "run-now", "jobs-watch"))
        ids = [p["id"] for p in self.walk["meta/definition"]["data"]["producers"]]
        self.assertIn(r["routine"], ids)

    def test_notes_cover_the_stored_yellow_kind_and_boxes_that_cannot_be_placed(self):
        notes = self.walk["entities/" + make_v2_demo.ROLE]["data"]["capture"]["notes"]
        self.assertIn("yellow", [n["kind"] for n in notes])
        outside = [n for n in notes if not all(0 <= v <= 1 for v in n["box"]) or n["box"][2] == 0]
        self.assertGreaterEqual(len(outside), 2)

    def test_runs_with_and_without_the_optional_numbers(self):
        runs = [d["data"] for p, d in self.walk.items() if p.startswith("runs/")]
        has = [r for r in runs if "cost" in r and "captured" in r.get("counts", {})]
        lacks = [r for r in runs if "cost" not in r and "captured" not in r.get("counts", {})]
        self.assertTrue(has)
        self.assertTrue(lacks)
        self.assertIn("failed", has[0]["counts"])
        self.assertIn("newReds", has[0]["counts"])

    def test_the_plain_v2_fixture_is_unchanged_by_the_walk_data(self):
        self.assertFalse([p for p in self.v2 if p.startswith("requests/")])
        self.assertFalse([p for p in self.v2 if p.startswith("runs/") and "cost" in self.v2[p]["data"]])


if __name__ == "__main__":
    unittest.main()
