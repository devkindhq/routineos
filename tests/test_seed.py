import json
import os
import subprocess
import sys
import tempfile
import unittest
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "skills", "routineos", "scripts")
GENERATOR = os.path.join(ROOT, "templates", "jobs-watch", "demo", "generate.py")
SNAPSHOT = os.path.join(ROOT, "templates", "jobs-watch", "demo", "desk-demo.json")
sys.path.insert(0, SCRIPTS)

import definition  # noqa: E402
import desk_contract as dc  # noqa: E402

TARGETS = {"company": 200, "role": 400, "creator": 40, "video": 300, "tender": 30}


def generate(out, snapshot):
    r = subprocess.run([sys.executable, GENERATOR, "--out", out, "--snapshot", snapshot],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise AssertionError(r.stdout + r.stderr)


def read_tree(d):
    out = {}
    for name in sorted(os.listdir(d)):
        with open(os.path.join(d, name), "rb") as fh:
            out[name] = fh.read()
    return out


class SeedTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.out = os.path.join(cls.tmp.name, "a")
        cls.snap_path = os.path.join(cls.tmp.name, "a.json")
        generate(cls.out, cls.snap_path)
        with open(cls.snap_path, encoding="utf-8") as fh:
            cls.snap = json.load(fh)
        cls.batches = []
        for name in sorted(os.listdir(cls.out)):
            with open(os.path.join(cls.out, name), encoding="utf-8") as fh:
                cls.batches.append(json.load(fh))

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def docs(self, prefix):
        return {p: d["data"] for p, d in self.snap.items() if p.startswith(prefix)}

    def test_deterministic(self):
        out_b = os.path.join(self.tmp.name, "b")
        snap_b = os.path.join(self.tmp.name, "b.json")
        generate(out_b, snap_b)
        self.assertEqual(read_tree(self.out), read_tree(out_b))
        with open(self.snap_path, "rb") as a, open(snap_b, "rb") as b:
            self.assertEqual(a.read(), b.read())

    def test_volumes_within_ten_percent(self):
        counts = {}
        for doc in self.docs("entities/").values():
            counts[doc["type"]] = counts.get(doc["type"], 0) + 1
        for tname, target in TARGETS.items():
            self.assertLessEqual(abs(counts.get(tname, 0) - target), target * 0.1, (tname, counts.get(tname)))

    def test_six_runs_one_partial_with_drop_reasons(self):
        runs = self.docs("runs/")
        self.assertEqual(len(runs), 6)
        self.assertEqual({r["producer"] for r in runs.values()}, {"jobs-watch", "content-radar", "lead-signals"})
        partial = [r for r in runs.values() if r["status"] == "partial"]
        self.assertEqual(len(partial), 1)
        self.assertEqual((partial[0]["parsed"], partial[0]["claimed"]), (2, 3))
        self.assertTrue(partial[0]["droppedByReason"])
        self.assertTrue(all(r["phase"] == "done" for r in runs.values()))

    def test_five_inbox_messages_one_gated(self):
        inbox = self.docs("inbox/")
        self.assertEqual(len(inbox), 5)
        self.assertEqual(sorted(m["kind"] for m in inbox.values()), ["alert", "approval", "match", "match", "proposal"])
        gated = [m for m in inbox.values() if m.get("gate")]
        self.assertEqual(len(gated), 1)
        gate = self.snap["pending/" + gated[0]["gate"]]["data"]
        self.assertEqual((gate["transport"], gate["status"]), ("email", "pending"))
        self.assertTrue(gate["timeoutHours"])
        self.assertTrue(any(r.get("inboxSuppressed") for r in self.docs("runs/").values()))

    def test_agent_views_and_column_are_proposed(self):
        views = [v for v in self.docs("views/").values() if v["madeBy"] == "agent"]
        cols = [c for c in self.docs("columns/").values() if c["madeBy"] == "agent"]
        self.assertEqual(len(views), 2)
        self.assertEqual(len(cols), 1)
        self.assertTrue(all(x["state"] == "proposed" for x in views + cols))
        field = cols[0]["field"]
        scored = [e for e in self.docs("entities/").values() if field in e.get("agentFields", {})]
        self.assertTrue(scored)

    def test_agent_views_use_the_desk_shape(self):
        types = self.snap["meta/definition"]["data"]["types"]
        views = [dict(v, id=p[len("views/"):]) for p, v in self.docs("views/").items()]
        self.assertTrue(views)
        for v in views:
            self.assertEqual(definition.lint_view(v, types), [], v["id"])

    def test_every_domain_and_url_is_synthetic(self):
        for path, doc in self.docs("entities/").items():
            if doc["type"] == "company":
                self.assertTrue(doc["key"].endswith(".example"), path)
            for field, value in doc["display"].items():
                if field.endswith("domain"):
                    self.assertTrue(value.endswith(".example"), (path, value))
                if isinstance(value, str) and value.startswith(("http://", "https://")):
                    self.assertTrue((urlparse(value).hostname or "").endswith(".example"), (path, value))

    def test_doc_limits(self):
        self.assertLess(len(self.snap), 25000)
        for path, doc in self.snap.items():
            self.assertLessEqual(dc._bytes(doc["data"]), 256 * 1024, path)

    def test_companies_merged_across_producers(self):
        both = [e for e in self.docs("entities/company--").values()
                if {"jobs-watch", "lead-signals"} <= set(e["bySource"])]
        self.assertGreaterEqual(len(both), 10)

    def test_workspace_meta_and_human_steps(self):
        ws = self.snap["meta/workspace"]["data"]
        self.assertEqual((ws["template"], ws["templateVersion"], ws["createdBy"]), ("jobs-watch", 1, "routineos new"))
        self.assertTrue(ws["lint"]["ok"], ws["lint"])
        jw = self.snap["settings/jobs-watch"]["data"]
        self.assertNotEqual(jw["updatedBy"], "seed")
        runs = sorted((r for r in self.docs("runs/").values() if r["producer"] == "jobs-watch"),
                      key=lambda r: r["startedAt"])
        self.assertNotEqual(runs[0]["settingsUsed"], jw["values"])
        us = self.docs("userstate/")
        self.assertTrue(any(u.get("star") for u in us.values()))
        self.assertTrue(any(u.get("tags") for u in us.values()))
        self.assertTrue(any(u.get("note") for u in us.values()))

    def test_batches_replay_to_the_snapshot(self):
        store = dc.FakeStore()
        for batch in self.batches:
            self.assertLessEqual(len(batch["writes"]), 50)
            store.apply(batch["writes"])
        self.assertEqual(store.snapshot(), self.snap)

    def test_run_batches_pass_the_guard(self):
        for batch in self.batches:
            if not batch["phase"].startswith(("seed", "person")):
                dc.guard(batch["writes"])

    def test_committed_snapshot_is_current(self):
        with open(SNAPSHOT, "rb") as fh:
            committed = fh.read()
        with open(self.snap_path, "rb") as fh:
            self.assertEqual(committed, fh.read(), "templates/jobs-watch/demo/desk-demo.json is stale; rerun generate.py")


if __name__ == "__main__":
    unittest.main()
