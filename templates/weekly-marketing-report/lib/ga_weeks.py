"""Turn one Google Analytics runReport response into this-week.json and last-week.json. Standard library only.

Usage: python3 lib/ga_weeks.py --report ga-report.json [--out-dir .] [--source analytics]

The report is one runReport call with two explicit date ranges (this week first, from lib/weeks.py) and no
dimensions, so GA returns two rows marked date_range_0 (this week) and date_range_1 (last week). The response may be
wrapped (a "data" or "response" key, or a "results" list), as connector tools do. Writes:
  this-week.json, last-week.json   {source: {metric: number}}
GA's totalRevenue is named revenue. The week dates come from lib/weeks.py, not from this script.
Exit 2 on a missing, unreadable or malformed report; values are never echoed.
"""
import argparse
import json
import math
import os
import sys
from typing import NoReturn

RENAME = {"totalRevenue": "revenue"}


def fail(msg) -> NoReturn:
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(2)


def find_report(node, depth=0):
    if isinstance(node, dict):
        if isinstance(node.get("rows"), list) and isinstance(node.get("metricHeaders"), list):
            return node
        children = [node.get(k) for k in ("data", "response")] + [node.get("results")]
    elif isinstance(node, list):
        children = node[:1]
    else:
        return None
    if depth < 6:
        for child in children:
            found = find_report(child, depth + 1)
            if found:
                return found
    return None


def number(raw):
    try:
        value = float(raw)
    except (TypeError, ValueError):
        fail("a metric value is not a number")
    if not math.isfinite(value):
        fail("a metric value is not finite")
    return int(value) if value == int(value) else value


def split_weeks(report, source):
    names = [RENAME.get(h.get("name"), h.get("name")) for h in report["metricHeaders"]]
    if not names or not all(isinstance(n, str) and n for n in names):
        fail("report has no metric names")
    weeks = {}
    for row in report["rows"]:
        try:
            marker = row["dimensionValues"][0]["value"]
            values = [m["value"] for m in row["metricValues"]]
        except (KeyError, IndexError, TypeError):
            fail("a report row is malformed")
        if len(values) != len(names):
            fail("a report row does not match the metric names")
        weeks[marker] = {source: dict(zip(names, (number(v) for v in values)))}
    if set(weeks) != {"date_range_0", "date_range_1"}:
        fail("report must hold exactly date_range_0 and date_range_1")
    return weeks["date_range_0"], weeks["date_range_1"]


def write(path, data):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)
        fh.write("\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--report", required=True, help="the runReport response as JSON")
    ap.add_argument("--out-dir", default=".", help="where to write the two files")
    ap.add_argument("--source", default="analytics", help="source name in the output")
    args = ap.parse_args()
    try:
        with open(args.report, encoding="utf-8") as fh:
            raw = json.load(fh)
    except (OSError, ValueError):
        fail("cannot read --report as JSON")
    report = find_report(raw)
    if report is None:
        fail("no runReport response found in --report")
    this, last = split_weeks(report, args.source)
    write(os.path.join(args.out_dir, "this-week.json"), this)
    write(os.path.join(args.out_dir, "last-week.json"), last)


if __name__ == "__main__":
    main()
