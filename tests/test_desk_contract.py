import copy
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "skills", "routineos", "scripts")
CLI = os.path.join(SCRIPTS, "routineos.py")
sys.path.insert(0, SCRIPTS)

import definition  # noqa: E402
import desk_contract as dc  # noqa: E402

JOBS_SETTINGS = [
    {"name": "markets", "type": "list", "default": ["AU", "US"], "role": "include"},
    {"name": "excluded_companies", "type": "list", "default": [], "role": "exclude"},
    {"name": "max_inbox_per_run", "type": "number", "default": 5, "min": 0, "max": 20},
]
COMPANY = {
    "label": "Company", "plural": "Companies", "identity": "domain",
    "fields": {"name": {"type": "text", "summary": True}, "domain": {"type": "url"}},
}
JOBS = {
    "version": 1, "label": "Jobs watch", "inbox": True,
    "types": {
        "company": dict(COMPANY, settingFilters=[{"setting": "excluded_companies", "field": "domain"}]),
        "role": {
            "label": "Role", "plural": "Roles", "identity": "field:url", "links": ["company"],
            "fields": {"title": {"type": "text"}, "url": {"type": "url"},
                       "market": {"type": "choice", "choices": ["AU", "US", "CA", "NZ", "PH", "ZZ"]},
                       "salary": {"type": "number"}},
            "settingFilters": [{"setting": "markets", "field": "market"}],
        },
    },
}
LEADS = {"version": 1, "label": "Lead signals", "inbox": False, "types": {"company": COMPANY}}


def compiled():
    return definition.compile([
        {"id": "jobs-watch", "schedule": "0 22 * * 1", "definition": JOBS, "settings": JOBS_SETTINGS},
        {"id": "lead-signals", "schedule": "0 22 * * 3", "definition": LEADS, "settings": []},
    ])


def company(domain, name=None, **values):
    return {"type": "company", "key": domain, "values": dict({"name": name or domain, "domain": domain}, **values)}


def role(url, market="AU", company_domain=None, **values):
    rec = {"type": "role", "values": dict({"title": "Role " + url, "url": url, "market": market}, **values)}
    if company_domain:
        rec["links"] = [{"type": "company", "key": company_domain}]
    return rec


def run_input(run_id, records, producer="jobs-watch", at="2026-09-01T22:00:00Z", inbox=(), **extra):
    base = {"runId": run_id, "producer": producer, "startedAt": at, "endedAt": at,
            "status": "ok", "claimed": len(records), "parsed": len(records),
            "records": list(records), "inbox": list(inbox)}
    base.update(extra)
    return base


def new_store(settings=None, workspace=None):
    store = dc.FakeStore()
    store.set("meta/definition", compiled())
    for pid, values in (settings or {}).items():
        store.set(f"settings/{pid}", {"values": values})
    if workspace:
        store.set("settings/workspace", {"values": workspace})
    return store


def apply_all(store, inp, defn=None):
    phases = dc.plan_run(defn or compiled(), store.snapshot(), inp)
    for ph in phases:
        store.apply(ph["ops"])
    return phases


def data(store, path):
    return store.snapshot()[path]["data"]


def all_ops(phases):
    return [op for ph in phases for op in ph["ops"]]


class IdentityTests(unittest.TestCase):
    def test_normalise_domain(self):
        for raw in ("HTTPS://www.Acme.Example/jobs?x=1", "acme.example", "http://acme.example:8080/",
                    " www.ACME.example. ", "user" + "@acme.example#top"):
            self.assertEqual(dc.normalise_key("domain", raw), "acme.example", raw)

    def test_normalise_name(self):
        self.assertEqual(dc.normalise_key("name", "  Acme,  Pty. Ltd. "), "acme pty ltd")

    def test_normalise_field_is_exact(self):
        self.assertEqual(dc.normalise_key("field:url", "https://X.example/A"), "https://X.example/A")

    def test_domain_rule_falls_back_to_name_when_not_a_domain(self):
        self.assertEqual(dc.normalise_key("domain", "  Acme,  Pty. Ltd. "), "acme pty ltd")
        self.assertEqual(dc.normalise_key("domain", "Acme Store"), "acme store")
        self.assertEqual(dc.normalise_key("domain", "https://www.Acme.example/"), "acme.example")

    def test_unknown_rule_raises(self):
        with self.assertRaises(ValueError):
            dc.normalise_key("fuzzy", "x")

    def test_entity_id(self):
        self.assertEqual(dc.entity_id("company", "acme.example"), "company--acme-example")
        long_a = dc.entity_id("role", "https://jobs.example/" + "a" * 300)
        long_b = dc.entity_id("role", "https://jobs.example/" + "a" * 299 + "b")
        self.assertLessEqual(len(long_a), len("role--") + 120)
        self.assertNotEqual(long_a, long_b)
        self.assertEqual(long_a, dc.entity_id("role", "https://jobs.example/" + "a" * 300))
        self.assertRegex(long_a, r"^role--[a-z0-9-]+$")


class CombineTests(unittest.TestCase):
    def test_latest_sighting_wins_per_field(self):
        by_source = {"a": {"name": "Old", "size": 5}, "b": {"name": "New"}}
        sightings = [
            {"run": "r1", "at": "2026-09-01T00:00:00Z", "producer": "a", "values": {"name": "Old", "size": 5}},
            {"run": "r2", "at": "2026-09-02T00:00:00Z", "producer": "b", "values": {"name": "New"}},
        ]
        self.assertEqual(dc.combine_fields(by_source, sightings), {"name": "New", "size": 5})

    def test_falls_back_to_by_source_when_sightings_trimmed(self):
        self.assertEqual(dc.combine_fields({"a": {"x": 1}}, []), {"x": 1})


class PlanTests(unittest.TestCase):
    def test_new_entity_then_rerun_is_noop(self):
        store = new_store()
        inp = run_input("r1", [company("acme.example", "Acme")])
        apply_all(store, inp)
        again = dc.plan_run(compiled(), store.snapshot(), inp)
        self.assertEqual(all_ops(again), [])
        doc = data(store, "entities/company--acme-example")
        self.assertEqual(len(doc["sightings"]), 1)
        self.assertEqual(doc["seenCount"], 1)
        self.assertEqual(data(store, "runs/r1")["phase"], "done")

    def test_unchanged_entity_updates_last_seen_once_per_run(self):
        store = new_store()
        apply_all(store, run_input("r1", [company("acme.example", "Acme")]))
        apply_all(store, run_input("r2", [company("acme.example", "Acme")], at="2026-09-08T22:00:00Z"))
        doc = data(store, "entities/company--acme-example")
        self.assertEqual((doc["seenCount"], doc["lastSeen"], doc["firstSeen"]),
                         (2, "2026-09-08T22:00:00Z", "2026-09-01T22:00:00Z"))
        self.assertEqual(data(store, "runs/r2")["counts"], {"new": 0, "updated": 0, "unchanged": 1, "dropped": 0})

    def test_two_producers_merge_company(self):
        store = new_store()
        apply_all(store, run_input("r1", [company("acme.example", "Acme")]))
        apply_all(store, run_input("r2", [company("https://www.acme.example/", "Acme Group")],
                                   producer="lead-signals", at="2026-09-03T22:00:00Z"))
        doc = data(store, "entities/company--acme-example")
        self.assertEqual(sorted(doc["bySource"]), ["jobs-watch", "lead-signals"])
        self.assertEqual(doc["bySource"]["jobs-watch"]["name"], "Acme")
        self.assertEqual(doc["display"]["name"], "Acme Group")
        self.assertEqual(doc["sources"], ["jobs-watch", "lead-signals"])

    def test_separate_policy_keys_by_producer(self):
        store = new_store(workspace={"mergePolicy": {"company": "separate"}})
        apply_all(store, run_input("r1", [company("acme.example")]))
        apply_all(store, run_input("r2", [company("acme.example")], producer="lead-signals"))
        snap = store.snapshot()
        self.assertIn("entities/company--jobs-watch-acme-example", snap)
        self.assertIn("entities/company--lead-signals-acme-example", snap)
        self.assertNotIn("entities/company--acme-example", snap)

    def test_policy_flip_never_rekeys_existing(self):
        store = new_store()
        apply_all(store, run_input("r1", [company("acme.example")]))
        before = data(store, "entities/company--acme-example")
        store.set("settings/workspace", {"values": {"mergePolicy": {"company": "separate"}}})
        apply_all(store, run_input("r2", [company("acme.example")], at="2026-09-09T00:00:00Z"))
        self.assertEqual(data(store, "entities/company--acme-example"), before)

    def test_exclusion_drops_with_reason(self):
        store = new_store(settings={"jobs-watch": {"excluded_companies": ["BadCo.example"]}})
        recs = [company("badco.example"), company("good.example"),
                role("https://jobs.example/1", "ZZ"), role("https://jobs.example/2", "AU")]
        apply_all(store, run_input("r1", recs))
        bad = data(store, "entities/company--badco-example")
        self.assertEqual((bad["status"], bad["dropReason"]), ("dropped", "excluded by excluded_companies"))
        self.assertEqual(data(store, "entities/company--good-example")["status"], "active")
        zz = data(store, "entities/role--https-jobs-example-1")
        self.assertEqual(zz["dropReason"], "not in markets")
        run = data(store, "runs/r1")
        self.assertEqual(run["counts"]["dropped"], 2)
        self.assertEqual(run["droppedByReason"], {"excluded by excluded_companies": 1, "not in markets": 1})
        self.assertEqual(run["settingsUsed"]["excluded_companies"], ["BadCo.example"])
        self.assertEqual(len(run["dropped"]), 2)

    def test_kept_record_stays_active_across_a_dropping_run(self):
        store = new_store()
        rid = "role--https-jobs-example-1"
        apply_all(store, run_input("r1", [role("https://jobs.example/1", "CA")]))
        self.assertEqual(data(store, f"entities/{rid}")["status"], "dropped")
        store.set(f"decisions/{rid}", {"decision": "keep", "at": "2026-09-02T00:00:00Z", "by": "u1"})
        phases = apply_all(store, run_input("r2", [role("https://jobs.example/1", "CA")], at="2026-09-09T22:00:00Z"))
        doc = data(store, f"entities/{rid}")
        self.assertEqual((doc["status"], doc["dropReason"]), ("active", None))
        self.assertEqual(doc["sightings"][-1]["note"], "kept by person")
        self.assertIsNone(doc["sightings"][-1]["dropReason"])
        self.assertNotIn("note", doc["sightings"][0])
        run = data(store, "runs/r2")
        self.assertEqual(run["counts"]["dropped"], 0)
        self.assertEqual(run["droppedByReason"], {})
        self.assertNotIn(f"decisions/{rid}", [f"{op['collection']}/{op['doc_id']}" for op in all_ops(phases)])
        self.assertEqual(data(store, f"decisions/{rid}")["decision"], "keep")
        # The keep survives further runs while the decision stands.
        apply_all(store, run_input("r3", [role("https://jobs.example/1", "CA")], at="2026-09-16T22:00:00Z"))
        self.assertEqual(data(store, f"entities/{rid}")["status"], "active")

    def test_removing_the_keep_restores_dropping(self):
        store = new_store()
        rid = "role--https-jobs-example-1"
        store.set(f"decisions/{rid}", {"decision": "keep", "at": "2026-09-02T00:00:00Z", "by": "u1"})
        apply_all(store, run_input("r1", [role("https://jobs.example/1", "CA")]))
        self.assertEqual(data(store, f"entities/{rid}")["status"], "active")
        store.delete(f"decisions/{rid}", if_version=1)
        apply_all(store, run_input("r2", [role("https://jobs.example/1", "CA")], at="2026-09-09T22:00:00Z"))
        doc = data(store, f"entities/{rid}")
        self.assertEqual((doc["status"], doc["dropReason"]), ("dropped", "not in markets"))
        self.assertNotIn("note", doc["sightings"][-1])
        self.assertEqual(data(store, "runs/r2")["counts"]["dropped"], 1)

    def test_a_person_drop_marks_the_record_dropped_with_its_reason(self):
        store = new_store()
        rid = "role--https-jobs-example-2"
        apply_all(store, run_input("r1", [role("https://jobs.example/2", "AU")]))
        self.assertEqual(data(store, f"entities/{rid}")["status"], "active")
        store.set(f"decisions/{rid}", {"decision": "drop", "reason": "too junior", "at": "2026-09-02T00:00:00Z", "by": "u1"})
        apply_all(store, run_input("r2", [role("https://jobs.example/2", "AU")], at="2026-09-09T22:00:00Z"))
        doc = data(store, f"entities/{rid}")
        self.assertEqual((doc["status"], doc["dropReason"]), ("dropped", "too junior"))
        self.assertEqual(doc["sightings"][-1]["note"], "dropped by person")
        self.assertEqual(data(store, "runs/r2")["droppedByReason"], {"dropped by person": 1})
        # The routine never overrides it while the decision stands.
        apply_all(store, run_input("r3", [role("https://jobs.example/2", "AU")], at="2026-09-16T22:00:00Z"))
        self.assertEqual(data(store, f"entities/{rid}")["status"], "dropped")
        # Restore deletes the decision; the routine's own filters apply again.
        store.delete(f"decisions/{rid}", if_version=1)
        apply_all(store, run_input("r4", [role("https://jobs.example/2", "AU")], at="2026-09-23T22:00:00Z"))
        self.assertEqual((data(store, f"entities/{rid}")["status"], data(store, f"entities/{rid}")["dropReason"]), ("active", None))

    def test_a_person_drop_without_a_reason_still_drops(self):
        store = new_store()
        rid = "role--https-jobs-example-2"
        store.set(f"decisions/{rid}", {"decision": "drop", "at": "2026-09-02T00:00:00Z", "by": "u1"})
        apply_all(store, run_input("r1", [role("https://jobs.example/2", "AU")]))
        doc = data(store, f"entities/{rid}")
        self.assertEqual((doc["status"], doc["dropReason"]), ("dropped", "dropped by person"))

    def test_a_long_person_drop_reason_is_capped_and_never_a_summary_key(self):
        store = new_store()
        rid = "role--https-jobs-example-2"
        store.set(f"decisions/{rid}", {"decision": "drop", "reason": "x\u0000\n" + "y" * 10000, "at": "2026-09-02T00:00:00Z", "by": "u1"})
        apply_all(store, run_input("r1", [role("https://jobs.example/2", "AU")]))
        doc = data(store, f"entities/{rid}")
        self.assertEqual(doc["status"], "dropped")
        self.assertEqual(len(doc["dropReason"]), 200)
        self.assertTrue(doc["dropReason"].startswith("xy"))
        self.assertEqual(doc["sightings"][-1]["dropReason"], "dropped by person")
        run = data(store, "runs/r1")
        self.assertEqual(run["droppedByReason"], {"dropped by person": 1})
        self.assertEqual(run["dropped"], [{"id": rid, "reason": "dropped by person"}])

    def test_a_person_drop_reason_loses_bidi_zero_width_and_c1_controls(self):
        store = new_store()
        rid = "role--https-jobs-example-2"
        reason = "‮abc⁦d​e\u0085f g h ﻿café"
        store.set(f"decisions/{rid}", {"decision": "drop", "reason": reason, "at": "2026-09-02T00:00:00Z", "by": "u1"})
        apply_all(store, run_input("r1", [role("https://jobs.example/2", "AU")]))
        self.assertEqual(data(store, f"entities/{rid}")["dropReason"], "abcdefg h café")

    def test_merge_field_picks_override_the_kept_records_display(self):
        store = new_store()
        a, b = "role--https-jobs-example-1", "role--https-jobs-example-2"
        apply_all(store, run_input("r1", [role("https://jobs.example/1", "AU"), role("https://jobs.example/2", "AU")]))
        store.set(f"merges/{a}", {"into": b, "fields": {"market": "NZ", "notAField": "x"}, "at": "2026-09-02T00:00:00Z", "by": "u1"})
        apply_all(store, run_input("r2", [role("https://jobs.example/2", "AU")], at="2026-09-09T22:00:00Z"))
        doc = data(store, f"entities/{b}")
        self.assertEqual(doc["display"]["market"], "NZ")
        self.assertNotIn("notAField", doc["display"])
        self.assertEqual(doc["bySource"]["jobs-watch"]["market"], "AU")

    def test_a_keep_on_an_active_record_adds_no_note(self):
        store = new_store()
        rid = "role--https-jobs-example-2"
        store.set(f"decisions/{rid}", {"decision": "keep", "at": "2026-09-02T00:00:00Z", "by": "u1"})
        apply_all(store, run_input("r1", [role("https://jobs.example/2", "AU")]))
        doc = data(store, f"entities/{rid}")
        self.assertEqual(doc["status"], "active")
        self.assertNotIn("note", doc["sightings"][-1])

    def test_jobs_watch_role_summary_is_a_text_field_the_contract_stores(self):
        path = os.path.join(ROOT, "templates", "jobs-watch", "definition.json")
        defn = definition.load(path)
        self.assertEqual(defn["types"]["role"]["fields"]["summary"]["type"], "text")
        settings = JOBS_SETTINGS + [{"name": "title_keywords", "type": "list", "default": [], "role": "include"},
                                    {"name": "excluded_title_words", "type": "list", "default": [], "role": "exclude"}]
        cdefn = definition.compile([{"id": "jobs-watch", "schedule": "0 22 * * 1", "definition": defn,
                                     "settings": settings}])
        store = dc.FakeStore()
        store.set("meta/definition", cdefn)
        text = "Owns the Shopify Plus storefront for a homewares brand. The page states a team of four."
        recs = [role("https://jobs.example/1", summary=text), role("https://jobs.example/2")]
        apply_all(store, run_input("r1", recs), defn=cdefn)
        one = data(store, "entities/role--https-jobs-example-1")
        self.assertEqual((one["status"], one["display"]["summary"]), ("active", text))
        self.assertEqual(one["bySource"]["jobs-watch"]["summary"], text)
        self.assertEqual(one["sightings"][-1]["values"]["summary"], text)
        self.assertNotIn("summary", data(store, "entities/role--https-jobs-example-2")["display"])

    def test_settings_default_when_doc_missing(self):
        store = new_store()
        apply_all(store, run_input("r1", [role("https://jobs.example/1", "CA")]))
        self.assertEqual(data(store, "runs/r1")["settingsUsed"]["markets"], ["AU", "US"])
        self.assertEqual(data(store, "entities/role--https-jobs-example-1")["status"], "dropped")

    def test_sightings_capped_at_30(self):
        store = new_store()
        for i in range(35):
            apply_all(store, run_input(f"r{i:02d}", [company("acme.example", f"Acme {i}")],
                                       at=f"2026-09-01T{i % 24:02d}:{i:02d}:00Z"))
        doc = data(store, "entities/company--acme-example")
        self.assertEqual(len(doc["sightings"]), 30)
        self.assertEqual(doc["sightings"][0]["run"], "r05")
        self.assertEqual(doc["seenCount"], 35)

    def test_links_are_resolved_to_entity_ids(self):
        store = new_store()
        apply_all(store, run_input("r1", [role("https://jobs.example/1", company_domain="https://acme.example/x")]))
        links = data(store, "entities/role--https-jobs-example-1")["links"]
        self.assertEqual(links, [{"type": "company", "key": "acme.example", "id": "company--acme-example"}])

    def test_company_without_domain_keys_on_name_and_role_still_links(self):
        store = new_store()
        nameless = {"type": "company", "values": {"name": "Acme Pty. Ltd."}}
        rec = role("https://jobs.example/1")
        rec["links"] = [{"type": "company", "key": "Acme Pty Ltd"}]
        apply_all(store, run_input("r1", [nameless, rec]))
        doc = data(store, "entities/company--acme-pty-ltd")
        self.assertEqual(doc["key"], "acme pty ltd")
        links = data(store, "entities/role--https-jobs-example-1")["links"]
        self.assertEqual(links, [{"type": "company", "key": "acme pty ltd", "id": "company--acme-pty-ltd"}])

    def test_company_key_taken_from_domain_value_when_no_key(self):
        store = new_store()
        apply_all(store, run_input("r1", [{"type": "company", "values": {"name": "Acme", "domain": "acme.example"}}]))
        self.assertEqual(data(store, "entities/company--acme-example")["key"], "acme.example")

    def test_company_with_no_domain_and_no_name_still_fails(self):
        with self.assertRaises(dc.ContractError):
            dc.plan_run(compiled(), new_store().snapshot(), run_input("r1", [{"type": "company", "values": {}}]))

    def test_text_keyword_filter_matches_inside_words(self):
        defn = json.loads(json.dumps(JOBS))
        defn["types"]["role"]["settingFilters"].append({"setting": "title_keywords", "field": "title"})
        settings = JOBS_SETTINGS + [{"name": "title_keywords", "type": "list", "default": ["commerce", "Shopify"],
                                     "role": "include"}]
        cdefn = definition.compile([{"id": "jobs-watch", "schedule": "0 22 * * 1", "definition": defn,
                                     "settings": settings}])
        store = dc.FakeStore()
        store.set("meta/definition", cdefn)
        recs = [role("https://jobs.example/1", title="Senior Ecommerce Developer"),
                role("https://jobs.example/2", title="SHOPIFY Plus lead"),
                role("https://jobs.example/3", title="Magento developer")]
        apply_all(store, run_input("r1", recs), defn=cdefn)
        status = {n: data(store, f"entities/role--https-jobs-example-{n}")["status"] for n in (1, 2, 3)}
        self.assertEqual(status, {1: "active", 2: "active", 3: "dropped"})
        self.assertEqual(data(store, "entities/role--https-jobs-example-3")["dropReason"], "not in title_keywords")

    def test_inbox_cap_and_suppressed_count(self):
        store = new_store()
        msgs = [{"kind": "match", "title": f"Match {i}", "why": "keyword",
                 "refs": [{"type": "company", "key": "acme.example"}]} for i in range(8)]
        apply_all(store, run_input("r1", [company("acme.example")], inbox=msgs))
        snap = store.snapshot()
        ids = sorted(p for p in snap if p.startswith("inbox/"))
        self.assertEqual(ids, [f"inbox/r1--{n}" for n in range(1, 6)])
        self.assertEqual(snap["inbox/r1--1"]["data"]["refs"][0]["id"], "company--acme-example")
        run = snap["runs/r1"]["data"]
        self.assertEqual((run["inboxWritten"], run["inboxSuppressed"]), (5, 3))

    def test_cap_follows_setting_value(self):
        store = new_store(settings={"jobs-watch": {"max_inbox_per_run": 2}})
        msgs = [{"kind": "alert", "title": f"A {i}", "why": "x"} for i in range(4)]
        apply_all(store, run_input("r1", [], inbox=msgs))
        self.assertEqual(data(store, "runs/r1")["inboxSuppressed"], 2)

    def test_quiet_run_writes_no_inbox(self):
        store = new_store()
        apply_all(store, run_input("r1", [company("acme.example")]))
        self.assertFalse([p for p in store.snapshot() if p.startswith("inbox/")])
        self.assertEqual(data(store, "runs/r1")["inboxWritten"], 0)

    def test_match_about_dropped_entity_is_filtered_and_counted(self):
        store = new_store(settings={"jobs-watch": {"excluded_companies": ["badco.example"]}})
        msgs = [{"kind": "match", "title": "Bad", "why": "x", "refs": [{"type": "company", "key": "badco.example"}]}]
        apply_all(store, run_input("r1", [company("badco.example")], inbox=msgs))
        self.assertFalse([p for p in store.snapshot() if p.startswith("inbox/")])
        self.assertEqual(data(store, "runs/r1")["inboxFiltered"], 1)

    def test_proposal_with_setting_from_to_is_written_as_given(self):
        store = new_store()
        prop = {"setting": "title_keywords", "from": ["Shopify"], "to": ["Shopify", "Hydrogen"]}
        apply_all(store, run_input("r1", [], inbox=[{"kind": "proposal", "title": "Add Hydrogen", "why": "x", "proposal": prop}]))
        doc = data(store, "inbox/r1--1")
        self.assertEqual((doc["kind"], doc["proposal"]), ("proposal", prop))

    def test_proposal_with_current_and_suggested_is_refused_naming_the_fields(self):
        store = new_store()
        legacy = {"setting": "title_keywords", "current": ["Shopify"], "suggested": ["Shopify", "Hydrogen"]}
        inp = run_input("r1", [], inbox=[{"kind": "proposal", "title": "Add Hydrogen", "why": "x", "proposal": legacy}])
        with self.assertRaises(dc.ContractError) as cm:
            dc.plan_run(compiled(), store.snapshot(), inp)
        msg = str(cm.exception)
        self.assertIn('{"setting": "<key>", "from": <current value>, "to": <suggested value>}', msg)
        self.assertIn("use the fields from and to, not current and suggested", msg)
        self.assertFalse([p for p in store.snapshot() if p.startswith(("inbox/", "runs/"))])

    def test_proposal_missing_a_key_is_refused(self):
        bad = [None, "title_keywords", {"from": [], "to": ["AU"]}, {"setting": "", "from": [], "to": []},
               {"setting": "markets", "to": ["AU"]}, {"setting": "markets", "from": ["AU"]}]
        for prop in bad:
            msg = {"kind": "proposal", "title": "t", "why": "x"}
            if prop is not None:
                msg["proposal"] = prop
            with self.subTest(prop=prop), self.assertRaises(dc.ContractError):
                dc.plan_run(compiled(), new_store().snapshot(), run_input("r1", [], inbox=[msg]))

    def test_proposal_from_may_be_null_and_to_may_equal_from(self):
        store = new_store()
        msgs = [{"kind": "proposal", "title": "a", "why": "x", "proposal": {"setting": "lookback_days", "from": None, "to": 14}},
                {"kind": "proposal", "title": "b", "why": "x", "proposal": {"setting": "markets", "from": ["AU"], "to": ["AU"]}}]
        apply_all(store, run_input("r1", [], inbox=msgs))
        self.assertEqual(data(store, "inbox/r1--1")["proposal"]["to"], 14)
        self.assertEqual(data(store, "inbox/r1--2")["proposal"]["to"], ["AU"])

    def test_partial_when_parsed_below_claimed(self):
        store = new_store()
        apply_all(store, run_input("r1", [company("acme.example")], claimed=3, parsed=2))
        run = data(store, "runs/r1")
        self.assertEqual((run["status"], run["parsed"], run["claimed"]), ("partial", 2, 3))

    def test_phase_order(self):
        store = new_store()
        recs = [company(f"c{i}.example") for i in range(120)]
        phases = dc.plan_run(compiled(), store.snapshot(),
                             run_input("r1", recs, inbox=[{"kind": "alert", "title": "t", "why": "w"}]))
        names = [ph["name"] for ph in phases]
        self.assertEqual(names, ["started", "entities", "entities", "entities", "summary", "inbox", "done"])
        for ph in phases:
            self.assertLessEqual(len(ph["ops"]), 50)
            paths = [op["collection"] + "/" + op["doc_id"] for op in ph["ops"]]
            self.assertEqual(len(paths), len(set(paths)))

    def test_recovery_matches_clean_run(self):
        recs = [company(f"c{i}.example", f"C {i}") for i in range(120)]
        recs[7] = company("badco.example")
        msgs = [{"kind": "match", "title": f"M {i}", "why": "w", "refs": [{"type": "company", "key": f"c{i}.example"}]}
                for i in range(1, 7)]
        settings = {"jobs-watch": {"excluded_companies": ["badco.example"]}}
        inp = run_input("r1", recs, inbox=msgs, claimed=121, parsed=120)

        clean = new_store(settings)
        apply_all(clean, run_input("r0", [company("c3.example", "Old")], at="2026-08-30T00:00:00Z"))
        apply_all(clean, inp)

        crashed = new_store(settings)
        apply_all(crashed, run_input("r0", [company("c3.example", "Old")], at="2026-08-30T00:00:00Z"))
        phases = dc.plan_run(compiled(), crashed.snapshot(), inp)
        for ph in phases[:3]:  # started and two of three entity chunks
            crashed.apply(ph["ops"])
        self.assertEqual(data(crashed, "runs/r1")["phase"], "started")
        apply_all(crashed, inp)

        strip = lambda s: {p: v["data"] for p, v in s.snapshot().items()}
        self.assertEqual(strip(crashed), strip(clean))
        self.assertEqual(data(clean, "runs/r1")["counts"], {"new": 119, "updated": 1, "unchanged": 0, "dropped": 1})

    def test_hand_merge_redirects(self):
        store = new_store()
        apply_all(store, run_input("r1", [company("a.example"), company("b.example")]))
        store.set("merges/company--b-example", {"into": "company--a-example"})
        apply_all(store, run_input("r2", [company("b.example", "B again")], at="2026-09-02T00:00:00Z"))
        a = data(store, "entities/company--a-example")
        b = data(store, "entities/company--b-example")
        self.assertEqual([s["run"] for s in a["sightings"]], ["r1", "r2"])
        self.assertEqual(b["seenCount"], 1)

    def test_doc_size_limit(self):
        store = new_store()
        rec = company("huge.example", "x" * (300 * 1024))
        with self.assertRaises(dc.ContractError) as cm:
            dc.plan_run(compiled(), store.snapshot(), run_input("r1", [rec]))
        self.assertIn("company--huge-example", str(cm.exception))

    def test_userstate_is_never_read_into_ops(self):
        store = new_store()
        store.set("userstate/company--acme-example", {"note": "PRIVATE-NOTE", "star": True})
        store.set("data/users/u1/state/read/r0--1", {"at": "PRIVATE-AT"})
        phases = dc.plan_run(compiled(), store.snapshot(), run_input("r1", [company("acme.example")]))
        text = json.dumps(phases)
        self.assertNotIn("PRIVATE", text)

    def test_agent_fields_keep_only_existing_columns(self):
        store = new_store()
        store.set("columns/fit", {"type": "company", "name": "Fit", "fieldType": "text",
                                  "producer": "jobs-watch", "state": "proposed"})
        rec = dict(company("acme.example"), agentFields={"fit": "high", "gone": "x"})
        apply_all(store, run_input("r1", [rec]))
        self.assertEqual(data(store, "entities/company--acme-example")["agentFields"], {"fit": "high"})

    def test_agent_views_created_once_never_edited(self):
        store = new_store()
        view = {"id": "agent-au", "type": "role", "name": "AU roles", "filters": {"market": "AU"}}
        apply_all(store, run_input("r1", [], views=[view], columns=[{"id": "fit", "type": "company",
                                                                    "name": "Fit", "fieldType": "text"}]))
        v = data(store, "views/agent-au")
        self.assertEqual((v["madeBy"], v["state"], v["producer"]), ("agent", "proposed", "jobs-watch"))
        self.assertEqual(data(store, "columns/fit")["state"], "proposed")
        phases = dc.plan_run(compiled(), store.snapshot(),
                             run_input("r2", [], views=[dict(view, name="Changed")]))
        self.assertFalse([op for op in all_ops(phases) if op["collection"] == "views"])

    def test_agent_view_icon_must_be_a_desk_icon(self):
        store = new_store()
        view = {"id": "agent-au", "type": "role", "name": "AU roles", "filters": {}, "icon": "sparkles"}
        with self.assertRaises(dc.ContractError) as cm:
            dc.plan_run(compiled(), store.snapshot(), run_input("r1", [], views=[view]))
        self.assertIn("icon 'sparkles' is not a Desk icon", str(cm.exception))
        apply_all(store, run_input("r1", [], views=[dict(view, icon="globe")]))
        self.assertEqual(data(store, "views/agent-au")["icon"], "globe")

    def test_view_and_column_ids_cannot_traverse_paths(self):
        store = new_store()
        for bad in ("../settings/jobs-watch", "a/b", "A", "", ".x"):
            with self.assertRaises(dc.ContractError):
                dc.plan_run(compiled(), store.snapshot(),
                            run_input("r1", [], views=[{"id": bad, "type": "role", "name": "x", "filters": {}}]))
            with self.assertRaises(dc.ContractError):
                dc.plan_run(compiled(), store.snapshot(),
                            run_input("r1", [], columns=[{"id": bad, "type": "company", "name": "x", "fieldType": "text"}]))

    def test_plan_is_pure(self):
        store = new_store()
        snap = store.snapshot()
        frozen = json.dumps(snap, sort_keys=True)
        inp = run_input("r1", [company("acme.example")])
        a = dc.plan_run(compiled(), snap, inp)
        b = dc.plan_run(compiled(), snap, inp)
        self.assertEqual(a, b)
        self.assertEqual(json.dumps(snap, sort_keys=True), frozen)


class GuardTests(unittest.TestCase):
    def op(self, path, op="set", if_version=None):
        coll, _, doc_id = path.rpartition("/")
        entry = {"op": op, "collection": coll, "doc_id": doc_id, "data": {}}
        if if_version:
            entry["if_version"] = if_version
        return entry

    def test_guard_refuses_human_paths(self):
        for path in ("settings/jobs-watch", "settings/workspace", "userstate/company--a", "decisions/r1--1",
                     "merges/company--a", "data/users/u1/state/read/r1--1", "settingsHistory/h1"):
            for op in ("set", "update", "delete"):
                with self.assertRaises(dc.HumanPathError, msg=path):
                    dc.guard([self.op(path, op)])

    def test_guard_refuses_editing_existing_view_or_column(self):
        for path in ("views/v1", "columns/c1"):
            with self.assertRaises(dc.HumanPathError):
                dc.guard([self.op(path, if_version=3)])
            with self.assertRaises(dc.HumanPathError):
                dc.guard([self.op(path, "delete")])
            dc.guard([self.op(path)])  # creating is allowed

    def test_guard_allows_producer_paths(self):
        dc.guard([self.op("entities/company--a"), self.op("runs/r1", if_version=2), self.op("inbox/r1--1")])


class StoreTests(unittest.TestCase):
    def test_missing_get_returns_text(self):
        self.assertIsInstance(dc.FakeStore().get("runs/nope"), str)

    def test_set_existing_needs_current_version(self):
        s = dc.FakeStore()
        s.set("runs/r1", {"a": 1})
        with self.assertRaises(dc.VersionMismatch):
            s.set("runs/r1", {"a": 2})
        with self.assertRaises(dc.VersionMismatch):
            s.set("runs/r1", {"a": 2}, if_version=9)
        s.set("runs/r1", {"a": 2}, if_version=1)
        self.assertEqual(s.get("runs/r1"), {"path": "runs/r1", "version": 2, "data": {"a": 2}})

    def test_batch_is_all_or_nothing(self):
        s = dc.FakeStore()
        s.set("runs/r1", {"a": 1})
        ops = [{"op": "set", "collection": "runs", "doc_id": "r2", "data": {"b": 1}},
               {"op": "set", "collection": "runs", "doc_id": "r1", "data": {"a": 2}}]
        with self.assertRaises(dc.VersionMismatch):
            s.apply(ops)
        self.assertIsInstance(s.get("runs/r2"), str)


class ApplyRunTests(unittest.TestCase):
    def test_version_mismatch_retry(self):
        store = new_store()
        apply_all(store, run_input("r0", [company("acme.example", "Acme")], producer="lead-signals"))

        class Concurrent(dc.FakeStore):
            fired = False

            def apply(self, ops):
                if not self.fired and any(op["collection"] == "entities" for op in ops):
                    self.fired = True
                    cur = self.get("entities/company--acme-example")
                    assert isinstance(cur, dict), cur
                    body = json.loads(json.dumps(cur["data"]))
                    body["bySource"]["lead-signals"]["name"] = "Acme Changed"
                    self.set("entities/company--acme-example", body, if_version=cur["version"])
                return super().apply(ops)

        racy = Concurrent()
        racy.docs = store.docs
        report = dc.apply_run(racy, compiled(), run_input("r1", [company("acme.example", "Acme")],
                                                          at="2026-09-05T00:00:00Z"))
        self.assertEqual((report["ok"], report["attempts"]), (True, 2))
        doc = data(racy, "entities/company--acme-example")
        self.assertEqual(doc["bySource"]["lead-signals"]["name"], "Acme Changed")
        self.assertIn("jobs-watch", doc["bySource"])

    def test_second_mismatch_is_reported(self):
        class AlwaysRacy(dc.FakeStore):
            def apply(self, ops):
                if any(op["collection"] == "entities" for op in ops):
                    raise dc.VersionMismatch("entities/company--acme-example", 99)
                return super().apply(ops)

        store = AlwaysRacy()
        store.set("meta/definition", compiled())
        report = dc.apply_run(store, compiled(), run_input("r1", [company("acme.example")]))
        self.assertEqual((report["ok"], report["attempts"]), (False, 2))
        self.assertIn("entities/company--acme-example", report["error"])


class GateTests(unittest.TestCase):
    GATE = {"id": "r1--g1", "transport": "email", "timeoutHours": 48, "correlation": "rt-intro-note-1"}

    def test_gate_written_as_pending_in_inbox_phase(self):
        store = new_store()
        phases = apply_all(store, run_input("r1", [company("acme.example")], gates=[self.GATE],
                                            inbox=[{"kind": "approval", "title": "Draft intro",
                                                    "refs": [{"type": "company", "key": "acme.example"}],
                                                    "gate": "r1--g1"}]))
        inbox_phase = [ph for ph in phases if ph["name"] == "inbox"][0]
        self.assertIn("pending/r1--g1", [f"{o['collection']}/{o['doc_id']}" for o in inbox_phase["ops"]])
        doc = data(store, "pending/r1--g1")
        self.assertEqual((doc["transport"], doc["timeoutHours"], doc["status"]), ("email", 48, "pending"))
        self.assertEqual((doc["run"], doc["producer"]), ("r1", "jobs-watch"))
        self.assertEqual(data(store, "inbox/r1--1")["gate"], "r1--g1")

    def test_gate_may_carry_a_draft_and_recipients_by_role(self):
        store = new_store()
        gate = dict(self.GATE, draft={"subject": "Intro", "body": "Hello"}, recipients=[{"role": "hiring manager"}])
        apply_all(store, run_input("r1", [], gates=[gate]))
        doc = data(store, "pending/r1--g1")
        self.assertEqual(doc["draft"], {"subject": "Intro", "body": "Hello"})
        self.assertEqual(doc["recipients"], [{"role": "hiring manager"}])

    def test_gate_recipient_with_an_address_or_other_key_is_refused(self):
        addr = "a" + chr(64) + "b.example"
        bad = ([{"role": "owner", "email": addr}], [{"address": "x"}], [{"role": addr}],
               [{"role": ""}], [{"role": 3}], {"role": "owner"}, ["owner"])
        for recipients in bad:
            with self.assertRaises(dc.ContractError, msg=repr(recipients)):
                dc.plan_run(compiled(), {}, run_input("r1", [], gates=[dict(self.GATE, recipients=recipients)]))

    def test_gate_draft_must_be_subject_and_body_strings(self):
        bad = ({"subject": "x"}, {"subject": "x", "body": 1}, {"subject": "x", "body": "y", "to": "z"}, "text")
        for draft in bad:
            with self.assertRaises(dc.ContractError, msg=repr(draft)):
                dc.plan_run(compiled(), {}, run_input("r1", [], gates=[dict(self.GATE, draft=draft)]))

    def test_gate_rerun_is_noop(self):
        store = new_store()
        inp = run_input("r1", [], gates=[self.GATE])
        apply_all(store, inp)
        before = store.snapshot()
        apply_all(store, inp)
        self.assertEqual(store.snapshot(), before)

    def test_half_applied_rerun_reaches_same_state(self):
        inp = run_input("r1", [], gates=[self.GATE])
        clean = new_store()
        apply_all(clean, inp)
        half = new_store()
        for ph in dc.plan_run(compiled(), half.snapshot(), inp):
            half.apply(ph["ops"])
            if ph["name"] == "inbox":
                break
        self.assertEqual(data(half, "pending/r1--g1")["status"], "pending")
        apply_all(half, inp)
        strip = lambda s: {p: v["data"] for p, v in s.snapshot().items()}
        self.assertEqual(strip(half), strip(clean))

    def test_producer_status_and_outcome_are_dropped(self):
        store = new_store()
        apply_all(store, run_input("r1", [], gates=[dict(self.GATE, status="decided", outcome="approve")]))
        doc = data(store, "pending/r1--g1")
        self.assertEqual(doc["status"], "pending")
        self.assertNotIn("outcome", doc)

    def test_existing_gate_from_another_run_is_not_overwritten(self):
        store = new_store()
        store.set("pending/r1--g1", {"transport": "email", "status": "waiting", "run": "r0", "producer": "jobs-watch"})
        before = data(store, "pending/r1--g1")
        apply_all(store, run_input("r1", [], gates=[self.GATE]))
        self.assertEqual(data(store, "pending/r1--g1"), before)

    def test_gate_with_a_decision_is_not_written(self):
        store = new_store()
        store.set("decisions/r1--g1", {"decision": "approve", "by": "someone"})
        apply_all(store, run_input("r1", [], gates=[self.GATE]))
        self.assertNotIn("pending/r1--g1", store.snapshot())

    def test_gate_id_must_carry_this_run_id(self):
        for gid in ("intro-note-1", "r0--g1", "r1--1", "r1--g0", "r1-x--g1", "r1--g1x", "R1--g1", "r1--g01"):
            with self.subTest(gid=gid):
                with self.assertRaises(dc.ContractError):
                    dc.plan_run(compiled(), new_store().snapshot(),
                                run_input("r1", [], gates=[dict(self.GATE, id=gid)]))


class SeedPlanTests(unittest.TestCase):
    WS = {"name": "Demo desk", "template": "jobs-watch", "templateVersion": 1,
          "createdAt": "2026-09-01T00:00:00Z", "lint": {"ok": True, "problems": []}}

    def paths(self, ops):
        return [f"{o['collection']}/{o['doc_id']}" for o in ops]

    def test_seed_writes_meta_and_default_settings(self):
        ops = [o for ph in dc.plan_seed(compiled(), self.WS, {}) for o in ph["ops"]]
        self.assertEqual(self.paths(ops), ["meta/workspace", "meta/definition", "settings/jobs-watch",
                                           "settings/lead-signals", "settings/workspace"])
        ws = ops[0]["data"]
        self.assertEqual((ws["createdBy"], ws["producers"]), ("routineos new", ["jobs-watch", "lead-signals"]))
        jw = ops[2]["data"]
        self.assertEqual(jw["values"]["markets"], ["AU", "US"])
        self.assertEqual(jw["updatedBy"], "seed")
        self.assertEqual(ops[4]["data"]["values"]["mergePolicy"], {"company": "merge", "role": "merge"})

    def test_seed_never_overwrites_settings_people_saved(self):
        store = new_store(settings={"jobs-watch": {"markets": ["NZ"]}})
        ops = [o for ph in dc.plan_seed(compiled(), self.WS, store.snapshot()) for o in ph["ops"]]
        self.assertNotIn("settings/jobs-watch", self.paths(ops))
        self.assertEqual(ops[1]["if_version"], 1)

    def test_seed_then_run_uses_seeded_settings(self):
        store = dc.FakeStore()
        for ph in dc.plan_seed(compiled(), self.WS, {}):
            store.apply(ph["ops"])
        apply_all(store, run_input("r1", [role("https://jobs.example/1", market="ZZ")]))
        self.assertEqual(data(store, "runs/r1")["settingsUsed"]["markets"], ["AU", "US"])
        self.assertEqual(data(store, "entities/role--https-jobs-example-1")["status"], "dropped")


class JoinSeedTests(unittest.TestCase):
    WS = SeedPlanTests.WS

    def with_join(self, card=None):
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import join_fixtures
        d = compiled()
        d["join"] = copy.deepcopy(card or join_fixtures.TWO_LANE_CARD)
        return d

    def ops_of(self, phases):
        return {f"{o['collection']}/{o['doc_id']}": o for ph in phases for o in ph["ops"]}

    def test_seed_writes_meta_join_with_if_version(self):
        first = self.ops_of(dc.plan_seed(self.with_join(), self.WS, {}))
        self.assertNotIn("join", first["meta/definition"]["data"])
        self.assertNotIn("if_version", first["meta/join"])
        self.assertEqual(first["meta/join"]["data"]["lanes"][0]["id"], "sender")
        again = self.ops_of(dc.plan_seed(self.with_join(), self.WS, {"meta/join": {"version": 3, "data": {}}}))
        self.assertEqual(again["meta/join"]["if_version"], 3)

    def test_seed_keeps_the_stored_link_when_none_is_given(self):
        docs = {"meta/join": {"version": 2, "data": {"open": True, "url": "https://claude.ai/code/artifact/x"}}}
        ops = self.ops_of(dc.plan_seed(self.with_join(), self.WS, docs))
        self.assertEqual(ops["meta/join"]["data"]["url"], "https://claude.ai/code/artifact/x")

    def test_seed_closes_meta_join_when_the_block_is_removed(self):
        stored = dict(self.with_join()["join"], open=True)
        ops = self.ops_of(dc.plan_seed(compiled(), self.WS, {"meta/join": {"version": 4, "data": stored}}))
        self.assertIs(ops["meta/join"]["data"]["open"], False)
        self.assertEqual(ops["meta/join"]["if_version"], 4)
        closed = dict(stored, open=False)
        ops = self.ops_of(dc.plan_seed(compiled(), self.WS, {"meta/join": {"version": 5, "data": closed}}))
        self.assertNotIn("meta/join", ops)
        self.assertNotIn("meta/join", self.ops_of(dc.plan_seed(compiled(), self.WS, {})))

    def test_seed_never_writes_meta_owner(self):
        for docs in ({}, {"meta/owner": {"version": 1, "data": {"by": "u-owner", "at": "2026-10-01T00:00:00Z"}}}):
            self.assertNotIn("meta/owner", self.ops_of(dc.plan_seed(self.with_join(), self.WS, docs)))


class WriteCliTests(unittest.TestCase):
    def test_write_emits_ordered_batches(self):
        store = new_store()
        with tempfile.TemporaryDirectory() as tmp:
            docs, run, out = (os.path.join(tmp, n) for n in ("docs.json", "run.json", "out"))
            with open(docs, "w") as fh:
                json.dump(store.snapshot(), fh)
            with open(run, "w") as fh:
                json.dump(run_input("r1", [company(f"c{i}.example") for i in range(60)]), fh)
            r = subprocess.run([sys.executable, CLI, "write", "--docs", docs, "--run", run, "--out", out],
                               capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            files = sorted(os.listdir(out))
            self.assertEqual(files, [f"batch-{n:03d}.json" for n in range(1, 6)])
            with open(os.path.join(out, files[0])) as fh:
                first = json.load(fh)
            self.assertEqual(first["phase"], "started")
            self.assertEqual(first["writes"][0]["collection"], "runs")
            for f in files:
                with open(os.path.join(out, f)) as fh:
                    self.assertLessEqual(len(json.load(fh)["writes"]), 50)

    def test_write_artifactdata_emits_ready_batch_entries(self):
        store = new_store()
        apply_all(store, run_input("r1", [company("acme.example")]))
        with tempfile.TemporaryDirectory() as tmp:
            docs, run, out = (os.path.join(tmp, n) for n in ("docs.json", "run.json", "out"))
            with open(docs, "w") as fh:
                json.dump(store.snapshot(), fh)
            with open(run, "w") as fh:
                json.dump(run_input("r2", [company("acme.example", "Acme 2")], at="2026-09-02T00:00:00Z"), fh)
            r = subprocess.run([sys.executable, CLI, "write", "--docs", docs, "--run", run, "--out", out,
                                "--artifactdata"], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            batches = sorted(f for f in os.listdir(out) if re.match(r"^batch-\d{3}\.json$", f))
            self.assertTrue(batches)
            replay = dc.FakeStore()
            replay.docs = store.snapshot()
            pinned = []
            for f in batches:
                with open(os.path.join(out, f)) as fh:
                    plain = json.load(fh)["writes"]
                with open(os.path.join(out, f[:-5] + ".artifactdata.json")) as fh:
                    entries = json.load(fh)
                self.assertEqual(len(entries), len(plain))
                ops = []
                pinned += [e for e in entries if e["collection"] == "entities"]
                for entry, op in zip(entries, plain):
                    self.assertNotIn("data", entry)
                    self.assertEqual({k: entry.get(k) for k in ("op", "collection", "doc_id", "if_version")},
                                     {k: op.get(k) for k in ("op", "collection", "doc_id", "if_version")})
                    self.assertTrue(os.path.isabs(entry["file_path"]))
                    with open(entry["file_path"]) as fh:
                        self.assertEqual(json.load(fh), op["data"])
                    ops.append(dict(op))
                replay.apply(ops)
            self.assertEqual(pinned[0]["if_version"], 1)
            self.assertEqual(data(replay, "entities/company--acme-example")["bySource"]["jobs-watch"]["name"], "Acme 2")

    def test_write_bad_input_exits_2(self):
        with tempfile.TemporaryDirectory() as tmp:
            r = subprocess.run([sys.executable, CLI, "write", "--docs", os.path.join(tmp, "nope.json"),
                                "--run", os.path.join(tmp, "nope.json"), "--out", tmp],
                               capture_output=True, text=True)
            self.assertEqual(r.returncode, 2)
            self.assertNotIn("Traceback", r.stderr)


if __name__ == "__main__":
    unittest.main()
