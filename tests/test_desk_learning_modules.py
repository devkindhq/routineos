"""Learning reaches the sidebar only through the existing proposed-view path (spec 5). These tests pin it."""
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "skills", "routineos", "scripts"))

import definition  # noqa: E402
import desk_contract as dc  # noqa: E402

# Setup copied from tests/test_desk_contract.py.
JOBS_SETTINGS = [
    {"name": "markets", "type": "list", "default": ["AU", "US"], "role": "include"},
    {"name": "max_inbox_per_run", "type": "number", "default": 5, "min": 0, "max": 20},
]
JOBS = {
    "version": 1, "label": "Jobs watch", "inbox": True,
    "types": {
        "role": {
            "label": "Role", "plural": "Roles", "identity": "field:url",
            "fields": {"title": {"type": "text"}, "url": {"type": "url"},
                       "market": {"type": "choice", "choices": ["AU", "US", "CA", "NZ", "PH", "ZZ"]}},
            "settingFilters": [{"setting": "markets", "field": "market"}],
        },
    },
}
PID = "jobs-watch"
VIEW = {"id": "remote", "type": "role", "name": "Remote", "filters": {"tag": "remote"}}


def compiled():
    return definition.compile([{"id": PID, "schedule": "0 22 * * 1", "definition": JOBS, "settings": JOBS_SETTINGS}])


def run_input(run_id, views, at="2026-09-01T22:00:00Z"):
    return {"runId": run_id, "producer": PID, "startedAt": at, "endedAt": at, "status": "ok",
            "claimed": 0, "parsed": 0, "records": [], "inbox": [], "views": list(views)}


def new_store():
    store = dc.FakeStore()
    store.set("meta/definition", compiled())
    return store


def view_ops(store, inp):
    phases = dc.plan_run(compiled(), store.snapshot(), inp)
    return [op for ph in phases for op in ph["ops"] if op["collection"] == "views"]


class ProposedViewPath(unittest.TestCase):
    def test_proposed_view_lands_as_agent_proposal(self):
        ops = view_ops(new_store(), run_input("r1", [VIEW]))
        self.assertEqual(len(ops), 1)
        op = ops[0]
        self.assertEqual((op["op"], op["doc_id"]), ("set", "remote"))
        self.assertEqual(op["data"]["madeBy"], "agent")
        self.assertEqual(op["data"]["state"], "proposed")
        self.assertEqual(op["data"]["producer"], PID)
        self.assertEqual(op["data"]["filters"], {"tag": "remote"})

    def test_existing_view_not_overwritten(self):
        store = new_store()
        store.set("views/remote", {"type": "role", "name": "Remote", "madeBy": "human", "state": "kept", "filters": {}})
        self.assertEqual(view_ops(store, run_input("r1", [dict(VIEW, name="Changed")])), [])

    def test_no_new_prefix(self):
        # The 0.8.1 values plus comments/ (spec 7d) and requests/ (Desk v2 queue), both people's own: learning gains no new write path into the Desk.
        self.assertEqual(dc.HUMAN_PREFIXES, ("settings/", "userstate/", "decisions/", "merges/", "settingsHistory/",
                                             "data/users/", "people/", "comments/", "requests/"))
        self.assertEqual(dc.CREATE_ONLY_PREFIXES, ("views/", "columns/"))


if __name__ == "__main__":
    unittest.main()
