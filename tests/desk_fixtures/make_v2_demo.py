"""Build the Desk v2 test fixtures from the static jobs-watch demo.

v2-demo.json is the demo plus fictional extras: an owner (u_owner), a second person (u_member) who made the demo's
decisions and settings change, three comments on one Role, an image capture with three notes on that Role, a run that
reports on processed requests, and a desk.health mapping for Role over its market field. lock-demo.json is a small
workspace with a PIN lock (PIN 246810; salt and hash in hex; PBKDF2-SHA-256, 310000 iterations).

Usage: python3 tests/desk_fixtures/make_v2_demo.py [--check]. Deterministic; --check exits 1 when a committed file
differs from a fresh build.
"""
import argparse
import copy
import base64
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
DEMO = os.path.join(ROOT, "templates", "jobs-watch", "demo", "desk-demo.json")
OUT_V2 = os.path.join(HERE, "v2-demo.json")
OUT_LOCK = os.path.join(HERE, "lock-demo.json")
OUT_WALK = os.path.join(HERE, "v2-walk.json")

OWNER = "u_owner"
MEMBER = "u_member"
DEMO_PERSON = "demo-person"
ROLE = "role--https-jobs-example-au-00003"
PIN = "246810"
ITERATIONS = 310000


def ts36(iso):
    """The comment id suffix: the time in ms since the epoch, in base 36."""
    from datetime import datetime
    n = int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000)
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    out = ""
    while n:
        n, r = divmod(n, 36)
        out = digits[r] + out
    return out or "0"


def doc(data):
    return {"data": data, "version": 1}


def comment(snap, by, at, text, **extra):
    cid = "comments/%s--%s--%s" % (ROLE, by, ts36(at))
    snap[cid] = doc(dict({"entity": ROLE, "by": by, "text": text, "at": at}, **extra))
    return cid


def reattribute(snap):
    """The demo's decisions, settings change and snooze were made by u_member."""
    out = {}
    for path, d in snap.items():
        data = d.get("data")
        if isinstance(data, dict):
            for key in ("by", "updatedBy"):
                if data.get(key) == DEMO_PERSON:
                    data[key] = MEMBER
        if path.startswith("data/users/%s/" % DEMO_PERSON):
            path = "data/users/%s/" % MEMBER + path[len("data/users/%s/" % DEMO_PERSON):]
        out[path] = d
    return out


def build_v2(demo):
    snap = reattribute(copy.deepcopy(demo))
    snap["meta/owner"] = doc({"by": OWNER, "at": "2026-09-01T09:00:00Z"})

    first = comment(snap, OWNER, "2026-10-26T09:00:00Z", "Worth a look: lead level and remote.")
    comment(snap, MEMBER, "2026-10-26T10:15:00Z", "Agreed. I will check the salary band first.", replyTo=first)
    # An edit names the original by its bare id (write contract), within the 15 minute edit window.
    comment(snap, OWNER, "2026-10-26T09:10:00Z", "Worth a look: lead level, remote and in AU.", edits=first[len("comments/"):])

    # Inline, so the fixture needs no /assets route in the test server or in a published demo.
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800">'
           '<rect width="1280" height="800" fill="#f2f2f0"/><rect x="102" y="96" width="512" height="80" fill="#d9d9d4"/>'
           '<rect x="102" y="240" width="448" height="64" fill="#d9d9d4"/></svg>')
    image = "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()
    snap["entities/" + ROLE]["data"]["capture"] = {
        "image": image, "capturedAt": "2026-10-27T22:05:00Z", "width": 1280,
        "notes": [
            {"id": "n1", "title": "Salary", "text": "The band is not on the posting.", "kind": "yellow",
             "box": [0.08, 0.12, 0.4, 0.1]},
            {"id": "n2", "title": "Location", "text": "Remote within AU only.", "kind": "info",
             "box": [0.08, 0.3, 0.35, 0.08]},
            {"id": "n3", "title": "Closing date", "text": "Closes in two days.", "kind": "red",
             "box": [0.55, 0.62, 0.3, 0.12]},
        ],
    }

    run = copy.deepcopy(snap["runs/jobs-watch-20261027"]["data"])
    run.update({
        "runId": "jobs-watch-20261028", "startedAt": "2026-10-27T23:30:00Z", "endedAt": "2026-10-27T23:41:00Z",
        "status": "done", "parsed": 3, "claimed": 3, "changed": [], "dropped": [], "droppedByReason": {},
        "counts": {"dropped": 0, "new": 0, "unchanged": 145, "updated": 0},
        "inboxWritten": 0, "inboxSuppressed": 0, "inboxFiltered": 0,
        "processed": [
            {"request": "jobs-watch-20261027--g1", "outcome": "applied", "result": "Introduction sent."},
            {"request": "jobs-watch-20261008--2", "outcome": "not_applied", "reason": "GB is not in this run's sources yet."},
        ],
    })
    snap["runs/jobs-watch-20261028"] = doc(run)

    snap["meta/definition"]["data"]["desk"] = {"health": {"role": {
        "field": "market", "red": ["DE"], "yellow": ["GB"], "green": ["AU", "US", "CA", "NZ", "PH"]}}}
    return snap


def build_walk(demo):
    """v2-demo plus what the Verify walk needs: a pending request, notes whose boxes cannot be placed on the image,
    and run docs that do and do not carry Captured, Failed, New reds and Cost. Kept apart from v2-demo so the text
    goldens captured on v2-demo never move. (A list past the 30,000 row read cap is pinned in the Vitest suite: the
    stand-in runtime does not page, so it cannot show one.)"""
    snap = build_v2(demo)
    snap["requests/req~walk0001~a1b2c3d4e5f6"] = doc({
        "kind": "run-now", "routine": "jobs-watch", "createdAt": "2026-10-27T23:50:00Z", "by": OWNER,
        "status": "pending", "note": "Check the new boards before Friday."})
    notes = snap["entities/" + ROLE]["data"]["capture"]["notes"]
    notes.append({"id": "n4", "title": "Off the page", "text": "Box starts left of the image.", "kind": "info",
                  "box": [-0.2, 0.1, 0.3, 0.1]})
    notes.append({"id": "n5", "title": "No width", "text": "Box has no width.", "kind": "warn", "box": [0.5, 0.5, 0, 0.1]})
    run = copy.deepcopy(snap["runs/jobs-watch-20261028"]["data"])
    run.update({"runId": "jobs-watch-20261029", "startedAt": "2026-10-28T22:00:00Z", "endedAt": "2026-10-28T22:12:00Z",
                "processed": [], "cost": 1.25,
                "counts": {"dropped": 0, "new": 2, "unchanged": 140, "updated": 3, "captured": 145, "failed": 1, "newReds": 1}})
    snap["runs/jobs-watch-20261029"] = doc(run)
    return snap


def build_lock(demo):
    salt = hashlib.sha256(b"v2-demo-lock-salt").digest()[:16]
    key = hashlib.pbkdf2_hmac("sha256", PIN.encode(), salt, ITERATIONS)
    snap = {p: copy.deepcopy(d) for p, d in demo.items() if p in ("meta/workspace", "meta/definition")}
    snap["meta/owner"] = doc({"by": OWNER, "at": "2026-09-01T09:00:00Z"})
    snap["meta/lock"] = doc({"salt": salt.hex(), "hash": key.hex(),
                             "iterations": ITERATIONS, "algo": "PBKDF2-SHA-256", "setAt": "2026-10-20T08:00:00Z",
                             "setBy": OWNER})
    return snap


def dumps(snap):
    return json.dumps(snap, sort_keys=True, separators=(",", ":")) + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    ap.add_argument("--check", action="store_true", help="exit 1 when a committed file differs from a fresh build")
    args = ap.parse_args(argv)
    with open(DEMO, encoding="utf-8") as fh:
        demo = json.load(fh)
    built = {OUT_V2: dumps(build_v2(demo)), OUT_LOCK: dumps(build_lock(demo)), OUT_WALK: dumps(build_walk(demo))}
    stale = []
    for path, text in built.items():
        if args.check:
            try:
                with open(path, encoding="utf-8") as fh:
                    if fh.read() != text:
                        stale.append(path)
            except OSError:
                stale.append(path)
        else:
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(text)
    if stale:
        print("stale: " + ", ".join(os.path.relpath(p, ROOT) for p in stale) + "; run make_v2_demo.py")
        return 1
    print("ok: " + ", ".join(os.path.relpath(p, ROOT) for p in built) + (" are current" if args.check else " written"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
