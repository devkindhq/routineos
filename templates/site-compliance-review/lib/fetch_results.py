"""Read new page captures and the Worker's health from the person's own review Worker. Standard library only.

Usage: python3 lib/fetch_results.py --worker https://review.example.com --site https://www.example.com
       --docs snapshot.json --producer site-compliance-review --max-pages 200 --out results.json
       [--sitemap https://www.example.com/sitemap.xml] [--clef-flag-at PERCENT] [--replay DIR]

The Worker captures pages on its own cron. This script only reads: GET <worker>/summary for the
Worker's health and GET <worker>/results?since=<seq>&limit=<n> for captures newer than the
highest capture number already stored on this producer's page records (so each capture is read
once). It stops at --max-pages captures. A capture whose URL is not https on the --site host is
refused and counted, never kept. The latest capture per URL wins.

Each capture keeps the Worker's Clef result as `clef` ({scores, model, flagAt, asked, inputTokens,
outputTokens, imageSent, imageSkipped?, error?}, or None when Clef was off): scores only for valid rule
ids with a value from 0 to 1, an error cut to 300 characters.
--clef-flag-at PERCENT (1 to 100) first sends the Clef flag line to the Worker (POST <worker>/config
{"clefFlagAt": PERCENT / 100}), so captures made from then on use it. It is never fatal: an absent
option sends nothing, and a refused or failed push is only recorded as `config_push`.
Writes {reachable, error, worker, sitemap_expected, sitemap_matches, results, refused, more, config_push}.
`worker` is the Worker's /summary (queue, sitemap and last batch). If the Worker cannot be reached
or answers with an error, reachable is false, results is empty and the script still exits 0, so
the run can record the problem. Exit 2 only on bad arguments or a malformed snapshot.
The access token is never passed here: the environment's network secret is expected to attach it
to requests for the Worker host (unverified). --replay DIR reads DIR/summary.json and
DIR/results.json instead of the network, for tests.
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

USER_AGENT = "RoutineOS-site-review/1 (read-only monitor)"
MAX_TEXT = 200_000
PAGE_SIZE = 100
RULE_ID = re.compile(r"^[a-z][a-z0-9_]{1,40}$")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """A redirect from the Worker is an error: it could send this script (and its headers) to another host."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_open = urllib.request.build_opener(_NoRedirect).open


def fail(msg):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(2)


def https_origin(raw, label):
    parts = urllib.parse.urlsplit(raw or "")
    if parts.scheme != "https" or not parts.hostname:
        fail(f"--{label} must be an https URL")
    return parts


def cursor_of(docs, producer):
    """The highest capture number stored on this producer's page records, or 0."""
    best = 0
    for path, doc in docs.items():
        if not path.startswith("entities/") or not isinstance(doc, dict):
            continue
        data = doc.get("data") or {}
        values = (data.get("bySource") or {}).get(producer)
        if data.get("type") == "page" and isinstance(values, dict):
            seq = values.get("seq")
            if isinstance(seq, int) and not isinstance(seq, bool) and seq > best:
                best = seq
    return best


def http_call(base):
    def call(path):
        req = urllib.request.Request(base + path, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        with _open(req, timeout=30) as resp:
            return json.loads(resp.read(8 * 1024 * 1024).decode("utf-8"))
    return call


def push_config(base, percent, replay):
    """Sends the flag line to the Worker. Returns {sent, value?, ok?, error?}; never raises."""
    if percent is None:
        return {"sent": False}
    if not number(percent) or not 1 <= percent <= 100:
        return {"sent": False, "error": "clef flag line must be between 1 and 100"}
    value = round(percent / 100, 4)
    if replay:
        return {"sent": True, "value": value, "ok": True}
    try:
        req = urllib.request.Request(base + "/config", data=json.dumps({"clefFlagAt": value}).encode("utf-8"), method="POST",
                                     headers={"User-Agent": USER_AGENT, "Content-Type": "application/json",
                                              "Accept": "application/json"})
        with _open(req, timeout=30) as resp:
            resp.read(64 * 1024)
        return {"sent": True, "value": value, "ok": True}
    except urllib.error.HTTPError as exc:
        return {"sent": True, "value": value, "ok": False, "error": f"HTTP {exc.code}"}
    except (urllib.error.URLError, OSError, ValueError) as exc:
        return {"sent": True, "value": value, "ok": False, "error": str(exc)[:200]}


def replay_call(folder):
    def call(path):
        name = "summary.json" if path.startswith("/summary") else "results.json"
        with open(os.path.join(folder, name), encoding="utf-8") as fh:
            body = json.load(fh)
        if name == "summary.json":
            return body
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(path).query)
        since, limit = int(q["since"][0]), int(q["limit"][0])
        rows = [r for r in body.get("results", []) if isinstance(r, dict) and isinstance(r.get("seq"), int) and r["seq"] > since]
        rows.sort(key=lambda r: r["seq"])
        return {"results": rows[:limit], "more": len(rows) > limit}
    return call


def number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def clean_clef(raw):
    """The Worker's Clef result for one capture, kept only in its documented shape, or None when there is none.
    Scores are kept for valid rule ids with a value from 0 to 1; anything else is dropped."""
    if not isinstance(raw, dict):
        return None
    scores = {k: float(v) for k, v in (raw.get("scores") or {}).items()
              if isinstance(k, str) and RULE_ID.match(k) and number(v) and 0 <= v <= 1} \
        if isinstance(raw.get("scores"), dict) else {}
    flag_at = raw.get("flagAt")
    asked = raw.get("asked") if isinstance(raw.get("asked"), list) else []
    out = {"scores": scores, "model": str(raw.get("model") or "")[:100],
           "flagAt": float(flag_at) if number(flag_at) and 0 < flag_at <= 1 else 0.7,
           "asked": [a for a in asked if isinstance(a, str) and RULE_ID.match(a)][:64],
           "inputTokens": int(raw["inputTokens"]) if number(raw.get("inputTokens")) else None,
           "outputTokens": int(raw["outputTokens"]) if number(raw.get("outputTokens")) else None,
           "imageSent": raw.get("imageSent") is True}
    if isinstance(raw.get("imageSkipped"), str):
        out["imageSkipped"] = raw["imageSkipped"][:200]
    if raw.get("error"):
        out["error"] = str(raw["error"])[:300]
    return out


def clean(row, host):
    """The kept fields of one capture, or None when it is malformed or off the site host."""
    if not isinstance(row, dict) or not isinstance(row.get("url"), str):
        return None
    seq = row.get("seq")
    if not isinstance(seq, int) or isinstance(seq, bool) or seq < 1:
        return None
    parts = urllib.parse.urlsplit(row["url"])
    if parts.scheme != "https" or (parts.hostname or "").lower() != host:
        return None
    rects = []
    for r in row.get("rects") or []:
        if isinstance(r, dict) and all(isinstance(r.get(k), (int, float)) for k in ("left", "top", "width", "height")):
            rects.append({"text": str(r.get("text") or "")[:2000], "left": r["left"], "top": r["top"],
                          "width": r["width"], "height": r["height"]})
    page = row.get("page") if isinstance(row.get("page"), dict) else None
    if page and not all(isinstance(page.get(k), (int, float)) and page[k] > 0 for k in ("width", "height")):
        page = None
    shot = row.get("shot") if isinstance(row.get("shot"), str) and row["shot"].startswith("/shot/") else ""
    return {
        "seq": seq, "url": row["url"], "ok": row.get("ok") is True,
        "status": row.get("status") if isinstance(row.get("status"), int) else None,
        "title": str(row.get("title") or "")[:300], "capturedAt": str(row.get("capturedAt") or "")[:40],
        "error": str(row.get("error") or "")[:200], "text": str(row.get("text") or "")[:MAX_TEXT],
        "rects": rects[:3000], "page": page, "shot": shot, "clef": clean_clef(row.get("clef")),
    }


def collect(call, host, since, max_pages):
    out = {"reachable": False, "error": None, "worker": {}, "results": [], "refused": 0, "more": False}
    try:
        summary = call("/summary")
        out["worker"] = summary if isinstance(summary, dict) else {}
        latest, cursor = {}, since
        while len(latest) < max_pages:
            got = call(f"/results?since={cursor}&limit={min(PAGE_SIZE, max_pages - len(latest))}")
            rows = got.get("results") if isinstance(got, dict) else None
            if not isinstance(rows, list):
                raise ValueError("results is not a list")
            for raw in rows:
                row = clean(raw, host)
                if row is None:
                    out["refused"] += 1
                    if isinstance(raw, dict) and isinstance(raw.get("seq"), int):
                        cursor = max(cursor, raw["seq"])
                    continue
                cursor = max(cursor, row["seq"])
                prev = latest.get(row["url"])
                if prev is None or row["seq"] > prev["seq"]:
                    latest[row["url"]] = row
            out["more"] = bool(got.get("more"))
            if not rows or not out["more"]:
                break
        out["results"] = sorted(latest.values(), key=lambda r: r["seq"])
        out["reachable"] = True
    except urllib.error.HTTPError as exc:
        out["error"] = f"worker answered {exc.code}"
    except (urllib.error.URLError, OSError, ValueError, KeyError, TypeError, AttributeError):
        out["error"] = "worker unreachable or not JSON"
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--worker", required=True)
    ap.add_argument("--site", required=True)
    ap.add_argument("--sitemap")
    ap.add_argument("--docs", required=True)
    ap.add_argument("--producer", required=True)
    ap.add_argument("--max-pages", type=int, default=200)
    ap.add_argument("--out", required=True)
    ap.add_argument("--clef-flag-at", type=float)
    ap.add_argument("--replay")
    args = ap.parse_args()
    worker = https_origin(args.worker, "worker")
    site = https_origin(args.site, "site")
    if args.sitemap:
        https_origin(args.sitemap, "sitemap")
    if not 1 <= args.max_pages <= 2000:
        fail("--max-pages must be between 1 and 2000")
    try:
        with open(args.docs, encoding="utf-8") as fh:
            docs = json.load(fh)
    except (OSError, ValueError):
        fail("cannot read the snapshot as JSON")
    if not isinstance(docs, dict):
        fail("the snapshot must be a JSON object")
    host = site.hostname.lower()
    call = replay_call(args.replay) if args.replay else http_call(f"https://{worker.hostname.lower()}")
    config_push = push_config(f"https://{worker.hostname.lower()}", args.clef_flag_at, args.replay)
    out = collect(call, host, cursor_of(docs, args.producer), args.max_pages)
    out["config_push"] = config_push
    expected = args.sitemap or f"https://{host}/sitemap.xml"
    seen = ((out["worker"].get("sitemap") or {}).get("url")) if isinstance(out["worker"].get("sitemap"), dict) else None
    out["sitemap_expected"] = expected
    out["sitemap_matches"] = (seen == expected) if out["reachable"] else None
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2)
    print(json.dumps({k: out[k] for k in ("reachable", "error", "refused", "more", "sitemap_matches")}
                     | {"captures": len(out["results"])}, indent=2))


if __name__ == "__main__":
    main()
