"""Compare this run with the stored state and build the run's records and Inbox. Standard library only.

Usage: python3 lib/track.py --flags flags.json --results results.json --docs snapshot.json
       --producer site-compliance-review --max-inbox 10 --out run-part.json
       [--images images.json]

flags.json is from lib/apply_rules.py, results.json from lib/fetch_results.py (read here only for
the Worker's health). snapshot.json is the Desk docs snapshot {path: {version, data}}; earlier
records are the entities/ docs from this producer, and a person's decision is
decisions/<entity id> ({decision: keep or drop, reason}):
  keep                            confirmed, needs a fix
  drop, reason starting accepted  accepted as intentional
  drop, any other reason          dismissed as a false positive
A dropped flag is still recorded (the write step keeps it dropped) but never reaches the Inbox.

Pages: one record per capture read this run, state new, changed (text hash differs) or unchanged,
with a capture block: the screenshot asset url from --images when there is one, and one note per
flag (kind red for high, warn for medium, info for low) with its box when it was placed (a Clef-only
flag has no box). Each page also holds clef_state (ok, off or error) and clef_card, the Clef scorecard
the Desk's clef-card component draws.
Flags carry origin (regex, both or clef), clef_score (0 to 100, empty when Clef did not score the rule)
and needs_review (the rule fired and Clef scored it below its flag line). Flags: new (not open before)
or open (still found); resolved when it was open before, its page was captured and loaded this run,
its rule ran this run and it no longer fires. A failed capture never resolves a flag, and a flag Clef
backed (origin clef or both) resolves only when Clef scored the page this run.
Health: one record of type health (id worker) from the Worker's summary, Clef settings and usage
included.
Inbox, at most --max-inbox: Worker alerts first (unreachable, sitemap differs from the setting,
sitemap errors, failed captures, the Worker asks Clef about different rules than lib/rules.json,
Clef scoring failed), then one alert per new flag, high severity first, then one per confirmed flag
now resolved.
Writes {records, inbox, summary}; prints the summary only. Exit 2 on malformed input.
"""
import argparse
import hashlib
import json
import re
import sys
from collections import Counter

SEV = {"high": 0, "medium": 1, "low": 2}
NOTE_KIND = {"high": "red", "medium": "warn", "low": "info"}
ASSET = re.compile(r"^/(?:assets|_blob)/[0-9a-f]{32}(?:\.[a-z0-9]{1,5})?$")


def fail(msg):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(2)


def load(path, label):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        fail(f"cannot read {label} as JSON")


def asset_url(url):
    """The form of a Desk asset url that loads for viewers: /_blob/<id>."""
    m = re.match(r"^/assets/([0-9a-f]{32})(?:\.[a-z0-9]{1,5})?$", url)
    return f"/_blob/{m.group(1)}" if m else url


def previous_image(docs, eid):
    """The screenshot url already stored on this entity, so a recapture without a new image keeps it."""
    doc = docs.get(f"entities/{eid}")
    cap = doc.get("capture") if isinstance(doc, dict) else None
    image = cap.get("image") if isinstance(cap, dict) else None
    return image if isinstance(image, str) else None


def stored(docs, producer):
    """({page id: (entity id, values)}, {flag id: (entity id, values)})."""
    pages, flags = {}, {}
    for path, doc in docs.items():
        if not path.startswith("entities/") or not isinstance(doc, dict):
            continue
        data = doc.get("data") or {}
        values = (data.get("bySource") or {}).get(producer)
        if not isinstance(values, dict) or not isinstance(values.get("id"), str):
            continue
        eid = path[len("entities/"):]
        if data.get("type") == "page":
            pages[values["id"]] = (eid, values)
        elif data.get("type") == "flag":
            flags[values["id"]] = (eid, values)
    return pages, flags


def decision_of(docs, eid):
    d = ((docs.get(f"decisions/{eid}") or {}).get("data")) or {}
    if d.get("decision") == "keep":
        return "confirmed"
    if d.get("decision") == "drop":
        reason = str(d.get("reason") or "").strip().casefold()
        return "accepted" if reason.startswith("accepted") else "dismissed"
    return None


def health(results, rules_asked, cards):
    w = results.get("worker") if isinstance(results.get("worker"), dict) else {}
    queue = w.get("queue") if isinstance(w.get("queue"), dict) else {}
    sm = w.get("sitemap") if isinstance(w.get("sitemap"), dict) else {}
    errors = [str(e)[:200] for e in (sm.get("errors") or []) if isinstance(e, str)][:5]

    def n(v):
        return v if isinstance(v, int) and not isinstance(v, bool) else None
    values = {"id": "worker", "reachable": results.get("reachable") is True,
              "error": str(results.get("error") or "")[:200],
              "queue_pending": n(queue.get("pending")), "queue_failed": n(queue.get("failed")),
              "sitemap_url": str(sm.get("url") or "")[:500], "sitemap_matches": results.get("sitemap_matches"),
              "sitemap_refreshed": str(sm.get("lastRefreshAt") or "")[:40], "sitemap_errors": "; ".join(errors)[:500],
              "last_batch": str(w.get("lastBatchAt") or "")[:40],
              "captures_read": len(results.get("results") or []), "refused": n(results.get("refused")) or 0}
    clef = w.get("clef") if isinstance(w.get("clef"), dict) else {}
    asked = sorted(r for r in (clef.get("rules") or []) if isinstance(r, str)) if isinstance(clef.get("rules"), list) else None
    values.update({"clef_on": clef.get("on") is True, "clef_model": str(clef.get("model") or "")[:100],
                   "clef_calls": n(clef.get("calls")), "clef_errors": n(clef.get("errors")),
                   "clef_input_tokens": n(clef.get("inputTokens")), "clef_output_tokens": n(clef.get("outputTokens")),
                   "clef_rules_match": (asked == sorted(rules_asked)) if clef.get("on") is True and asked is not None else None})
    failed = [c for c in cards if c.get("state") == "error"]
    alerts = []
    if not values["reachable"]:
        alerts.append(("Review Worker not reachable", f"{values['error'] or 'no answer'}. No pages were read this run."))
    else:
        if values["sitemap_matches"] is False:
            alerts.append(("Worker reads a different sitemap",
                           f"The Worker reads {values['sitemap_url'] or 'no sitemap'}, the setting expects "
                           f"{results.get('sitemap_expected')}."))
        if errors:
            alerts.append(("Sitemap read with errors", errors[0]))
        if values["refused"]:
            alerts.append(("Captures refused", f"{values['refused']} captures were not on the site host and were skipped."))
        if values["clef_rules_match"] is False:
            missing = sorted(set(rules_asked) - set(asked))
            extra = sorted(set(asked) - set(rules_asked))
            alerts.append(("Worker asks Clef different rules",
                           f"Not asked: {', '.join(missing) or 'none'}. Asked but not in lib/rules.json: "
                           f"{', '.join(extra) or 'none'}. Redeploy the Worker after changing the rules."))
        if failed:
            alerts.append((f"Clef scoring failed on {len(failed)} page{'s' if len(failed) > 1 else ''}",
                           f"{failed[0].get('error') or 'no message'}. Those pages keep their rule flags only."))
    return values, alerts


def clef_note_title(f):
    if f.get("origin") == "clef":
        return f"{f['label']} (Clef, whole page)"
    return f"{f['label']}: \"{f.get('match', '')}\""


def pct(v):
    return int(float(v) * 100 + 0.5) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def track(flags_doc, results, docs, producer, max_inbox, images):
    pages, flags, ran = flags_doc.get("pages"), flags_doc.get("flags"), flags_doc.get("rules")
    if not isinstance(pages, list) or not isinstance(flags, list) or not isinstance(ran, dict):
        fail("flags must hold pages and flags lists and a rules object")
    rules_asked = [r for r in (flags_doc.get("rules_asked") or []) if isinstance(r, str)]
    clef_state = {p.get("id"): (p.get("clef_card") or {}).get("state") for p in pages if isinstance(p, dict)}
    cards = [p["clef_card"] for p in pages if isinstance(p, dict) and isinstance(p.get("clef_card"), dict)]
    prev_pages, prev_flags = stored(docs, producer)
    by_page = {}
    for f in flags:
        if not isinstance(f, dict) or not all(isinstance(f.get(k), str) for k in ("id", "rule", "severity", "url", "page_id")):
            fail("each flag needs id, rule, severity, url and page_id")
        by_page.setdefault(f["page_id"], []).append(f)
    records, page_state, loaded = [], Counter(), set()
    counts, decided, new_alerts, fixed_alerts = Counter(), Counter(), [], []
    now_ids = {f["id"] for f in flags}
    for p in pages:
        if not isinstance(p, dict) or not isinstance(p.get("id"), str) or not isinstance(p.get("url"), str):
            fail("each page needs an id and a url")
        pid = p["id"]
        before = prev_pages.get(pid)
        state = "new" if before is None else ("changed" if before[1].get("hash") != p.get("hash") else "unchanged")
        page_state[state] += 1
        if p.get("ok"):
            loaded.add(pid)
        found = sorted(by_page.get(pid, []), key=lambda f: (SEV.get(f["severity"], 9), f["rule"]))
        values = {"id": pid, "url": p["url"], "title": p.get("title") or "", "state": state,
                  "capture": "ok" if p.get("ok") else "failed", "http_status": p.get("status"),
                  "flag_count": len(found), "top_severity": found[0]["severity"] if found else "",
                  "captured_at": p.get("capturedAt") or "", "seq": p.get("seq"), "hash": p.get("hash") or "",
                  "error": p.get("error") or ""}
        if p.get("ok"):
            card = p.get("clef_card") if isinstance(p.get("clef_card"), dict) else {"state": "off", "rows": []}
            values.update({"clef_state": card.get("state") or "off", "clef_card": card})
        rec = {"type": "page", "values": values}
        if p.get("ok"):
            notes = []
            for f in found[:50]:
                note = {"id": f["id"], "title": clef_note_title(f)[:200],
                        "text": str(f.get("context") or "")[:2000], "kind": NOTE_KIND.get(f["severity"], "info")}
                if isinstance(f.get("box"), list):
                    note["box"] = f["box"]
                notes.append(note)
            capture = {"capturedAt": p.get("capturedAt") or "", "notes": notes}
            if isinstance(p.get("width"), (int, float)):
                capture["width"] = p["width"]
            image = images.get(pid)
            if not (isinstance(image, str) and ASSET.match(image)) and before:
                image = previous_image(docs, before[0])
            if isinstance(image, str) and ASSET.match(image):
                capture["image"] = asset_url(image)
            rec["capture"] = capture
        records.append(rec)
        for f in found:
            before_f = prev_flags.get(f["id"])
            was_open = before_f is not None and before_f[1].get("state") in ("new", "open")
            status = "open" if was_open else "new"
            decision = decision_of(docs, before_f[0]) if before_f else None
            counts[status] += 1
            if decision:
                decided[decision] += 1
            count = f.get("count")
            fv = {"id": f["id"], "rule": f["rule"], "severity": f["severity"], "label": f.get("label") or f["rule"],
                  "url": f["url"], "match": str(f.get("match") or "")[:200], "context": str(f.get("context") or "")[:400],
                  "count": count if isinstance(count, int) and not isinstance(count, bool) else 1, "state": status,
                  "origin": f.get("origin") if f.get("origin") in ("regex", "both", "clef") else "regex",
                  "clef_score": pct(f.get("clef_score")), "needs_review": f.get("needs_review") is True}
            records.append({"type": "flag", "values": fv, "links": [{"type": "page", "key": pid}]})
            if status == "new" and decision not in ("accepted", "dismissed"):
                new_alerts.append(fv)
    for fid, (eid, fv) in sorted(prev_flags.items()):
        if fid in now_ids or fv.get("state") not in ("new", "open") or fv.get("rule") not in ran:
            continue
        pid = "page--" + hashlib.sha256(str(fv.get("url")).encode("utf-8")).hexdigest()[:12]
        if pid not in loaded:
            continue
        if fv.get("origin") in ("clef", "both") and clef_state.get(pid) != "ok":
            continue
        counts["resolved"] += 1
        fv = dict(fv, state="resolved")
        records.append({"type": "flag", "values": fv, "links": [{"type": "page", "key": pid}]})
        if decision_of(docs, eid) == "confirmed":
            fixed_alerts.append(fv)
    hv, health_alerts = health(results, rules_asked, cards)
    records.append({"type": "health", "values": hv})
    new_alerts.sort(key=lambda v: (SEV.get(v["severity"], 9), v["rule"], v["url"]))
    inbox = []
    for title, why in health_alerts:
        inbox.append({"kind": "alert", "title": title[:100], "why": why[:500], "refs": [{"type": "health", "key": "worker"}]})
    for v in new_alerts + fixed_alerts:
        fixed = v["state"] == "resolved"
        title = f"Fixed: {v['label']}" if fixed else f"{v['severity'].capitalize()}: {v['label']}"
        if fixed:
            why = f"Marked as needing a fix and no longer found on {v['url']}."
        elif v.get("origin") == "clef":
            why = f"Clef judged that this rule applies to {v['url']} ({v['clef_score']}%). There is no single phrase to quote."
        else:
            why = f"\"{v['match']}\" on {v['url']}."
            if v.get("needs_review"):
                why += f" Clef scored it {v['clef_score']}%, below its flag line: needs review."
        inbox.append({"kind": "alert", "title": title[:100], "why": why[:500], "refs": [{"type": "flag", "key": v["id"]}]})
    left_out = max(0, len(inbox) - max_inbox)
    inbox = inbox[:max_inbox]
    summary = {
        "pages": {"read": len(pages), "loaded": len(loaded), **{k: page_state[k] for k in ("new", "changed", "unchanged")}},
        "flags": {k: counts[k] for k in ("new", "open", "resolved")},
        "by_rule": dict(Counter(f["rule"] for f in flags)),
        "decisions": {k: decided[k] for k in ("confirmed", "accepted", "dismissed")},
        "worker_reachable": hv["reachable"], "images": sum(1 for r in records if "image" in (r.get("capture") or {})),
        "clef": (flags_doc.get("summary") or {}).get("clef"),
        "clefFlagList": [d for d in (flags_doc.get("clefFlagList") or []) if isinstance(d, dict)][:50],
        "needsReviewList": [d for d in (flags_doc.get("needsReviewList") or []) if isinstance(d, dict)][:50],
        "inbox": len(inbox), "inbox_left_out": left_out,
    }
    return {"records": records, "inbox": inbox, "summary": summary}


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--flags", required=True)
    ap.add_argument("--results", required=True)
    ap.add_argument("--docs", required=True)
    ap.add_argument("--producer", required=True)
    ap.add_argument("--max-inbox", type=int, default=10)
    ap.add_argument("--images")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    if not 0 <= args.max_inbox <= 30:
        fail("--max-inbox must be between 0 and 30")
    flags_doc, results, docs = load(args.flags, "flags"), load(args.results, "results"), load(args.docs, "snapshot")
    if not all(isinstance(x, dict) for x in (flags_doc, results, docs)):
        fail("flags, results and snapshot must be JSON objects")
    images = load(args.images, "images") if args.images else {}
    if not isinstance(images, dict):
        fail("images must be {page id: asset url}")
    result = track(flags_doc, results, docs, args.producer, args.max_inbox, images)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2)
    print(json.dumps(result["summary"], indent=2))


if __name__ == "__main__":
    main()
