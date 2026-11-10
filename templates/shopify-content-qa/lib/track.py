"""Compare this run with the stored state and build the run's records and Inbox. Standard library only.

Usage: python3 lib/track.py --pages pages.json --issues issues.json --docs snapshot.json
       --producer shopify-content-qa --max-inbox 10 --out run-part.json [--shots shots.json]

snapshot.json is the Desk docs snapshot {path: {version, data}}. Earlier page and issue records
are the entities/ docs of type page or issue with values from this producer; a person's
decision is decisions/<entity id> ({decision: keep or drop, reason}).

Pages: new (not stored before), changed (content hash differs), unchanged, removed (stored, and
no longer listed). A page left out by the page cap is neither read nor removed, and no page is
removed when pages.json says sitemap_complete is not true (a child sitemap or the product feed
failed). Each page has id page--<12 hex of the sha256 of its URL>; the type's identity is that id.
Issues: new (not open before), open (still found), resolved (open before, the rule no longer
fires, and its page was removed or loaded this run: status 200, the product JSON too for a
product page, every link checked for broken_link, every image checked for broken_image, the home
page loaded for unavailable_featured). A failed or rate-limited read never resolves an issue.
A person's decision is read as:
  keep                            confirmed, needs a fix
  drop, reason starting accepted  accepted as intentional
  drop, any other reason          dismissed as a false positive
A dropped issue is still recorded (the write step keeps it dropped) but never reaches the Inbox.
Inbox: one alert per new issue, high severity first, at most --max-inbox, then one alert per
confirmed issue that is now resolved, inside the same cap.

--shots is {shots: {url: link}, notes: {url: note}} from lib/worker_shots.py; matching pages and
issues get the link, and issues get the note.
Writes {records, inbox, summary}; prints the summary only. Exit 2 on malformed input.
"""
import argparse
import hashlib
import json
import sys
from collections import Counter

SEV = {"high": 0, "medium": 1, "low": 2}


def fail(msg):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(2)


def load(path, label):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        fail(f"cannot read {label} as JSON")


def stored(docs, producer):
    """({url: (entity id, values)} for pages, {issue id: (entity id, values)} for issues)."""
    pages, issues = {}, {}
    for path, doc in docs.items():
        if not path.startswith("entities/") or not isinstance(doc, dict):
            continue
        data = doc.get("data") or {}
        values = (data.get("bySource") or {}).get(producer)
        if not isinstance(values, dict):
            continue
        eid = path[len("entities/"):]
        if data.get("type") == "page" and isinstance(values.get("url"), str):
            pages[values["url"]] = (eid, values)
        elif data.get("type") == "issue" and isinstance(values.get("id"), str):
            issues[values["id"]] = (eid, values)
    return pages, issues


def page_id(url):
    return "page--" + hashlib.sha256(url.encode("utf-8")).hexdigest()[:12]


def loaded_for(rule, page, home):
    """True when this run's read of the page can show the rule no longer fires."""
    if not page or page.get("status") != 200:
        return False
    if page.get("kind") == "product" and (page.get("product") or {}).get("status") != 200:
        return False
    if rule == "broken_link" and page.get("links_complete") is not True:
        return False
    if rule == "broken_image" and page.get("images_complete") is not True:
        return False
    if rule == "unavailable_featured" and (not home or home.get("status") != 200):
        return False
    return True


def decision_of(docs, eid):
    d = ((docs.get(f"decisions/{eid}") or {}).get("data")) or {}
    if d.get("decision") == "keep":
        return "confirmed"
    if d.get("decision") == "drop":
        reason = str(d.get("reason") or "").strip().casefold()
        return "accepted" if reason.startswith("accepted") else "dismissed"
    return None


def track(pages_doc, issues_doc, docs, producer, max_inbox, shots):
    links, notes = (shots or {}).get("shots") or {}, (shots or {}).get("notes") or {}
    pages = pages_doc.get("pages")
    issues = issues_doc.get("issues")
    if not isinstance(pages, list) or not isinstance(issues, list):
        fail("pages and issues files must hold lists")
    listed = set(pages_doc.get("listed") or [])
    prev_pages, prev_issues = stored(docs, producer)
    by_page = {}
    for i in issues:
        if not isinstance(i, dict) or not all(isinstance(i.get(k), str) for k in ("id", "rule", "severity", "url")):
            fail("each issue needs id, rule, severity and url")
        by_page.setdefault(i["url"], []).append(i)
    records, page_state = [], Counter()
    read, home = {}, None
    for p in pages:
        if not isinstance(p, dict) or not isinstance(p.get("url"), str):
            fail("each page needs a url")
        url = p["url"]
        read[url] = p
        if p.get("kind") == "home":
            home = p
        before = prev_pages.get(url)
        if before is None:
            state = "new"
        elif before[1].get("state") == "removed" or before[1].get("hash") != p.get("hash"):
            state = "changed"
        else:
            state = "unchanged"
        page_state[state] += 1
        found = by_page.get(url, [])
        top = min((i["severity"] for i in found), key=lambda s: SEV.get(s, 9), default="")
        records.append({"type": "page", "values": {
            "id": page_id(url), "url": url, "kind": p.get("kind") or "", "title": (p.get("title") or "")[:200], "state": state,
            "http_status": p.get("status"), "hash": p.get("hash") or "", "issue_count": len(found),
            "top_severity": top, "screenshot": links.get(url, "")}})
    removed = []
    for url, (_, values) in sorted(prev_pages.items()):
        if (pages_doc.get("sitemap_complete") is True and url not in read and listed and url not in listed
                and values.get("state") != "removed"):
            removed.append(url)
            page_state["removed"] += 1
            records.append({"type": "page", "values": dict(values, id=page_id(url), state="removed", issue_count=0,
                                                           top_severity="")})
    now = {i["id"]: i for i in issues}
    counts, decided, new_alerts, fixed_alerts = Counter(), Counter(), [], []
    for iid, i in now.items():
        before = prev_issues.get(iid)
        was_open = before is not None and before[1].get("state") in ("new", "open")
        status = "open" if was_open else "new"
        decision = decision_of(docs, before[0]) if before else None
        counts[status] += 1
        if decision:
            decided[decision] += 1
        values = {"id": iid, "rule": i["rule"], "severity": i["severity"], "label": i.get("label", i["rule"]),
                  "url": i["url"], "kind": i.get("kind") or "", "detail": str(i.get("detail", ""))[:300],
                  "state": status, "screenshot": links.get(i["url"], ""),
                  "screenshot_note": str(notes.get(i["url"], ""))[:300]}
        records.append({"type": "issue", "values": values, "links": [{"type": "page", "key": page_id(i["url"])}]})
        if status == "new" and decision not in ("accepted", "dismissed"):
            new_alerts.append(values)
    for iid, (eid, values) in sorted(prev_issues.items()):
        if iid in now or values.get("state") not in ("new", "open"):
            continue
        url = values.get("url")
        if url not in removed and not loaded_for(values.get("rule"), read.get(url), home):
            continue
        counts["resolved"] += 1
        values = dict(values, state="resolved")
        records.append({"type": "issue", "values": values, "links": [{"type": "page", "key": page_id(str(url))}]})
        if decision_of(docs, eid) == "confirmed":
            fixed_alerts.append(values)
    new_alerts.sort(key=lambda v: (SEV.get(v["severity"], 9), v["rule"], v["url"]))
    inbox = []
    for v in new_alerts + fixed_alerts:
        if len(inbox) >= max_inbox:
            break
        fixed = v["state"] == "resolved"
        title = f"Fixed: {v['label']}" if fixed else f"{v['severity'].capitalize()}: {v['label']}"
        why = (f"Marked as needing a fix and no longer found on {v['url']}." if fixed
               else f"{v['detail']} on {v['url']}.")
        inbox.append({"kind": "alert", "title": title[:100], "why": why[:500],
                      "refs": [{"type": "issue", "key": v["id"]}]})
    summary = {
        "pages": {"read": len(pages), "listed": len(listed), **{k: page_state[k] for k in ("new", "changed", "unchanged", "removed")}},
        "issues": {k: counts[k] for k in ("new", "open", "resolved")},
        "by_severity": dict(Counter(i["severity"] for i in issues)),
        "decisions": {k: decided[k] for k in ("confirmed", "accepted", "dismissed")},
        "inbox": len(inbox),
        "inbox_left_out": len(new_alerts) + len(fixed_alerts) - len(inbox),
    }
    return {"records": records, "inbox": inbox, "summary": summary}


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--pages", required=True)
    ap.add_argument("--issues", required=True)
    ap.add_argument("--docs", required=True)
    ap.add_argument("--producer", required=True)
    ap.add_argument("--max-inbox", type=int, default=10)
    ap.add_argument("--shots")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    if not 0 <= args.max_inbox <= 30:
        fail("--max-inbox must be between 0 and 30")
    pages, issues, docs = load(args.pages, "pages"), load(args.issues, "issues"), load(args.docs, "snapshot")
    if not all(isinstance(x, dict) for x in (pages, issues, docs)):
        fail("pages, issues and snapshot must be JSON objects")
    shots = load(args.shots, "shots") if args.shots else {}
    if not isinstance(shots, dict) or not all(
            isinstance(shots.get(k, {}), dict) and all(isinstance(v, str) for v in shots.get(k, {}).values())
            for k in ("shots", "notes")):
        fail("shots must hold shots {url: link} and notes {url: note}")
    result = track(pages, issues, docs, args.producer, args.max_inbox, shots)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2)
    print(json.dumps(result["summary"], indent=2))


if __name__ == "__main__":
    main()
