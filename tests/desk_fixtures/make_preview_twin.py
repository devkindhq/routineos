"""Build the preview twin fixture: a Desk snapshot with the shape of the desk-v2 preview data and none of its words.

One producer ("pages") with one type ("page"), 1,378 records (12 red, 31 yellow, 1,335 green), the first 25 rows in a fixed
pattern of statuses, image note counts, owners and comment counts, five waiting approvals, five runs and activity over three
days. People are u_owner, u_member and u_third (see PROFILES in tests/visual/fake-claude.mjs); links use *.example domains.
Reuses the helpers of make_v2_demo.py. Deterministic, no network.

Usage: python3 tests/desk_fixtures/make_preview_twin.py [--check]. --check exits 1 when the committed file differs.
"""
import argparse
import base64
import copy
import json
import os
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import make_v2_demo as v2  # noqa: E402

OUT = os.path.join(HERE, "preview-twin.json")
PRODUCER = "pages"
TOTAL, RED, YELLOW = 1378, 12, 31
PEOPLE = ["u_owner", "u_member", "u_third"]
TODAY = datetime(2026, 11, 7, 6, 12, tzinfo=timezone.utc)
KINDS = ["Product", "Product", "Product", "Product", "Post", "Product", "Product", "Product", "Info", "Product", "Product",
         "Product", "Product", "Product", "Collection", "Product", "Product", "Product", "Info", "Product", "Product",
         "Landing", "Product", "Product", "Product"]
# The first 25 rows: status, image notes, owner index, comments.
HEAD = [
    ("red", 5, 0, 3), ("green", 0, 1, 0), ("red", 3, 2, 2), ("yellow", 1, 1, 1), ("red", 2, 0, 0),
    ("green", 0, 2, 0), ("red", 4, 1, 4), ("yellow", 2, 2, 0), ("red", 1, 0, 2), ("green", 0, 1, 0),
    ("red", 2, 2, 1), ("yellow", 1, 0, 0), ("green", 0, 1, 0), ("red", 1, 2, 0), ("green", 0, 0, 0),
    ("red", 1, 1, 0), ("yellow", 1, 2, 0), ("green", 0, 0, 0), ("green", 0, 1, 1), ("green", 0, 2, 0),
    ("green", 0, 0, 0), ("green", 0, 1, 0), ("green", 0, 2, 0), ("green", 0, 0, 0), ("green", 0, 1, 0),
]
NOTE_KINDS = ["red", "yellow", "info", "red", "yellow"]
NOTE_TEXT = ["The offer on this page has ended.", "The wording promises more than the page can keep.",
             "The link here returns not found.", "Placeholder text is still live.", "The claim has no source."]
RUNS = [  # id suffix, days ago, status, claimed, changed, summary
    ("0412", 0, "partial", 1376, 5), ("0411", 1, "ok", 1364, 1), ("0410", 2, "ok", 1364, 0),
    ("0409", 3, "failed", 702, 0), ("0408", 6, "ok", 1350, 2)]


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def image():
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800">'
           '<rect width="1280" height="800" fill="#f2f2f0"/><rect x="102" y="96" width="512" height="80" fill="#d9d9d4"/>'
           '<rect x="102" y="240" width="448" height="64" fill="#d9d9d4"/></svg>')
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()


def statuses():
    out = [h[0] for h in HEAD]
    rest = TOTAL - len(HEAD)
    reds, yellows = RED - out.count("red"), YELLOW - out.count("yellow")
    tail = ["green"] * rest
    for i in range(reds):
        tail[40 + i * 300] = "red"
    for i in range(yellows):
        tail[11 + i * 49] = "yellow"
    return out + tail


def build(demo):
    snap = {p: copy.deepcopy(d) for p, d in demo.items() if p in ("meta/workspace", "meta/definition")}
    snap["meta/owner"] = v2.doc({"by": "u_owner", "at": "2026-09-01T09:00:00Z"})
    snap["meta/workspace"]["data"].update({"name": "Pages twin", "producers": [PRODUCER], "template": "pages"})
    d = snap["meta/definition"]["data"]
    producer = copy.deepcopy(d["producers"][0])
    producer.update({"id": PRODUCER, "label": "Pages", "types": ["page"], "inbox": True, "schedule": "0 6 * * *",
                     "settings": [{"cost_note": "a longer window means more pages to compare", "default": 7,
                                   "label": "Lookback days", "max": 30, "min": 1, "name": "lookback_days", "type": "number"}]})
    d["producers"] = [producer]
    d["types"] = {"page": {
        "fields": {"title": {"label": "Title", "summary": True, "type": "text"},
                   "url": {"label": "URL", "summary": True, "type": "url"},
                   "section": {"label": "Section", "summary": True, "type": "text"},
                   "health": {"choices": ["red", "yellow", "green"], "label": "Status", "summary": True, "type": "choice"}},
        "icon": "file-text", "identity": "field:url", "label": "Page", "links": [], "merge": "merge",
        "order": ["title", "url", "section", "health"], "plural": "Pages", "producers": [PRODUCER], "settingFilters": []}}
    d["views"] = [{"columns": ["title", "section", "health"], "filters": {"status": "active"}, "id": "all-pages",
                   "madeBy": "definition", "name": "All pages", "producer": PRODUCER, "sort": {"dir": "desc", "field": "firstSeen"},
                   "type": "page"}]
    d["desk"] = {"health": {"page": {"field": "health", "red": ["red"], "yellow": ["yellow"], "green": ["green"]}}}
    snap["settings/pages"] = v2.doc({"updatedAt": "2026-09-01T09:00:00Z", "updatedBy": "seed", "values": {"lookback_days": 7}})
    snap["settings/workspace"] = v2.doc({"updatedAt": "2026-09-01T09:00:00Z", "updatedBy": "seed", "values": {
        "mergePolicy": {"page": "merge"}, "notifications": "inbox", "quietHours": {"from": "", "to": ""}}})

    run_ids = ["%s-2026%s" % (PRODUCER, r[0]) for r in RUNS]
    sts = statuses()
    img = image()
    ids = []
    for i in range(TOTAL):
        slug = "page-%04d" % (i + 1)
        eid = "page--" + slug
        ids.append(eid)
        row = HEAD[i] if i < len(HEAD) else (sts[i], 0, i % 3, 0)
        seen = TODAY - timedelta(minutes=i) if i < len(HEAD) else TODAY - timedelta(days=1 + i // 40, minutes=i % 40)
        kind = KINDS[i] if i < len(KINDS) else "Product"
        values = {"title": "Sample %s %04d" % (kind.lower(), i + 1),
                  "url": "https://pages.example/%s/%s" % (kind.lower(), slug), "section": kind, "health": sts[i]}
        data = {"agentFields": {}, "bySource": {PRODUCER: values}, "display": values, "dropReason": None,
                "firstSeen": iso(seen), "key": values["url"], "lastRun": run_ids[0], "lastSeen": iso(seen), "links": [],
                "schema": 1, "seenCount": 1, "sources": [PRODUCER], "status": "active", "type": "page", "sightings": [{"at": iso(seen), "dropReason": None, "outcome": "new",
                                                            "producer": PRODUCER, "run": run_ids[0], "values": values}]}
        notes = row[1]
        if notes:
            kinds = ["red", "yellow", "info"] if notes == 3 else [NOTE_KINDS[n % 5] for n in range(notes)]
            data["capture"] = {"image": img, "capturedAt": iso(seen), "width": 1280, "notes": [
                {"id": "n%d" % (n + 1), "title": "Note %d" % (n + 1), "text": NOTE_TEXT[n % 5], "kind": kinds[n],
                 "box": [0.08, round(0.1 + 0.12 * n, 2), 0.4, 0.1]} for n in range(notes)]}
        snap["entities/" + eid] = v2.doc(data)
        if i < len(HEAD):
            who = PEOPLE[row[2]]
            if row[0] == "green":
                snap["decisions/" + eid] = v2.doc({"at": iso(seen + timedelta(minutes=3)), "by": who, "decision": "keep"})
            for c in range(row[3]):
                at = iso(seen + timedelta(minutes=5 + c))
                cid = "comments/%s--%s--%s" % (eid, who, v2.ts36(at))
                snap[cid] = v2.doc({"entity": eid, "by": who, "text": "Checked this page, see the notes.", "at": at})

    for n, (suffix, ago, status, claimed, changed) in enumerate(RUNS):
        start = TODAY.replace(hour=6, minute=0) - timedelta(days=ago)
        end = start + timedelta(minutes=47 - n)
        counts = {"dropped": 0, "new": 0, "unchanged": claimed - changed, "updated": changed}
        snap["runs/" + run_ids[n]] = v2.doc({
            "changed": ids[:changed], "claimed": claimed, "counts": counts, "definitionVersion": d.get("version", "x"),
            "dropped": [], "droppedByReason": {}, "endedAt": iso(end), "inboxFiltered": 0, "inboxSuppressed": 0,
            "inboxWritten": 0, "mergePolicy": {"page": "merge"}, "parentRun": None, "parsed": claimed, "phase": "done",
            "producer": PRODUCER, "runId": run_ids[n], "schema": 1, "sessionUrl": None, "settingsUsed": {"lookback_days": 7},
            "startedAt": iso(start), "status": status})

    for g in range(5):
        gate = "%s--g%d" % (run_ids[0], g + 1)
        at = iso(TODAY.replace(hour=6, minute=0) + timedelta(minutes=g))
        snap["pending/" + gate] = v2.doc({
            "correlation": "twin-%d" % g, "createdAt": at,
            "draft": {"body": "Hi,\n\nA short note about page %d.\n\nThanks" % (g + 1), "subject": "About page %d" % (g + 1)},
            "producer": PRODUCER, "recipients": [{"role": "page owner"}], "run": run_ids[0], "schema": 1,
            "status": "pending", "timeoutHours": 48, "transport": "email"})
        snap["inbox/" + gate] = v2.doc({
            "createdAt": at, "gate": gate, "kind": "approval", "producer": PRODUCER,
            "refs": [{"id": ids[g], "key": snap["entities/" + ids[g]]["data"]["key"], "type": "page"}],
            "run": run_ids[0], "schema": 1, "title": "Send a note to the owner of page %d" % (g + 1),
            "why": "The page has an open issue. The note waits for your approval."})

    # Activity over three day groups: decisions today, yesterday and earlier this week.
    for n, days in enumerate((0, 1, 4)):
        eid = ids[HEAD.index(next(h for h in HEAD if h[0] == "green")) + n * 9]
        snap["decisions/" + eid] = v2.doc({"at": iso(TODAY - timedelta(days=days, minutes=30)),
                                           "by": PEOPLE[n % 3], "decision": "keep"})
    return snap


def main(argv=None):
    ap = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    ap.add_argument("--check", action="store_true", help="exit 1 when the committed file differs from a fresh build")
    args = ap.parse_args(argv)
    with open(v2.DEMO, encoding="utf-8") as fh:
        demo = json.load(fh)
    text = v2.dumps(build(demo))
    if args.check:
        try:
            with open(OUT, encoding="utf-8") as fh:
                same = fh.read() == text
        except OSError:
            same = False
        if not same:
            print("stale: %s; run make_preview_twin.py" % OUT)
            return 1
        print("ok: %s is current" % OUT)
        return 0
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write(text)
    print("ok: wrote %s (%d bytes)" % (OUT, len(text)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
