"""Search Console weeks for the weekly report. Standard library only.

Usage: python3 lib/gsc_weeks.py merge --this gsc-this.json --last gsc-last.json [--out-dir .] [--source search]

The two responses are searchAnalytics.query calls for the two weeks from lib/weeks.py (no dimensions, row_limit 1).
merge reads the two saved responses (one totals row each; a response may be
wrapped in "data", "response" or "results") and adds them under the source name to this-week.json and
last-week.json in --out-dir, creating either file when missing (run ga_weeks.py first so it does not overwrite).
Metrics: clicks, impressions, ctr_pct (ctr is a 0 to 1 fraction, so ctr * 100 rounded to 2) and position.
A week with no rows is a quiet week: clicks, impressions and ctr_pct are 0 and position is left out (an average
over no impressions is not a number).
Exit 2 on a missing, unreadable or malformed input; values are never echoed.
"""
import argparse
import json
import math
import os
import sys
from typing import NoReturn

FIELDS = ("clicks", "impressions", "ctr", "position")


def fail(msg) -> NoReturn:
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(2)


def read_json(path, label):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        fail(f"cannot read {label} as JSON")


def write(path, data):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)
        fh.write("\n")


def find_response(node, depth=0):
    if isinstance(node, dict):
        if "responseAggregationType" in node or isinstance(node.get("rows"), list):
            return node
        children = [node.get("data"), node.get("response"), node.get("results")]
    elif isinstance(node, list):
        children = node[:1]
    else:
        return None
    if depth < 6:
        for child in children:
            found = find_response(child, depth + 1)
            if found is not None:
                return found
    return None


def number(v):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        fail("a metric value is not a number")
    return v


def totals(path, label):
    response = find_response(read_json(path, label))
    if response is None:
        fail(f"no searchAnalytics response found in {label}")
    rows = response.get("rows")
    if rows is None:
        return {"clicks": 0, "impressions": 0, "ctr_pct": 0}
    if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict):
        fail(f"{label} must hold one totals row")
    row = rows[0]
    if not all(f in row for f in FIELDS):
        fail(f"{label} totals row is missing a metric")
    clicks, impressions, ctr, position = (number(row[f]) for f in FIELDS)
    return {"clicks": clicks, "impressions": impressions, "ctr_pct": round(ctr * 100, 2), "position": position}


def merge_into(path, source, metrics):
    existing = {}
    if os.path.exists(path):
        existing = read_json(path, os.path.basename(path))
        if not isinstance(existing, dict):
            fail(f"{os.path.basename(path)} must be an object of source to metrics")
    existing[source] = metrics
    write(path, existing)


def merge(args):
    this = totals(args.this, "--this")
    last = totals(args.last, "--last")
    merge_into(os.path.join(args.out_dir, "this-week.json"), args.source, this)
    merge_into(os.path.join(args.out_dir, "last-week.json"), args.source, last)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("merge", help="add the two weekly responses to this-week.json and last-week.json")
    m.add_argument("--this", required=True, help="this week's query response as JSON")
    m.add_argument("--last", required=True, help="last week's query response as JSON")
    m.add_argument("--out-dir", default=".")
    m.add_argument("--source", default="search", help="source name in the output")
    m.set_defaults(run=merge)
    args = ap.parse_args()
    args.run(args)


if __name__ == "__main__":
    main()
