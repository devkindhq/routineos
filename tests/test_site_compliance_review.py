"""The site-compliance-review template: safety rules, pack contents and its scripts on replayed Worker answers."""
import json
import os
import subprocess
import sys
import tempfile
import tomllib
import unittest

from pack_fixtures import CATALOG, CLI, TEMPLATES

import desk_contract
import pack
import routineos

TID = "site-compliance-review"
FOLDER = os.path.join(TEMPLATES, TID)
LIB = os.path.join(FOLDER, "lib")
SCRIPTS = ["budget_check.py", "fetch_results.py", "apply_rules.py", "fetch_shots.py", "track.py"]
RULE_IDS = ["unsubstantiated_superlative", "unverifiable_numeric_claim", "missing_disclosure", "absolute_claim"]
SITE = "https://www.example.com"
WORKER = "https://review.example.com"
PRODUCER = TID
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
SHOT = "/shot/shots%2F" + "a" * 32 + ".png?exp=1&sig=00"


def read(name):
    with open(os.path.join(FOLDER, name), encoding="utf-8") as fh:
        return fh.read()


def toml():
    with open(os.path.join(FOLDER, "routine.toml"), "rb") as fh:
        return tomllib.load(fh)


def run(script, *args):
    return subprocess.run([sys.executable, os.path.join(LIB, script), *args], capture_output=True, text=True)


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh)


def capture(seq, path, text, ok=True, host=SITE, title="Page", rects=None, status=200, clef=None):
    row = {"seq": seq, "url": host + path, "ok": ok, "status": status, "title": title,
           "capturedAt": "2026-11-06T12:00:00.000Z", "error": "" if ok else f"page answered {status}",
           "text": text if ok else "", "rects": rects or [], "page": {"width": 1280, "height": 2400} if ok else None,
           "shot": SHOT if ok else "", "clef": clef}
    return row


def clef(scores=None, error=None, flag_at=0.7):
    """A Worker clef result as the Worker's capture holds it."""
    out = {"scores": scores or {}, "model": "@cf/cloudflare/clef-flash", "flagAt": flag_at, "asked": list(RULE_IDS),
           "inputTokens": 900, "outputTokens": 12, "imageSent": False}
    if error:
        out["error"] = error
    return out


HOME_TEXT = "Welcome. We are the best in the world at what we do."
OFFER_TEXT = "Guaranteed results in a week. Now 40% faster than before. Totally risk free."


def worker_replay(root, home_text=HOME_TEXT, offer_text=OFFER_TEXT, offer_ok=True, clefs=None, worker_clef=None):
    """Replayed Worker answers: a home page and an offer page with seeded wording, a clean page,
    a capture on another host, and a failed capture. `clefs` is {path: clef result} per capture."""
    clefs = clefs or {}
    summary = {"sitemap": {"url": SITE + "/sitemap.xml", "lastRefreshAt": "2026-11-06T00:00:00.000Z", "errors": []},
               "queue": {"pending": 3, "failed": 1}, "lastBatchAt": "2026-11-06T12:00:00.000Z"}
    if worker_clef is not None:
        summary["clef"] = worker_clef
    write_json(os.path.join(root, "summary.json"), summary)
    rects = [{"text": "Welcome. We are the best in the world at what we do.", "left": 100, "top": 480, "width": 640, "height": 48},
             {"text": "Whole page", "left": 0, "top": 0, "width": 1280, "height": 2400}]
    write_json(os.path.join(root, "results.json"), {"results": [
        capture(1, "/", home_text, rects=rects, title="Home", clef=clefs.get("/")),
        capture(2, "/offer", offer_text, ok=offer_ok, status=200 if offer_ok else 500, title="Offer",
                clef=clefs.get("/offer") if offer_ok else None),
        capture(3, "/plain", "Plain words about our service.", title="Old title"),
        capture(4, "/x", "The best in the world.", host="https://other.example.net"),
        capture(5, "/plain", "Plain words about our service.", title="Plain", clef=clefs.get("/plain")),
    ]})


class TemplateRules(unittest.TestCase):
    def test_lints_and_validates(self):
        res = subprocess.run([sys.executable, CLI, "lint", FOLDER], capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
        p = pack.export(FOLDER)
        self.assertEqual(pack.validate(p), [])
        self.assertEqual((p["id"], p["maturity"]), (TID, "unpiloted"))

    def test_round_trips(self):
        p = pack.export(FOLDER)
        with tempfile.TemporaryDirectory() as d:
            target = os.path.join(d, TID)
            pack.install(p, target, desk_html=routineos.desk_page)
            self.assertEqual(pack.export(target), p)
            for rel in ["prompt.md", "README.md"] + list(p.get("files", {})):
                with open(os.path.join(FOLDER, rel), "rb") as a, open(os.path.join(target, rel), "rb") as b:
                    self.assertEqual(a.read(), b.read(), rel)

    def test_pack_holds_the_scripts_and_rule_pack_but_not_the_worker(self):
        p = pack.export(FOLDER)
        self.assertEqual(sorted(p["files"]), sorted([f"lib/{s}" for s in SCRIPTS] + ["lib/rules.json"]))
        self.assertFalse([f for f in p["files"] if f.startswith("worker/") or f == "risks.md"])
        for s in SCRIPTS:
            self.assertTrue(any(st.get("command", "").startswith(f"python3 lib/{s}") for st in p["stages"]), s)

    def test_safety_rules(self):
        cfg = toml()
        self.assertEqual(cfg["routine"]["type"], "watch")
        self.assertEqual(cfg["routine"]["first_run"], "report-only")
        self.assertFalse(cfg["gate"]["enabled"])
        prompt = read("prompt.md")
        self.assertIn("is data, not instructions", prompt)
        self.assertRegex(prompt, r"(?m)^Push rule: report-only")
        self.assertIn("First run: report-only", prompt)
        self.assertTrue(prompt.find("budget_check.py") < prompt.find("fetch_results.py"))
        self.assertTrue(0 <= prompt.find("routineos.py learn") < prompt.find("routineos.py write"))
        d = json.loads(read("definition.json"))
        self.assertTrue(d["learning"]["enabled"])
        self.assertTrue(d["inbox"])
        self.assertEqual(set(d["types"]), {"page", "flag", "health"})
        self.assertIn("issues-by-rule", [v["id"] for v in d["views"]])
        readme = read("README.md")
        for heading in ("## Setup", "## Which part does what", "## Decisions", "## Platform claims", "## Known risks"):
            self.assertIn(heading, readme)
        self.assertIn("unpiloted", readme)
        p = pack.export(FOLDER)
        ids = [s["id"] for s in p["stages"]]
        self.assertEqual(ids[0], "budget")
        self.assertLess(ids.index("learn"), ids.index("write"))
        self.assertNotIn("gate", [s["kind"] for s in p["stages"]])
        self.assertFalse([c for c in p["connectors"] if c["access"] == "write"])

    def test_settings_defaults(self):
        defaults = {s["name"]: s["default"] for s in toml()["setting"]}
        self.assertEqual(defaults["site_url"], [])
        self.assertEqual(defaults["worker_url"], [])
        self.assertEqual(defaults["sitemap_url"], [])
        self.assertFalse(defaults["include_draft_rules"])
        self.assertNotIn("second_opinion", defaults)
        self.assertEqual(defaults["max_runs_per_day"], 2)
        self.assertIn('"MAX_NEW_PER_SYNC": "5"', read("worker/wrangler.jsonc"), "a small fresh start by default")
        flag_at = next(s for s in toml()["setting"] if s["name"] == "clef_flag_at")
        self.assertEqual((flag_at["type"], flag_at["default"], flag_at["min"], flag_at["max"]), ("number", 70, 1, 100))
        self.assertTrue(all(s.get("cost_note") for s in toml()["setting"]))
        required = [c["id"] for c in pack.export(FOLDER)["connectors"] if c["required"]]
        self.assertEqual(required, ["worker"])

    def test_rule_pack_defaults(self):
        with open(os.path.join(LIB, "rules.json"), encoding="utf-8") as fh:
            rules = {r["id"]: r for r in json.load(fh)["rules"]}
        self.assertEqual(rules["absolute_claim"]["status"], "draft")
        self.assertTrue(all(r["severity"] in ("high", "medium", "low") for r in rules.values()))
        self.assertTrue(all(r.get("question") for r in rules.values()))

    def test_in_the_catalog(self):
        with open(os.path.join(CATALOG, "index.json"), encoding="utf-8") as fh:
            entry = next(e for e in json.load(fh)["templates"] if e["id"] == TID)
        self.assertEqual(entry["maturity"], "unpiloted")


class Scripts(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = self.tmp.name
        self.worker = os.path.join(self.d, "worker")
        worker_replay(self.worker)
        write_json(self.p("snapshot.json"), {})

    def tearDown(self):
        self.tmp.cleanup()

    def p(self, name):
        return os.path.join(self.d, name)

    def load(self, name):
        with open(self.p(name), encoding="utf-8") as fh:
            return json.load(fh)

    def fetch(self, *extra, docs=None, replay=None):
        if docs is not None:
            write_json(self.p("snapshot.json"), docs)
        res = run("fetch_results.py", "--worker", WORKER, "--site", SITE, "--docs", self.p("snapshot.json"),
                  "--producer", PRODUCER, "--out", self.p("results.json"), "--replay", replay or self.worker, *extra)
        self.assertEqual(res.returncode, 0, res.stderr)
        return self.load("results.json")

    def rules(self, *extra, rules=None):
        res = run("apply_rules.py", "--results", self.p("results.json"), "--rules", rules or os.path.join(LIB, "rules.json"),
                  "--out", self.p("flags.json"), *extra)
        self.assertEqual(res.returncode, 0, res.stderr)
        return self.load("flags.json")

    def track(self, docs, cap="10", *extra):
        write_json(self.p("snapshot.json"), docs)
        res = run("track.py", "--flags", self.p("flags.json"), "--results", self.p("results.json"),
                  "--docs", self.p("snapshot.json"), "--producer", PRODUCER, "--max-inbox", cap,
                  "--out", self.p("run-part.json"), *extra)
        self.assertEqual(res.returncode, 0, res.stderr)
        return self.load("run-part.json")

    def snapshot_from(self, part):
        """Stores a run's records the way the write step would, keyed by identity."""
        docs = {}
        for r in part["records"]:
            key = r["values"]["id"]
            eid = desk_contract.entity_id(r["type"], key)
            docs[f"entities/{eid}"] = {"version": 1, "data": {"type": r["type"], "key": key,
                                                              "bySource": {PRODUCER: r["values"]}}}
        return docs

    def flag_ids(self, part):
        return {r["values"]["rule"] + "@" + r["values"]["url"].rsplit("/", 1)[-1]: r["values"]["id"]
                for r in part["records"] if r["type"] == "flag"}

    # fetch_results

    def test_fetch_keeps_only_site_captures_and_the_latest_per_url(self):
        out = self.fetch()
        self.assertTrue(out["reachable"])
        self.assertEqual([r["url"] for r in out["results"]], [SITE + "/", SITE + "/offer", SITE + "/plain"])
        self.assertEqual(out["refused"], 1)
        self.assertEqual(next(r for r in out["results"] if r["url"].endswith("/plain"))["title"], "Plain")
        self.assertTrue(out["sitemap_matches"])
        self.assertFalse(out["more"])

    def test_fetch_resumes_after_the_stored_cursor_and_pages(self):
        docs = {"entities/x": {"version": 1, "data": {"type": "page", "bySource": {PRODUCER: {"id": "page--x", "seq": 3}}}}}
        out = self.fetch(docs=docs)
        self.assertEqual([r["seq"] for r in out["results"]], [5])
        out = self.fetch("--max-pages", "2", docs={})
        self.assertEqual(len(out["results"]), 2)
        self.assertTrue(out["more"])

    def test_fetch_flags_a_different_sitemap_and_survives_an_unreachable_worker(self):
        self.assertFalse(self.fetch("--sitemap", SITE + "/other-sitemap.xml")["sitemap_matches"])
        out = self.fetch(replay=os.path.join(self.d, "missing"))
        self.assertFalse(out["reachable"])
        self.assertEqual(out["results"], [])
        self.assertTrue(out["error"])
        res = run("fetch_results.py", "--worker", "http://review.example.com", "--site", SITE, "--docs",
                  self.p("snapshot.json"), "--producer", PRODUCER, "--out", self.p("x.json"))
        self.assertEqual(res.returncode, 2)

    # apply_rules

    def test_rules_flag_the_seeded_wording_with_boxes(self):
        self.fetch()
        out = self.rules()
        found = {(f["rule"], f["url"].rsplit("/", 1)[-1] or "home") for f in out["flags"]}
        self.assertEqual(found, {("unsubstantiated_superlative", "home"), ("unverifiable_numeric_claim", "offer"),
                                 ("missing_disclosure", "offer")})
        home = next(f for f in out["flags"] if f["rule"] == "unsubstantiated_superlative")
        self.assertEqual(home["match"].lower(), "best in the world")
        self.assertEqual(len(home["box"]), 4)
        self.assertTrue(all(0 <= v <= 1 for v in home["box"]))
        self.assertLess(home["box"][3] - home["box"][1], 0.1, "the smallest matching element is used, not the page")
        self.assertEqual(home["page_id"], next(p["id"] for p in out["pages"] if p["url"] == SITE + "/"))

    def test_draft_rules_run_only_when_asked(self):
        self.fetch()
        self.assertNotIn("absolute_claim", {f["rule"] for f in self.rules()["flags"]})
        self.assertIn("absolute_claim", {f["rule"] for f in self.rules("--include-draft")["flags"]})

    def test_a_disclosure_clears_the_disclosure_rule_and_a_failed_capture_has_no_flags(self):
        worker_replay(self.worker, offer_text="Guaranteed results. Results may vary.")
        self.fetch()
        self.assertNotIn("missing_disclosure", {f["rule"] for f in self.rules()["flags"]})
        worker_replay(self.worker, offer_ok=False)
        self.fetch()
        out = self.rules()
        self.assertFalse([f for f in out["flags"] if f["url"].endswith("/offer")])

    def test_a_bad_rule_pack_stops_the_stage(self):
        self.fetch()
        for bad in ({"id": "x", "enabled": True, "severity": "high", "kind": "pattern", "label": "X", "pattern": "("},
                    {"id": "x", "enabled": True, "severity": "high", "kind": "magic", "label": "X"},
                    {"id": "x", "enabled": True, "severity": "urgent", "kind": "phrases", "label": "X", "phrases": ["a"]},
                    {"id": "x", "enabled": True, "severity": "high", "kind": "pattern", "label": "X", "pattern": "a" * 201}):
            write_json(self.p("bad.json"), {"rules": [bad]})
            res = run("apply_rules.py", "--results", self.p("results.json"), "--rules", self.p("bad.json"),
                      "--out", self.p("flags.json"))
            self.assertEqual(res.returncode, 2, bad)

    # fetch_shots

    def test_fetch_shots_saves_pngs_and_skips_anything_else(self):
        self.fetch()
        flags = self.rules()
        ids = {p["url"]: p["id"] for p in flags["pages"]}
        shots = os.path.join(self.d, "canned-shots")
        os.makedirs(shots)
        with open(os.path.join(shots, ids[SITE + "/"] + ".png"), "wb") as fh:
            fh.write(PNG)
        with open(os.path.join(shots, ids[SITE + "/offer"] + ".png"), "wb") as fh:
            fh.write(b"<html>not an image</html>")
        res = run("fetch_shots.py", "--worker", WORKER, "--flags", self.p("flags.json"), "--max", "5",
                  "--out-dir", self.p("shots"), "--out", self.p("shots.json"), "--replay", shots)
        self.assertEqual(res.returncode, 0, res.stderr)
        out = self.load("shots.json")
        self.assertEqual(list(out["shots"]), [ids[SITE + "/"]])
        self.assertEqual(len(out["skipped"]), 1)
        self.assertNotIn(ids[SITE + "/plain"], out["shots"], "an unflagged page is never downloaded")

    # budget_check

    def test_budget_counts_only_this_producers_runs_today(self):
        docs = {"runs/a": {"version": 1, "data": {"producer": PRODUCER, "startedAt": "2026-11-06T01:00:00Z"}},
                "runs/b": {"version": 1, "data": {"producer": PRODUCER, "startedAt": "2026-11-06T09:00:00Z"}},
                "runs/c": {"version": 1, "data": {"producer": PRODUCER, "startedAt": "2026-11-05T23:00:00Z"}},
                "runs/d": {"version": 1, "data": {"producer": "other", "startedAt": "2026-11-06T02:00:00Z"}}}
        write_json(self.p("snapshot.json"), docs)

        def check(max_runs):
            res = run("budget_check.py", "--docs", self.p("snapshot.json"), "--producer", PRODUCER,
                      "--max-runs", max_runs, "--today", "2026-11-06")
            return res
        out = json.loads(check("2").stdout)
        self.assertEqual((out["runs_today"], out["allowed"]), (2, False))
        self.assertTrue(json.loads(check("3").stdout)["allowed"])
        self.assertEqual(check("0").returncode, 2)

    # track

    def test_track_first_run_records_flags_capture_notes_and_health(self):
        self.fetch()
        self.rules()
        first = self.track({})
        types = {r["type"] for r in first["records"]}
        self.assertEqual(types, {"page", "flag", "health"})
        self.assertEqual({r["values"]["state"] for r in first["records"] if r["type"] in ("page", "flag")}, {"new"})
        flag_titles = [m["title"] for m in first["inbox"] if m["refs"][0]["type"] == "flag"]
        self.assertTrue(flag_titles[0].startswith("High: "), flag_titles)
        self.assertTrue(all(len(m["title"]) <= 100 for m in first["inbox"]))
        home = next(r for r in first["records"] if r["type"] == "page" and r["values"]["url"] == SITE + "/")
        self.assertEqual(home["values"]["top_severity"], "medium")
        note = home["capture"]["notes"][0]
        self.assertEqual(note["kind"], "warn")
        self.assertEqual(len(note["box"]), 4)
        self.assertNotIn("image", home["capture"])
        health = next(r["values"] for r in first["records"] if r["type"] == "health")
        self.assertEqual((health["id"], health["reachable"], health["queue_failed"]), ("worker", True, 1))
        self.assertEqual(health["refused"], 1)
        self.assertEqual(first["inbox"][0]["title"], "Captures refused")

    def test_track_honours_decisions_and_resolves_only_loaded_pages(self):
        self.fetch()
        self.rules()
        first = self.track({})
        ids = self.flag_ids(first)
        docs = self.snapshot_from(first)

        def eid(flag_id):
            return desk_contract.entity_id("flag", flag_id)
        docs[f"decisions/{eid(ids['unsubstantiated_superlative@'])}"] = {"version": 1, "data": {"decision": "keep"}}
        docs[f"decisions/{eid(ids['unverifiable_numeric_claim@offer'])}"] = {
            "version": 1, "data": {"decision": "drop", "reason": "Accepted: the figure is sourced on the page"}}
        docs[f"decisions/{eid(ids['missing_disclosure@offer'])}"] = {
            "version": 1, "data": {"decision": "drop", "reason": "wrong match"}}

        # Second run: the home wording is fixed, the offer page failed to load.
        worker_replay(self.worker, home_text="Welcome. We do good work.", offer_ok=False)
        self.fetch(docs={})
        self.rules()
        second = self.track(docs)
        by_id = {r["values"]["id"]: r["values"] for r in second["records"] if r["type"] == "flag"}
        self.assertEqual(by_id[ids["unsubstantiated_superlative@"]]["state"], "resolved")
        self.assertNotIn(ids["missing_disclosure@offer"], by_id, "a failed capture never resolves a flag")
        titles = [m["title"] for m in second["inbox"]]
        self.assertIn("Fixed: Unsubstantiated superlative", titles)
        pages = {r["values"]["url"]: r["values"]["state"] for r in second["records"] if r["type"] == "page"}
        self.assertEqual(pages[SITE + "/"], "changed")
        self.assertEqual(pages[SITE + "/plain"], "unchanged")

        # Third run: the offer page loads again with the same wording; dropped flags never reach the Inbox.
        docs.update(self.snapshot_from(second))
        worker_replay(self.worker, home_text="Welcome. We do good work.")
        self.fetch(docs={})
        self.rules()
        third = self.track(docs)
        self.assertEqual(third["summary"]["decisions"]["accepted"], 1)
        self.assertEqual(third["summary"]["decisions"]["dismissed"], 1)
        self.assertFalse([m for m in third["inbox"] if m["refs"][0]["type"] == "flag"])

    def test_track_caps_the_inbox_and_puts_worker_alerts_first(self):
        self.fetch(replay=os.path.join(self.d, "missing"))
        self.rules()
        part = self.track({})
        self.assertEqual(part["inbox"][0]["title"], "Review Worker not reachable")
        self.fetch()
        self.rules()
        part = self.track({}, "2")
        self.assertEqual(len(part["inbox"]), 2)
        self.assertGreater(part["summary"]["inbox_left_out"], 0)
        res = run("track.py", "--flags", self.p("flags.json"), "--results", self.p("results.json"), "--docs",
                  self.p("snapshot.json"), "--producer", PRODUCER, "--max-inbox", "99", "--out", self.p("x.json"))
        self.assertEqual(res.returncode, 2)

    def test_track_attaches_only_desk_asset_images(self):
        self.fetch()
        flags = self.rules()
        ids = {p["url"]: p["id"] for p in flags["pages"]}
        write_json(self.p("images.json"), {ids[SITE + "/"]: "/assets/" + "b" * 32 + ".png",
                                           ids[SITE + "/offer"]: "https://other.example.net/x.png"})
        part = self.track({}, "10", "--images", self.p("images.json"))
        pages = {r["values"]["url"]: r for r in part["records"] if r["type"] == "page"}
        self.assertEqual(pages[SITE + "/"]["capture"]["image"], "/_blob/" + "b" * 32,
                         "an uploaded asset url is kept in the /_blob/<id> form that loads for viewers")
        self.assertNotIn("image", pages[SITE + "/offer"]["capture"])

    def test_track_accepts_a_blob_url_as_is(self):
        self.fetch()
        flags = self.rules()
        ids = {p["url"]: p["id"] for p in flags["pages"]}
        write_json(self.p("images.json"), {ids[SITE + "/"]: "/_blob/" + "c" * 32})
        part = self.track({}, "10", "--images", self.p("images.json"))
        pages = {r["values"]["url"]: r for r in part["records"] if r["type"] == "page"}
        self.assertEqual(pages[SITE + "/"]["capture"]["image"], "/_blob/" + "c" * 32)

    def test_track_keeps_the_previous_image_on_a_recapture_without_one(self):
        self.fetch()
        flags = self.rules()
        ids = {p["url"]: p["id"] for p in flags["pages"]}
        write_json(self.p("images.json"), {ids[SITE + "/"]: "/_blob/" + "d" * 32})
        first = self.track({}, "10", "--images", self.p("images.json"))
        docs = self.snapshot_from(first)
        for r in first["records"]:
            if r["type"] == "page" and "capture" in r:
                docs["entities/" + desk_contract.entity_id("page", r["values"]["id"])]["capture"] = r["capture"]
        again = self.track(docs)
        pages = {r["values"]["url"]: r for r in again["records"] if r["type"] == "page"}
        self.assertEqual(pages[SITE + "/"]["capture"]["image"], "/_blob/" + "d" * 32)
        self.assertNotIn("image", pages[SITE + "/offer"]["capture"], "a page that never had an image stays without one")
        write_json(self.p("images.json"), {ids[SITE + "/"]: "/_blob/" + "e" * 32})
        newer = self.track(docs, "10", "--images", self.p("images.json"))
        pages = {r["values"]["url"]: r for r in newer["records"] if r["type"] == "page"}
        self.assertEqual(pages[SITE + "/"]["capture"]["image"], "/_blob/" + "e" * 32, "a new image replaces the old one")

    def test_boxes_need_a_screenshot_that_is_a_whole_multiple_of_the_viewport(self):
        def home_flag(width):
            res = self.fetch()
            for row in res["results"]:
                if row["page"]:
                    row["page"] = {"width": width, "height": 2400 * width // 1280}
            write_json(self.p("results.json"), res)
            out = self.rules()
            return next(f for f in out["flags"] if f["rule"] == "unsubstantiated_superlative")
        self.assertEqual(len(home_flag(1280)["box"]), 4)
        self.assertNotIn("box", home_flag(1303), "a width widened by overflow gets no box")
        self.assertNotIn("box", home_flag(1900))
        doubled = home_flag(2560)["box"]
        self.assertEqual(doubled, [0.0781, 0.2, 0.5, 0.02], "a whole multiple scales the CSS px rects")

    def test_fetch_pushes_the_flag_line_only_when_asked_and_never_fails_the_run(self):
        self.assertEqual(self.fetch()["config_push"], {"sent": False})
        self.assertEqual(self.fetch("--clef-flag-at", "55")["config_push"], {"sent": True, "value": 0.55, "ok": True})
        bad = self.fetch("--clef-flag-at", "0")
        self.assertEqual(bad["config_push"]["sent"], False)
        self.assertTrue(bad["reachable"])
        self.assertEqual(self.fetch("--clef-flag-at", "101")["config_push"]["sent"], False)
        down = run("fetch_results.py", "--worker", "https://127.0.0.1:1", "--site", SITE, "--docs", self.p("snapshot.json"),
                   "--producer", PRODUCER, "--out", self.p("down.json"), "--clef-flag-at", "70")
        self.assertEqual(down.returncode, 0, down.stderr)
        res = self.load("down.json")
        self.assertFalse(res["reachable"])
        self.assertEqual(res["config_push"]["ok"], False)

    # clef, the main verdict model

    OFFER_CLEF = {"unverifiable_numeric_claim": 0.91, "missing_disclosure": 0.2,
                  "unsubstantiated_superlative": 0.88, "absolute_claim": 0.3}

    def clef_run(self, clefs, *extra, worker_clef=None):
        worker_replay(self.worker, clefs=clefs, worker_clef=worker_clef)
        self.fetch(docs={})
        return self.rules(*extra)

    def test_fetch_keeps_a_clean_clef_result_only(self):
        dirty = dict(clef({"missing_disclosure": 0.9, "Bad Id": 0.5, "unverifiable_numeric_claim": 1.4}),
                     error="x" * 500, inputTokens="many")
        worker_replay(self.worker, clefs={"/offer": dirty, "/": "not an object"})
        out = {r["url"]: r for r in self.fetch()["results"]}
        offer = out[SITE + "/offer"]["clef"]
        self.assertEqual(offer["scores"], {"missing_disclosure": 0.9})
        self.assertEqual((len(offer["error"]), offer["inputTokens"], offer["flagAt"]), (300, None, 0.7))
        self.assertIsNone(out[SITE + "/"]["clef"])
        self.assertIsNone(out[SITE + "/plain"]["clef"])

    def test_clef_merge_follows_the_verdict_table(self):
        out = self.clef_run({"/offer": clef(self.OFFER_CLEF)})
        offer = {f["rule"]: f for f in out["flags"] if f["url"] == SITE + "/offer"}
        self.assertEqual(set(offer), {"unverifiable_numeric_claim", "missing_disclosure", "unsubstantiated_superlative"},
                         "a hidden draft rule never becomes a flag")
        both, review, only = (offer[r] for r in ("unverifiable_numeric_claim", "missing_disclosure", "unsubstantiated_superlative"))
        self.assertEqual((both["origin"], both["clef_score"], both["needs_review"]), ("both", 0.91, False))
        self.assertEqual((review["origin"], review["clef_score"], review["needs_review"]), ("regex", 0.2, True))
        self.assertEqual((only["origin"], only["match"], only["count"], only["needs_review"]), ("clef", "page-level", 0, False))
        self.assertIn("no single phrase to quote", only["context"])
        self.assertNotIn("box", only)
        page = next(p for p in out["pages"] if p["url"] == SITE + "/offer")
        self.assertEqual(page["flag_count"], 3)
        card = page["clef_card"]
        self.assertEqual(card["state"], "ok")
        rows = {r["rule"]: r for r in card["rows"]}
        self.assertEqual({k: r["outcome"] for k, r in rows.items()}, {
            "unverifiable_numeric_claim": "agree", "missing_disclosure": "needs-review",
            "unsubstantiated_superlative": "clef-flag", "absolute_claim": "needs-review"})
        self.assertEqual((rows["absolute_claim"]["hidden"], rows["absolute_claim"]["fired"]), (True, True))
        self.assertEqual(rows["unverifiable_numeric_claim"]["score"], 91)
        self.assertEqual([r["score"] for r in card["rows"]], sorted((r["score"] for r in card["rows"]), reverse=True))
        self.assertEqual([(d["rule"], d["score"]) for d in out["clefFlagList"]], [("unsubstantiated_superlative", 88)])
        self.assertEqual({(d["rule"], d["hidden"]) for d in out["needsReviewList"]},
                         {("missing_disclosure", False), ("absolute_claim", True)})
        s = out["summary"]["clef"]
        self.assertEqual((s["pages"], s["off"], s["agree"], s["needsReview"], s["clefFlag"], s["clear"]), (1, 2, 1, 2, 1, 0))
        self.assertEqual((s["minScore"], s["maxScore"], s["inputTokens"]), (20, 91, 900))

    def test_clef_off_or_error_leaves_the_rule_flags_unchanged(self):
        plain = {(f["rule"], f["url"]) for f in self.clef_run({})["flags"]}
        out = self.clef_run({"/": clef(error="model call failed"), "/offer": clef({"absolute_claim": 0.99}, error="boom")})
        self.assertEqual({(f["rule"], f["url"]) for f in out["flags"]}, plain)
        self.assertTrue(all(f["origin"] == "regex" and f["clef_score"] is None and not f["needs_review"] for f in out["flags"]))
        cards = {p["url"]: p["clef_card"] for p in out["pages"]}
        self.assertEqual(cards[SITE + "/"]["state"], "error")
        self.assertEqual(cards[SITE + "/"]["error"], "model call failed")
        self.assertEqual(cards[SITE + "/"]["rows"], [])
        self.assertEqual(cards[SITE + "/plain"], {"state": "off", "rows": []})
        self.assertEqual((out["summary"]["clef"]["errors"], out["summary"]["clef"]["off"]), (2, 1))
        self.assertEqual((out["clefFlagList"], out["needsReviewList"]), ([], []))

    def test_clef_hidden_rows_unscored_and_card_cap(self):
        out = self.clef_run({"/": clef({"missing_disclosure": 0.1}), "/plain": clef({"absolute_claim": 0.99})})
        cards = {p["url"]: p["clef_card"] for p in out["pages"]}
        self.assertEqual(cards[SITE + "/"]["unscored"], ["unsubstantiated_superlative"], "a fired rule clef did not score")
        self.assertEqual(next(f for f in out["flags"] if f["url"] == SITE + "/")["origin"], "regex")
        row = cards[SITE + "/plain"]["rows"][0]
        self.assertEqual((row["rule"], row["outcome"], row["hidden"], row["fired"]), ("absolute_claim", "clef-flag", True, False))
        self.assertFalse([f for f in out["flags"] if f["url"] == SITE + "/plain"])
        self.assertEqual(out["clefFlagList"], [], "a hidden rule's clef flag is not listed as a flag")
        shown = {f["rule"] for f in self.clef_run({"/plain": clef({"absolute_claim": 0.99})}, "--include-draft")["flags"]
                 if f["url"] == SITE + "/plain"}
        self.assertEqual(shown, {"absolute_claim"})

        many = [{"id": f"rule_{i:02d}", "enabled": True, "severity": "low", "kind": "phrases", "label": f"Rule {i}",
                 "phrases": [f"zzword{i}"], "question": "Q?"} for i in range(25)]
        write_json(self.p("many.json"), {"rules": many})
        scores = {f"rule_{i:02d}": (0.95 if i == 24 else round(0.01 * i, 2)) for i in range(25)}
        worker_replay(self.worker, clefs={"/plain": clef(scores)})
        self.fetch(docs={})
        card = next(p for p in self.rules(rules=self.p("many.json"))["pages"] if p["url"] == SITE + "/plain")["clef_card"]
        self.assertEqual((len(card["rows"]), card["omitted"]), (20, 5))
        self.assertEqual(card["rows"][0]["rule"], "rule_24", "flag rows are kept first")

    def test_track_records_clef_verdicts_notes_and_the_card(self):
        self.clef_run({"/offer": clef(self.OFFER_CLEF)})
        part = self.track({})
        flags = {r["values"]["rule"]: r["values"] for r in part["records"]
                 if r["type"] == "flag" and r["values"]["url"] == SITE + "/offer"}
        self.assertEqual({k: (v["origin"], v["clef_score"], v["needs_review"]) for k, v in flags.items()}, {
            "unverifiable_numeric_claim": ("both", 91, False), "missing_disclosure": ("regex", 20, True),
            "unsubstantiated_superlative": ("clef", 88, False)})
        self.assertEqual(flags["unsubstantiated_superlative"]["count"], 0)
        self.assertFalse({"score", "outcome"} & set(flags["missing_disclosure"]))
        page = next(r for r in part["records"] if r["type"] == "page" and r["values"]["url"] == SITE + "/offer")
        self.assertEqual(page["values"]["clef_state"], "ok")
        self.assertEqual(page["values"]["clef_card"]["rows"][0]["rule"], "unverifiable_numeric_claim")
        self.assertNotIn("second_opinion_only", page["values"])
        notes = {n["id"]: n for n in page["capture"]["notes"]}
        only = notes[flags["unsubstantiated_superlative"]["id"]]
        self.assertNotIn("box", only)
        self.assertIn("Clef", only["title"])
        whys = {m["refs"][0]["key"]: m["why"] for m in part["inbox"] if m["refs"][0]["type"] == "flag"}
        self.assertIn("needs review", whys[flags["missing_disclosure"]["id"]])
        self.assertIn("Clef", whys[flags["unsubstantiated_superlative"]["id"]])
        s = part["summary"]
        self.assertEqual([d["rule"] for d in s["clefFlagList"]], ["unsubstantiated_superlative"])
        self.assertEqual({d["rule"] for d in s["needsReviewList"]}, {"missing_disclosure", "absolute_claim"})
        self.assertEqual(s["clef"]["clefFlag"], 1)
        plain = next(r for r in part["records"] if r["type"] == "page" and r["values"]["url"] == SITE + "/plain")
        self.assertEqual(plain["values"]["clef_state"], "off")

    def test_track_resolves_a_clef_flag_only_when_clef_scored_the_page(self):
        self.clef_run({"/offer": clef(self.OFFER_CLEF)})
        first = self.track({})
        ids = self.flag_ids(first)
        docs = self.snapshot_from(first)
        only, both = ids["unsubstantiated_superlative@offer"], ids["unverifiable_numeric_claim@offer"]

        def states(part):
            return {r["values"]["id"]: r["values"]["state"] for r in part["records"] if r["type"] == "flag"}
        # Clef failed on the offer page and the numeric wording is gone: neither clef-backed flag resolves.
        worker_replay(self.worker, offer_text="Guaranteed results in a week. Totally risk free.",
                      clefs={"/offer": clef(error="timeout")})
        self.fetch(docs={})
        self.rules()
        second = self.track(docs)
        self.assertNotIn(only, states(second))
        self.assertNotIn(both, states(second))
        self.assertEqual(states(second)[ids["missing_disclosure@offer"]], "open")
        # Clef scores the page again and no longer flags either rule: both resolve.
        worker_replay(self.worker, offer_text="Guaranteed results in a week. Totally risk free.",
                      clefs={"/offer": clef({"unsubstantiated_superlative": 0.1, "unverifiable_numeric_claim": 0.05})})
        self.fetch(docs={})
        self.rules()
        third = self.track(docs)
        self.assertEqual((states(third)[only], states(third)[both]), ("resolved", "resolved"))

    def test_track_health_reports_clef_and_alerts_on_rule_drift_and_errors(self):
        worker_clef = {"on": True, "model": "@cf/cloudflare/clef-flash", "flagAt": 0.7, "image": False,
                       "rules": ["unsubstantiated_superlative", "retired_rule"], "calls": 40, "errors": 2,
                       "inputTokens": 36000, "outputTokens": 480}
        self.clef_run({"/": clef(error="model call failed")}, worker_clef=worker_clef)
        part = self.track({})
        hv = next(r["values"] for r in part["records"] if r["type"] == "health")
        self.assertEqual((hv["clef_on"], hv["clef_model"], hv["clef_calls"], hv["clef_errors"]),
                         (True, "@cf/cloudflare/clef-flash", 40, 2))
        self.assertEqual(hv["clef_rules_match"], False)
        alerts = {m["title"]: m["why"] for m in part["inbox"] if m["refs"][0]["type"] == "health"}
        self.assertIn("Worker asks Clef different rules", alerts)
        self.assertIn("retired_rule", alerts["Worker asks Clef different rules"])
        self.assertIn("Clef scoring failed on 1 page", alerts)
        worker_clef["rules"] = list(RULE_IDS)
        self.clef_run({}, worker_clef=worker_clef)
        part = self.track({})
        self.assertTrue(next(r["values"] for r in part["records"] if r["type"] == "health")["clef_rules_match"])
        self.assertFalse([m for m in part["inbox"] if "Clef" in m["title"]])

if __name__ == "__main__":
    unittest.main()
