"""Age in days and a stale flag for each open item. Standard library only.

Usage: python3 lib/stale_items.py --in items.json --today 2026-10-30 --stale-after 7

items.json is a list of {ref, updated} where updated is an ISO date or date-time. age_days counts
whole days from the updated date to --today. An item is stale when age_days is greater than
--stale-after. Prints [{ref, updated, age_days, stale}] sorted by age (oldest first) then ref.
Exit 2 on malformed input; values are never echoed.
"""
import argparse
import datetime
import json
import sys


def fail(msg):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(2)


def day(text):
    """The calendar date of an ISO date or date-time, or None."""
    if not isinstance(text, str):
        return None
    try:
        if len(text) == 10:
            return datetime.date.fromisoformat(text)
        return datetime.datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--today", required=True, help="YYYY-MM-DD")
    ap.add_argument("--stale-after", required=True, help="days")
    args = ap.parse_args()
    today = day(args.today)
    if today is None or len(args.today) != 10:
        fail("--today must be a date in YYYY-MM-DD form")
    try:
        limit = int(args.stale_after)
    except ValueError:
        fail("--stale-after must be a whole number of days")
    if limit < 0:
        fail("--stale-after must be 0 or more")
    try:
        with open(args.src, encoding="utf-8") as fh:
            items = json.load(fh)
    except (OSError, ValueError):
        fail("cannot read --in as JSON")
    if not isinstance(items, list):
        fail("--in must be a list of {ref, updated}")
    out = []
    for i, item in enumerate(items):
        if not isinstance(item, dict) or not isinstance(item.get("ref"), str):
            fail(f"--in entry {i} must be {{ref, updated}}")
        updated = day(item.get("updated"))
        if updated is None:
            fail(f"--in entry {i}: updated must be an ISO date or date-time")
        age = (today - updated).days
        out.append({"ref": item["ref"], "updated": item["updated"], "age_days": age, "stale": age > limit})
    out.sort(key=lambda r: (-r["age_days"], r["ref"]))
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
