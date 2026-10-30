"""Week-over-week change per channel and metric. Standard library only.

Usage: python3 lib/week_over_week.py --this this.json --last last.json

Each file is {channel: {metric: number}}. Prints {channel: {metric: {value, previous, change_pct}}}.
change_pct is the percent change rounded to one place, or null when last week is 0 or absent.
Exit 2 on unreadable or malformed input; values are never echoed.
"""
import argparse
import json
import math
import sys


def fail(msg):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(2)


def number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def load(path, label):
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        fail(f"cannot read {label} as JSON")
    if not isinstance(data, dict):
        fail(f"{label} must be an object of channel to metrics")
    for channel, metrics in data.items():
        if not isinstance(metrics, dict) or not all(number(v) for v in metrics.values()):
            fail(f"{label}: every metric must be a number")
    return data


def compare(this, last):
    out = {}
    for channel in sorted(set(this) | set(last)):
        now, before = this.get(channel, {}), last.get(channel, {})
        out[channel] = {}
        for metric in sorted(set(now) | set(before)):
            value, previous = now.get(metric), before.get(metric)
            change = None
            if value is not None and previous:
                change = round((value - previous) / previous * 100, 1)
            out[channel][metric] = {"value": value, "previous": previous, "change_pct": change}
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--this", required=True, help="this week's metrics JSON")
    ap.add_argument("--last", required=True, help="last week's metrics JSON")
    args = ap.parse_args()
    print(json.dumps(compare(load(args.this, "--this"), load(args.last, "--last")), indent=2))


if __name__ == "__main__":
    main()
