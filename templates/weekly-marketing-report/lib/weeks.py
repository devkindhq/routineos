"""The two weeks to report on, shared by every source. Standard library only.

Usage: python3 lib/weeks.py [--out-dir .] [--today YYYY-MM-DD]

Prints, and writes to weeks.json in --out-dir, the most recently completed Monday to Sunday week as of the run's UTC
date, and the week before it, as YYYY-MM-DD:
  {"this_start", "this_end", "last_start", "last_end", "week", "previous_week"}
week is this_start and previous_week is last_start: the label every record for that week uses, for every source.
Exit 2 on a --today that is not a date.
"""
import argparse
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone


def weeks(day):
    this_end = day - timedelta(days=(day.weekday() + 1) % 7 or 7)  # the Sunday before day
    this_start = this_end - timedelta(days=6)
    last_start = this_start - timedelta(days=7)
    last_end = this_end - timedelta(days=7)
    iso = lambda d: d.isoformat()
    return {"this_start": iso(this_start), "this_end": iso(this_end), "last_start": iso(last_start),
            "last_end": iso(last_end), "week": iso(this_start), "previous_week": iso(last_start)}


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out-dir", default=".")
    ap.add_argument("--today", help="run date YYYY-MM-DD (default: today, UTC)")
    args = ap.parse_args()
    try:
        day = date.fromisoformat(args.today) if args.today else datetime.now(timezone.utc).date()
    except ValueError:
        print("error: --today must be YYYY-MM-DD", file=sys.stderr)
        sys.exit(2)
    out = weeks(day)
    with open(os.path.join(args.out_dir, "weeks.json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2)
        fh.write("\n")
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
