#!/usr/bin/env python3
"""Synthetic Desk snapshot for the Weekly marketing report demo. Standard library only.

Every number comes from random.Random(2026): 12 weeks x 3 sources x sessions, conversions and revenue, plus search
clicks, impressions, click rate and position from random.Random(2027) (a separate stream, so the first set does not
move), plus a few audited pages. The workspace, settings and meta/definition come from the same seed plan a real publish uses
(routineos.build_seed, which calls definition.compile). Every name is invented and every domain ends in .example.

    pages-demo-generate.py [--snapshot templates/weekly-marketing-report/demo/pages-demo.json]
"""
import argparse
import json
import os
import random
import sys
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.dirname(HERE)
ROOT = os.path.dirname(os.path.dirname(TEMPLATE))
sys.path.insert(0, os.path.join(ROOT, "skills", "routineos", "scripts"))
import desk_contract  # noqa: E402
import routineos  # noqa: E402

PRODUCER = "weekly-marketing-report"
SEED_AT = "2026-08-17T09:00:00Z"
DEFAULT_SNAPSHOT = os.path.join(HERE, "pages-demo.json")
FIRST_WEEK = date(2026, 8, 17)
WEEKS = 12
# source: (weekly sessions to start from, growth per week, conversion rate, average order value)
SOURCES = {"analytics": (4200, 0.025, 0.030, 82), "search-ads": (2600, 0.012, 0.040, 95), "social-ads": (1800, 0.040, 0.018, 61)}
# search: (weekly impressions to start from, growth per week, click rate, starting average position)
SEARCH = ("search", 3000, 0.02, 0.002, 32.0)
AUDITS = [
    ("https://shop.example/pricing", "Pricing", ["Title is longer than 60 characters", "No meta description"]),
    ("https://shop.example/checkout", "Checkout", []),
    ("https://shop.example/", "Home", ["Hero image has no alt text"]),
    ("https://shop.example/returns", "Returns policy", ["Two links return a 404"]),
]


def metric(source, name, week, value, previous):
    key = f"{source}/{name}/{week}"
    change = round((value - previous) / previous * 100, 1) if previous else 0
    values = {"key": key, "source": source, "name": name, "week": week, "value": value, "previous": previous, "change_pct": change}
    return key, values


def entity(type_name, key, values, at, run):
    return {"version": 1, "data": {
        "type": type_name, "key": key, "status": "active", "schema": 1, "dropReason": None, "agentFields": {},
        "display": values, "bySource": {PRODUCER: values}, "sources": [PRODUCER], "links": [],
        "firstSeen": at, "lastSeen": at, "lastRun": run, "seenCount": 1,
        "sightings": [{"at": at, "dropReason": None, "outcome": "new", "producer": PRODUCER, "run": run, "values": values}],
    }}


def build():
    rng = random.Random(2026)
    compiled, phases = routineos.build_seed([TEMPLATE], SEED_AT)
    store = desk_contract.FakeStore()
    for ph in phases:
        if ph["ops"]:
            store.apply(ph["ops"])
    docs = store.snapshot()
    last = {}
    rng_search = random.Random(2027)
    for n in range(WEEKS):
        start = FIRST_WEEK + timedelta(days=7 * n)
        week = start.isoformat()
        at = (start + timedelta(days=6)).isoformat() + "T21:00:00Z"
        run = f"{PRODUCER}-{(start + timedelta(days=6)).strftime('%Y%m%d')}"
        for source, (base, growth, rate, order) in SOURCES.items():
            sessions = round(base * (1 + growth) ** n * rng.uniform(0.94, 1.06))
            conversions = round(sessions * rate * rng.uniform(0.9, 1.1))
            revenue = conversions * order + rng.randint(-120, 120)
            for name, value in (("sessions", sessions), ("conversions", conversions), ("revenue", revenue)):
                previous = last.get((source, name), 0)
                key, values = metric(source, name, week, value, previous)
                docs["entities/" + desk_contract.entity_id("metric", key)] = entity("metric", key, values, at, run)
                last[(source, name)] = value
        source, base, growth, rate, position = SEARCH
        impressions = round(base * (1 + growth) ** n * rng_search.uniform(0.94, 1.06))
        clicks = round(impressions * rate * rng_search.uniform(0.8, 1.2))
        ctr_pct = round(clicks / impressions * 100, 2)
        average = round(position - 0.3 * n + rng_search.uniform(-1, 1), 1)
        for name, value in (("clicks", clicks), ("impressions", impressions), ("ctr_pct", ctr_pct), ("position", average)):
            key, values = metric(source, name, week, value, last.get((source, name), 0))
            docs["entities/" + desk_contract.entity_id("metric", key)] = entity("metric", key, values, at, run)
            last[(source, name)] = value
    at = (FIRST_WEEK + timedelta(days=7 * (WEEKS - 1) + 6)).isoformat() + "T21:00:00Z"
    run = f"{PRODUCER}-{at[:10].replace('-', '')}"
    for i, (url, title, issues) in enumerate(AUDITS):
        values = {"url": url, "title": title, "checked": (FIRST_WEEK + timedelta(days=7 * (WEEKS - 1) + 6 - i)).isoformat(), "issues": issues}
        docs["entities/" + desk_contract.entity_id("audit", url)] = entity("audit", url, values, at, run)
    return docs


def main(argv=None):
    ap = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    ap.add_argument("--snapshot", default=DEFAULT_SNAPSHOT, help="static snapshot path for the Desk static adapter")
    args = ap.parse_args(argv)
    docs = build()
    with open(args.snapshot, "w", encoding="utf-8") as fh:
        json.dump(docs, fh, sort_keys=True, separators=(",", ":"))
        fh.write("\n")
    print(f"ok: {len(docs)} documents in {args.snapshot}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
