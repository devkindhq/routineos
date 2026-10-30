#!/usr/bin/env python3
"""Synthetic Desk seed for the Jobs watch demo workspace. Standard library only.

Every row comes from random.Random(2026) and goes through the reference writer (plan_run) against a
FakeStore, so the batch files are exactly what a real publish-then-seed would apply. Every name is
invented and every domain ends in .example.

    generate.py --out <dir> [--entities N] [--snapshot templates/jobs-watch/demo/desk-demo.json]
"""
import argparse
import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.dirname(HERE)
ROOT = os.path.dirname(os.path.dirname(TEMPLATE))
sys.path.insert(0, os.path.join(ROOT, "skills", "routineos", "scripts"))
import desk_contract  # noqa: E402
import routineos  # noqa: E402

PRODUCER_DIRS = [TEMPLATE, os.path.join(HERE, "producers", "content-radar"), os.path.join(HERE, "producers", "lead-signals")]
SEED_AT = "2026-09-01T09:00:00Z"
DEFAULT_SNAPSHOT = os.path.join(HERE, "desk-demo.json")
TARGET_TOTAL = 970  # 200 companies, 400 roles, 40 creators, 300 videos, 30 tenders

STEMS_A = ["Ar", "Bel", "Cor", "Dal", "Ev", "Fen", "Gal", "Hal", "Ith", "Jor", "Kel", "Lor", "Mar",
           "Nor", "Or", "Pel", "Quin", "Ros", "Sel", "Tor", "Ul", "Val", "Wen", "Yor", "Zel"]
STEMS_B = ["bry", "dane", "fax", "holt", "mere", "nix", "quay", "rook", "stead", "tine", "vale", "wick"]
COMPANY_SUFFIX = ["Goods", "Supply", "Living", "Studio", "Works", "Home", "Wares", "Outfitters"]
CREATOR_SUFFIX = ["Builds", "Codes", "Talks", "Ships", "Labs", "Daily"]
INDUSTRIES = ["apparel", "furniture", "beauty", "outdoor", "food and drink", "electronics", "pet care", "homewares"]
MARKETS = ["AU", "US", "CA", "NZ", "PH"]
OFF_MARKETS = ["GB", "DE"]
KEYWORD_TITLES = ["Shopify developer", "Shopify Plus engineer", "Headless frontend engineer", "Headless commerce architect",
                  "Commerce platform engineer", "Commerce operations lead", "AI automation engineer", "AI automation specialist"]
OFF_TITLES = ["Office coordinator", "Warehouse supervisor", "Payroll officer", "Store manager"]
SENIORITY = ["junior", "mid", "senior", "lead"]
AREAS = {"Shopify developer": "theme and app work on Shopify", "Plus engineer": "the Shopify Plus storefront and checkout",
         "frontend engineer": "the headless storefront front end", "commerce architect": "the headless commerce architecture",
         "platform engineer": "the commerce platform and its integrations", "operations lead": "commerce operations and tooling",
         "automation engineer": "AI automation for order and support workflows",
         "automation specialist": "AI automation across store operations"}
CITIES = {"AU": ["Melbourne", "Sydney", "Brisbane"], "US": ["Austin", "Denver", "Chicago"], "CA": ["Toronto", "Vancouver"],
          "NZ": ["Auckland", "Wellington"], "PH": ["Manila", "Cebu"], "GB": ["Leeds", "Bristol"], "DE": ["Berlin", "Hamburg"]}
TOPICS = ["commerce", "automation", "headless"]
OFF_TOPICS = ["gaming", "travel"]
VIDEO_TITLES = {"commerce": ["Checkout teardown", "Cart flows that convert", "Subscriptions without the mess"],
                "automation": ["Order ops on autopilot", "Inventory alerts in an afternoon", "Support triage with agents"],
                "headless": ["Headless storefront in a weekend", "Caching a headless catalogue", "Search for headless stores"],
                "gaming": ["Speedrun review", "Controller tier list"], "travel": ["Carry-on only", "Night trains ranked"]}


def names(rng, n, suffixes):
    pool = sorted({a + b + " " + s for a in STEMS_A for b in STEMS_B for s in suffixes})
    rng.shuffle(pool)
    return [pool[i] if i < len(pool) else f"{pool[i % len(pool)]} {i // len(pool) + 1}" for i in range(n)]


def slug(text):
    return "-".join(text.lower().split())


def day(date, hour=22):
    return f"{date}T{hour:02d}:00:00Z"


class Demo:
    def __init__(self, scale):
        self.rng = random.Random(2026)
        self.n = lambda count: max(1, round(count * scale))
        self.store = desk_contract.FakeStore()
        self.phases = []
        self.defn = {}
        self.role_seq = 0
        self.video_seq = 0

    def apply(self, phases, guarded=True):
        for ph in phases:
            if guarded:
                desk_contract.guard(ph["ops"])
            if ph["ops"]:
                self.store.apply(ph["ops"])
        self.phases += phases

    def run(self, inp):
        self.apply(desk_contract.plan_run(self.defn, self.store.snapshot(), inp))

    def person(self, name, docs):
        """A human step (the Desk writing as a person): set each path, pinned to its current version."""
        ops = []
        for path, data in docs:
            cur = self.store.get(path)
            coll, _, doc_id = path.rpartition("/")
            op = {"op": "set", "collection": coll, "doc_id": doc_id, "data": data}
            if isinstance(cur, dict):
                op["if_version"] = cur["version"]
            ops.append(op)
        self.apply([{"name": name, "ops": ops}], guarded=False)

    # ---------- records ----------

    def companies(self, count):
        rng = self.rng
        out = []
        for name in names(rng, count, COMPANY_SUFFIX):
            domain = slug(name) + ".example"
            out.append({"type": "company", "key": domain, "values": {
                "name": name, "domain": domain, "industry": rng.choice(INDUSTRIES),
                "size": rng.choice([8, 15, 30, 60, 120, 250, 600]), "country": rng.choice(MARKETS)}})
        return out

    def role(self, company, date, drop=None):
        """drop: None for a role the default settings keep, or 'market' / 'keyword' to have it dropped."""
        rng = self.rng
        self.role_seq += 1
        market = rng.choice(OFF_MARKETS) if drop == "market" else rng.choice(MARKETS)
        title = rng.choice(OFF_TITLES) if drop == "keyword" else rng.choice(KEYWORD_TITLES)
        seniority = rng.choice(SENIORITY)
        if seniority in ("senior", "lead") and drop != "keyword" and not title.endswith(" lead"):
            head = title if title.split()[0] in ("Shopify", "AI") else title[0].lower() + title[1:]
            title = seniority.capitalize() + " " + head
        c = company["values"]
        values = {
            "title": title, "company": c["name"], "company_domain": c["domain"], "market": market,
            "location": rng.choice(CITIES[market]), "remote": rng.random() < 0.35,
            "salary_max": rng.choice([90000, 110000, 130000, 150000, 175000, 200000]),
            "posted": f"{date[:8]}{max(1, int(date[8:10]) - rng.randint(0, 6)):02d}",
            "url": f"https://jobs.example/{market.lower()}/{self.role_seq:05d}", "seniority": seniority,
        }
        if drop is None:
            # The routine opens the pages of roles it keeps; a summary states only what that page said.
            values["summary"] = (f"Owns {AREAS[title.split()[-2] + ' ' + title.split()[-1]]} for {c['name']}, "
                                 f"a {c['industry']} brand. The posting lists the role as {seniority} level, "
                                 + ("remote." if values["remote"] else f"based in {values['location']}."))
        return {"type": "role", "values": values, "links": [{"type": "company", "key": c["domain"]}]}

    def roles(self, companies, count, date):
        out = []
        for i in range(count):
            r = self.rng.random()
            drop = "market" if r < 0.08 else "keyword" if r < 0.14 else None
            out.append(self.role(companies[i % len(companies)], date, drop))
        return out

    def videos(self, creators, count, date):
        rng = self.rng
        out = []
        for i in range(count):
            self.video_seq += 1
            topic = rng.choice(OFF_TOPICS) if rng.random() < 0.1 else rng.choice(TOPICS)
            creator = creators[i % len(creators)]["values"]["name"]
            out.append({"type": "video", "values": {
                "title": rng.choice(VIDEO_TITLES[topic]), "creator": creator, "topic": topic,
                "views": rng.randint(800, 90000), "published": date[:10], "url": f"https://video.example/watch/{self.video_seq:05d}",
            }, "links": [{"type": "creator", "key": creator}]})
        return out

    def creators(self, count):
        rng = self.rng
        return [{"type": "creator", "key": name, "values": {
            "name": name, "channel": "https://video.example/@" + slug(name), "followers": rng.randint(2000, 400000),
            "topic": rng.choice(TOPICS)}} for name in names(rng, count, CREATOR_SUFFIX)]

    def tenders(self, companies, count, date):
        rng = self.rng
        out = []
        for i in range(count):
            c = companies[i % len(companies)]["values"]
            region = "US" if rng.random() < 0.1 else rng.choice(["AU", "NZ"])
            out.append({"type": "tender", "values": {
                "title": rng.choice(["Online store rebuild", "Order management upgrade", "Customer portal", "Catalogue migration"]),
                "buyer": c["name"], "buyer_domain": c["domain"], "region": region,
                "value": rng.choice([60000, 85000, 120000, 240000, 400000]), "closes": f"2026-11-{rng.randint(3, 27):02d}",
                "url": f"https://tenders.example/notice/{i + 1:04d}",
            }, "links": [{"type": "company", "key": c["domain"]}]})
        return out


def kept(rec, excluded=()):
    v = rec["values"]
    title = v["title"].lower()
    return (v["market"] in MARKETS and v["company_domain"] not in excluded
            and any(k.lower() in title for k in ("shopify", "headless", "commerce", "ai automation")))


def ref(rec):
    if rec["type"] == "role":
        return {"type": "role", "key": rec["values"]["url"]}
    return {"type": rec["type"], "key": rec["key"]}


def build(scale):
    d = Demo(scale)
    n = d.n
    d.defn, seed = routineos.build_seed(PRODUCER_DIRS, SEED_AT, name="Jobs watch demo")
    d.apply(seed, guarded=False)

    pool = d.companies(n(200))
    jw_a, jw_b, jw_c = pool[:n(110)], pool[n(90):n(150)], pool[n(140):n(185)]
    ls_companies = pool[n(170):]

    # Run 1: jobs-watch, first run on default settings.
    roles_1 = d.roles(jw_a, n(170), "2026-09-03")
    d.run({"runId": "jobs-watch-20260903", "producer": "jobs-watch", "startedAt": day("2026-09-03"),
           "endedAt": "2026-09-03T22:14:00Z", "status": "ok", "claimed": 3, "parsed": 3, "records": jw_a + roles_1})

    # Run 2: content-radar.
    creators = d.creators(n(40))
    videos_1 = d.videos(creators, n(170), "2026-09-10")
    d.run({"runId": "content-radar-20260910", "producer": "content-radar", "startedAt": day("2026-09-10", 21),
           "endedAt": "2026-09-10T21:09:00Z", "status": "ok", "claimed": 4, "parsed": 4, "records": creators + videos_1})

    # Run 3: lead-signals; its first companies overlap the jobs-watch pool, so they merge by domain.
    tenders = d.tenders(ls_companies, n(30), "2026-09-24")
    d.run({"runId": "lead-signals-20260924", "producer": "lead-signals", "startedAt": day("2026-09-24", 20),
           "endedAt": "2026-09-24T20:06:00Z", "status": "ok", "claimed": 2, "parsed": 2, "records": ls_companies + tenders})

    # Run 4: jobs-watch proposes two views and a column, and asks to add GB to markets.
    roles_4 = d.roles(jw_b, n(140), "2026-10-08")
    reseen = [dict(r, values=dict(r["values"], salary_max=r["values"]["salary_max"] + (5000 if i % 2 else 0)))
              for i, r in enumerate(roles_1[:n(20)])]
    for r in roles_4 + reseen:
        r["agentFields"] = {"fit-score": d.rng.randint(40, 98)}
    gb = sum(1 for r in roles_1 + roles_4 if r["values"]["market"] == "GB")
    match_4 = next(r for r in roles_4 if kept(r) and r["agentFields"]["fit-score"] >= 80)
    jw_settings = next(p for p in d.defn["producers"] if p["id"] == "jobs-watch")["settings"]
    markets = list(next(s for s in jw_settings if s["name"] == "markets")["default"])
    d.run({"runId": "jobs-watch-20261008", "producer": "jobs-watch", "startedAt": day("2026-10-08"),
           "endedAt": "2026-10-08T22:17:00Z", "status": "ok", "claimed": 3, "parsed": 3, "records": jw_b + roles_4 + reseen,
           "views": [
               {"id": "senior-au-roles", "type": "role", "name": "Senior roles in AU",
                "filters": {"status": "active", "fields": {"market": "AU", "seniority": "senior"}},
                "sort": {"field": "posted", "dir": "desc"}, "columns": ["title", "company", "salary_max"]},
               {"id": "remote-roles-this-month", "type": "role", "name": "Remote roles this month",
                "filters": {"status": "active", "fields": {"remote": "true"}}, "window": "month",
                "sort": {"field": "posted", "dir": "desc"}, "columns": ["title", "company", "market"]},
           ],
           "columns": [{"id": "fit-score", "type": "role", "name": "Fit score", "field": "fit-score", "fieldType": "number"}],
           "inbox": [
               {"kind": "match", "title": match_4["values"]["title"] + " at " + match_4["values"]["company"],
                "why": "Fit score " + str(match_4["agentFields"]["fit-score"]) + ", posted " + match_4["values"]["posted"] + ".",
                "refs": [ref(match_4), match_4["links"][0]]},
               {"kind": "proposal", "title": "Add GB to markets",
                "why": f"{gb} roles in GB were dropped by markets in this run and the last.",
                "proposal": {"setting": "markets", "from": markets, "to": markets + ["GB"]}},
           ]})

    # Run 5: content-radar again; creators re-seen with new follower counts.
    videos_2 = d.videos(creators, n(130), "2026-10-15")
    creators_2 = [dict(c, values=dict(c["values"], followers=c["values"]["followers"] + d.rng.randint(50, 4000)))
                  for c in creators[:n(30)]]
    d.run({"runId": "content-radar-20261015", "producer": "content-radar", "startedAt": day("2026-10-15", 21),
           "endedAt": "2026-10-15T21:11:00Z", "status": "ok", "claimed": 4, "parsed": 4,
           "records": creators_2 + videos_2 + videos_1[:n(15)]})

    # Human step: a person edits jobs-watch settings on the Desk.
    excluded = [c["key"] for c in jw_c[:2]]
    current = d.store.get("settings/jobs-watch")
    assert isinstance(current, dict), current
    values = dict(current["data"]["values"], excluded_companies=excluded,
                  lookback_days=10, max_inbox_per_run=3)
    d.person("person: settings", [("settings/jobs-watch", {"values": values, "updatedAt": "2026-10-20T03:12:00Z",
                                                            "updatedBy": "demo-person"})])
    # The Settings page records each save it makes (ledger ruling 16).
    changed = ("excluded_companies", "lookback_days", "max_inbox_per_run")
    d.person("person: settings history", [("settingsHistory/jobs-watch--20261020031200000", {
        "producer": "jobs-watch", "before": {k: current["data"]["values"].get(k) for k in changed},
        "after": {k: values[k] for k in changed}, "at": "2026-10-20T03:12:00.000Z", "by": "demo-person"})])

    # Human step: a person keeps a dropped role that run 6 sees again, so run 6 applies the keep.
    def status(rec):
        doc = d.store.get("entities/" + desk_contract.entity_id("role", rec["values"]["url"]))
        return doc["data"]["status"] if isinstance(doc, dict) else None
    reseen_dropped = next((r for r in roles_4[:n(10)] if status(r) == "dropped"), None)
    if reseen_dropped:
        rid = desk_contract.entity_id("role", reseen_dropped["values"]["url"])
        d.person("person: keep", [("decisions/" + rid, {"decision": "keep", "at": "2026-10-21T02:40:00Z", "by": "demo-person"})])

    # Run 6: jobs-watch, partial (one of three job boards failed); the cap holds back three matches.
    roles_6 = d.roles(jw_c, n(90), "2026-10-27") + roles_4[:n(10)]
    active = [r for r in roles_6 if kept(r, excluded)]
    gated, alerted = active[0], active[1]
    posted = sum(1 for r in roles_6 if r["values"]["company_domain"] == alerted["values"]["company_domain"])
    gate_id = "jobs-watch-20261027--g1"
    inbox_6 = [
        {"kind": "approval", "title": "Draft an intro note to the hiring lead at " + gated["values"]["company"],
         "why": "They posted " + gated["values"]["title"] + ". The note waits for your approval and goes out by email.",
         "refs": [ref(gated), gated["links"][0]], "gate": gate_id},
        {"kind": "alert", "title": alerted["values"]["company"] + f" posted {posted} roles",
         "why": f"{posted} roles in this run, including " + alerted["values"]["title"] + ".", "refs": [alerted["links"][0], ref(alerted)]},
    ] + [{"kind": "match", "title": r["values"]["title"] + " at " + r["values"]["company"],
          "why": "Posted " + r["values"]["posted"] + " in " + r["values"]["location"] + ".", "refs": [ref(r)]}
         for r in active[2:6]]
    d.run({"runId": "jobs-watch-20261027", "producer": "jobs-watch", "startedAt": day("2026-10-27"),
           "endedAt": "2026-10-27T22:21:00Z", "status": "ok", "claimed": 3, "parsed": 2, "records": jw_c + roles_6,
           "inbox": inbox_6,
           "gates": [{"id": gate_id, "transport": "email", "timeoutHours": 48,
                      "correlation": "demo-" + "%08x" % d.rng.getrandbits(32),
                      "draft": {"subject": "Introduction about the " + gated["values"]["title"] + " role",
                                "body": "Hi,\n\nI saw the " + gated["values"]["title"] + " role and would like to introduce myself.\n\nThanks"},
                      "recipients": [{"role": "hiring lead"}]}]})

    # Human step: stars, a tag and a note on the Desk.
    def eid(rec):
        return desk_contract.entity_id(rec["type"], ref(rec)["key"])
    # Human step: a keep recorded after run 6, so it waits for the next run.
    pending_keep = next((r for r in roles_6[n(10):] if status(r) == "dropped"), None)
    if pending_keep:
        d.person("person: keep", [("decisions/" + eid(pending_keep),
                                   {"decision": "keep", "at": "2026-10-28T01:05:00Z", "by": "demo-person"})])
    # Human step: a person drops two active roles with a reason; they wait for the next run (Drop pending).
    d.person("person: drop", [("decisions/" + eid(r), {"decision": "drop", "reason": reason, "at": "2026-10-28T01:20:00.000Z",
                                                       "by": "demo-person"})
                              for r, reason in zip(active[6:8], ("Agency listing", "Salary too low"))])
    # Human step: the demo person snoozes the alert until next week (per-viewer state; a visit with no viewer id
    # does not see it).
    d.person("person: snooze", [("data/users/demo-person/state/snooze/jobs-watch-20261027--2",
                                 {"until": "2026-11-03T00:00:00.000Z", "at": "2026-10-28T01:22:00.000Z", "by": "demo-person"})])
    d.person("person: userstate", [
        ("userstate/" + eid(jw_c[2]), {"star": True, "tags": ["follow-up"], "note": "Met their ops lead at a meetup."}),
        ("userstate/" + eid(ls_companies[0]), {"star": True, "tags": ["tender"], "note": ""}),
        ("userstate/" + eid(gated), {"star": True, "tags": [], "note": ""}),
    ])
    return d


def main(argv=None):
    ap = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    ap.add_argument("--out", required=True, help="directory for batch-NNN.json files")
    ap.add_argument("--entities", type=int, default=TARGET_TOTAL, help=f"about how many entities (default {TARGET_TOTAL})")
    ap.add_argument("--snapshot", default=DEFAULT_SNAPSHOT, help="static snapshot path for the Desk static adapter")
    args = ap.parse_args(argv)
    d = build(args.entities / TARGET_TOTAL)
    os.makedirs(args.out, exist_ok=True)
    for name in os.listdir(args.out):
        if name.startswith("batch-") and name.endswith(".json"):
            os.remove(os.path.join(args.out, name))
    count = routineos.write_batches(args.out, d.phases) - 1
    snap = d.store.snapshot()
    with open(args.snapshot, "w", encoding="utf-8") as fh:
        json.dump(snap, fh, sort_keys=True, separators=(",", ":"))
        fh.write("\n")
    print(f"ok: {count} batch file(s) in {args.out}, {len(snap)} documents in {args.snapshot}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
