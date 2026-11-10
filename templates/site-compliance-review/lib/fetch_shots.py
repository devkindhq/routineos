"""Download the screenshots of flagged pages from the review Worker. Standard library only.

Usage: python3 lib/fetch_shots.py --worker https://review.example.com --flags flags.json
       --max 10 --out-dir shots --out shots.json [--replay DIR]

For at most --max pages with flags (highest severity first), GET <worker><shot> using the signed,
short-lived /shot/ path from the capture, and save the PNG as <out-dir>/<page id>.png. A file that
is not a PNG or is over 20 MiB is skipped and listed. Writes {shots: {page id: file}, skipped,
error}. The routine then uploads each file as an asset of the Desk and records the asset url, so
the Desk can draw the flag boxes on it.
If the Worker cannot be reached the manifest says so and the script exits 0: the flags still have
their notes, only without the image. Exit 2 only on bad arguments. --replay DIR reads
DIR/<page id>.png instead of the network, for tests.
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
MAX_BYTES = 20 * 1024 * 1024
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
SEV = {"high": 0, "medium": 1, "low": 2}
PAGE_ID = re.compile(r"^page--[0-9a-f]{12}$")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """A redirect from the Worker is an error: it could send this script (and its headers) to another host."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_open = urllib.request.build_opener(_NoRedirect).open


# A URL argument is matched against a character allow-list, so only a plain https address is accepted.
URL_RE = re.compile(r"https://[A-Za-z0-9.-]{1,253}(?::[0-9]{1,5})?(?:/[A-Za-z0-9._~%+/-]{0,300})?(?:\?[A-Za-z0-9._~%+/=-]{0,300})?")


def fail(msg):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(2)


def http_get(base):
    def get(path, _pid):
        req = urllib.request.Request(base + path, headers={"User-Agent": USER_AGENT, "Accept": "image/png"})
        with _open(req, timeout=60) as resp:
            return resp.read(MAX_BYTES + 1)
    return get


def replay_get(folder):
    def get(_path, pid):
        with open(os.path.join(folder, f"{pid}.png"), "rb") as fh:
            return fh.read(MAX_BYTES + 1)
    return get


def wanted(flags_doc, max_pages):
    """[(page id, signed shot path)] for flagged pages with a shot, worst first."""
    worst = {}
    for f in flags_doc.get("flags") or []:
        if isinstance(f, dict) and isinstance(f.get("page_id"), str):
            worst[f["page_id"]] = min(worst.get(f["page_id"], 9), SEV.get(f.get("severity"), 9))
    shots = {p["id"]: p["shot"] for p in flags_doc.get("pages") or []
             if isinstance(p, dict) and isinstance(p.get("shot"), str) and p["shot"].startswith("/shot/")}
    ranked = sorted((pid for pid in worst if pid in shots and PAGE_ID.match(pid)), key=lambda p: (worst[p], p))
    return [(pid, shots[pid]) for pid in ranked[:max_pages]]


def download(flags_doc, max_pages, out_dir, get):
    out = {"shots": {}, "skipped": [], "error": None}
    os.makedirs(out_dir, exist_ok=True)
    for pid, path in wanted(flags_doc, max_pages):
        try:
            data = get(path, pid)
        except urllib.error.HTTPError as exc:
            out["error"] = f"worker answered {exc.code}"
            if exc.code in (401, 403, 503):
                break
            out["skipped"].append(pid)
            continue
        except (urllib.error.URLError, OSError, ValueError):
            out["error"] = "worker unreachable"
            break
        if len(data) > MAX_BYTES or not data.startswith(PNG_MAGIC):
            out["skipped"].append(pid)
            continue
        target = os.path.join(out_dir, f"{pid}.png")
        with open(target, "wb") as fh:
            fh.write(data)
        out["shots"][pid] = target
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0], fromfile_prefix_chars="@")
    ap.add_argument("--worker", required=True)
    ap.add_argument("--flags", required=True)
    ap.add_argument("--max", type=int, default=10)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--replay")
    args = ap.parse_args()
    parts = urllib.parse.urlsplit(args.worker)
    if not URL_RE.fullmatch(args.worker) or parts.scheme != "https" or not parts.hostname:
        fail("--worker must be a plain https URL")
    if not 0 <= args.max <= 50:
        fail("--max must be between 0 and 50")
    try:
        with open(args.flags, encoding="utf-8") as fh:
            flags_doc = json.load(fh)
    except (OSError, ValueError):
        fail("cannot read flags as JSON")
    if not isinstance(flags_doc, dict):
        fail("flags must be a JSON object")
    get = replay_get(args.replay) if args.replay else http_get(f"https://{parts.hostname.lower()}")
    out = download(flags_doc, args.max, args.out_dir, get)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2)
    print(json.dumps({"saved": len(out["shots"]), "skipped": len(out["skipped"]), "error": out["error"]}, indent=2))


if __name__ == "__main__":
    main()
