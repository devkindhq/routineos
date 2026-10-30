"""Score candidates against a weighted rubric, 0 to 100. Standard library only. It never rejects anyone.

Usage: python3 lib/score_rubric.py --criteria criteria.json --marks marks.json

criteria.json is {criterion: weight} with positive weights. marks.json is a list of
{ref, marks: {criterion: met|partly|not}}; met counts 1, partly 0.5, not 0. Every criterion needs a
mark, and a mark for an unknown criterion or an unknown mark value is an error. The score is the
weighted share rounded half up to a whole number. Prints [{ref, score}] sorted by score (highest
first) then ref. Exit 2 on malformed input.
"""
import argparse
import json
import math
import sys

VALUES = {"met": 1.0, "partly": 0.5, "not": 0.0}


def fail(msg):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(2)


def load(path, label):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        fail(f"cannot read {label} as JSON")


def score(criteria, marks):
    total = sum(criteria.values())
    got = sum(weight * VALUES[marks[name]] for name, weight in criteria.items())
    return math.floor(got / total * 100 + 0.5)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--criteria", required=True)
    ap.add_argument("--marks", required=True)
    args = ap.parse_args()
    criteria = load(args.criteria, "--criteria")
    if not isinstance(criteria, dict) or not criteria or not all(
            isinstance(w, (int, float)) and not isinstance(w, bool) and math.isfinite(w) and w > 0
            for w in criteria.values()):
        fail("--criteria must be an object of criterion to a positive weight")
    rows = load(args.marks, "--marks")
    if not isinstance(rows, list):
        fail("--marks must be a list of {ref, marks}")
    out = []
    for i, row in enumerate(rows):
        if not isinstance(row, dict) or not isinstance(row.get("ref"), str) or not isinstance(row.get("marks"), dict):
            fail(f"--marks entry {i} must be {{ref, marks}}")
        marks = row["marks"]
        if set(marks) != set(criteria):
            fail(f"--marks entry {i} must mark every criterion and no others")
        if not all(m in VALUES for m in marks.values()):
            fail(f"--marks entry {i} has a mark that is not met, partly or not")
        out.append({"ref": row["ref"], "score": score(criteria, marks)})
    out.sort(key=lambda r: (-r["score"], r["ref"]))
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
