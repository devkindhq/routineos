"""Say whether this routine may run again today, from the runs already in the Desk. Standard library only.

Usage: python3 lib/budget_check.py --docs snapshot.json --producer site-compliance-review
       --max-runs 2 [--today 2026-01-31]

Counts this producer's runs/ documents whose startedAt falls on today's date (UTC, or --today)
and prints {runs_today, max_runs, allowed}. allowed is false when runs_today has reached
--max-runs. A run that is stopped by this check writes nothing, so it does not count against the
next one. Always exits 0 on a readable snapshot; exit 2 on bad arguments or a malformed snapshot.
"""
import argparse
import datetime
import json
import re
import sys

DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def fail(msg):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(2)


def runs_on(docs, producer, day):
    n = 0
    for path, doc in docs.items():
        if not path.startswith("runs/") or not isinstance(doc, dict):
            continue
        data = doc.get("data") or {}
        if data.get("producer") == producer and str(data.get("startedAt") or "").startswith(day):
            n += 1
    return n


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--docs", required=True)
    ap.add_argument("--producer", required=True)
    ap.add_argument("--max-runs", type=int, required=True)
    ap.add_argument("--today")
    args = ap.parse_args()
    if not 1 <= args.max_runs <= 24:
        fail("--max-runs must be between 1 and 24")
    day = args.today or datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    if not DAY.match(day):
        fail("--today must be YYYY-MM-DD")
    try:
        with open(args.docs, encoding="utf-8") as fh:
            docs = json.load(fh)
    except (OSError, ValueError):
        fail("cannot read the snapshot as JSON")
    if not isinstance(docs, dict):
        fail("the snapshot must be a JSON object")
    n = runs_on(docs, args.producer, day)
    print(json.dumps({"runs_today": n, "max_runs": args.max_runs, "allowed": n < args.max_runs}, indent=2))


if __name__ == "__main__":
    main()
