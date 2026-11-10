"""Queue screenshots on the person's own worker and collect signed links. Standard library only.

Usage: python3 lib/worker_shots.py --worker https://qa-worker.example.workers.dev
       --issues issues.json --max 10 --out shots.json

Only used when fetch_mode is worker. Sends the pages with high or medium issues (at most --max)
to POST <worker>/enqueue; the worker's cron captures them later. Then reads GET <worker>/shots
for links captured on earlier runs: short-lived signed links, so a link in an old record expires.
Writes {shots: {url: https link}, notes: {url: the worker's vision note}}; other links are dropped.
The access token is never passed here: the environment's network secret is expected to attach
it to requests for the worker host (unverified). Any failure writes empty maps and a reason,
and exits 0, so a missing worker never stops the content checks. Exit 2 only on bad arguments.
"""
import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

USER_AGENT = "RoutineOS-content-qa/1 (read-only monitor)"


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


def call(url, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method="POST" if data else "GET",
                                 headers={"User-Agent": USER_AGENT, "Content-Type": "application/json"})
    with _open(req, timeout=20) as resp:
        return json.loads(resp.read(2 * 1024 * 1024).decode("utf-8"))


def collect(base, issues, max_shots, call=call):
    """(shots, notes, status): enqueue pages with high or medium issues, then read the links and notes."""
    urls = []
    for i in issues:
        if isinstance(i, dict) and i.get("severity") in ("high", "medium") and isinstance(i.get("url"), str):
            if i["url"] not in urls:
                urls.append(i["url"])
    shots, notes, status = {}, {}, {"queued": 0, "links": 0, "error": None}
    try:
        if urls[:max_shots]:
            status["queued"] = int(call(f"{base}/enqueue", {"urls": urls[:max_shots]}).get("queued", 0))
        got = call(f"{base}/shots", None)
        links, said = got.get("shots", {}), got.get("notes", {})
        if isinstance(links, dict):
            shots = {u: l for u, l in links.items() if isinstance(u, str) and isinstance(l, str) and l.startswith("https://")}
        if isinstance(said, dict):
            notes = {u: n[:300] for u, n in said.items() if u in shots and isinstance(n, str)}
    except urllib.error.HTTPError as exc:
        status["error"] = f"worker answered {exc.code}"
    except (urllib.error.URLError, OSError, ValueError, AttributeError, TypeError):
        status["error"] = "worker unreachable or not JSON"
    status["links"] = len(shots)
    return shots, notes, status


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0], fromfile_prefix_chars="@")
    ap.add_argument("--worker", required=True)
    ap.add_argument("--issues", required=True)
    ap.add_argument("--max", type=int, default=10)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    parts = urllib.parse.urlsplit(args.worker)
    if not URL_RE.fullmatch(args.worker) or parts.scheme != "https" or not parts.hostname:
        fail("--worker must be a plain https URL")
    if not 0 <= args.max <= 50:
        fail("--max must be between 0 and 50")
    base = f"https://{parts.hostname.lower()}"
    try:
        with open(args.issues, encoding="utf-8") as fh:
            issues = json.load(fh).get("issues", [])
    except (OSError, ValueError, AttributeError):
        fail("cannot read issues as JSON")
    if not isinstance(issues, list):
        fail("issues must hold a list")
    shots, notes, status = collect(base, issues, args.max, call)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump({"shots": shots, "notes": notes}, fh, indent=2)
    print(json.dumps(status, indent=2))


if __name__ == "__main__":
    main()
