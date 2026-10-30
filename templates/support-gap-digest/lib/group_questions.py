"""Group repeated support questions by a normalised form. Standard library only.

Usage: python3 lib/group_questions.py --in questions.json

Input is a list of {ref, text}. The normalised form is case-folded, with punctuation removed and
whitespace collapsed. Prints a list of {key, count, refs, example}, sorted by count (highest first)
then key. A question that normalises to nothing is left out. Exit 2 on malformed input.
"""
import argparse
import json
import re
import sys

PUNCT_RE = re.compile(r"[^\w\s]")
SPACE_RE = re.compile(r"\s+")


def fail(msg):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(2)


def normalise(text):
    return SPACE_RE.sub(" ", PUNCT_RE.sub(" ", text.casefold())).strip()


def group(questions):
    groups = {}
    for q in questions:
        key = normalise(q["text"])
        if not key:
            continue
        g = groups.setdefault(key, {"key": key, "count": 0, "refs": [], "example": q["text"]})
        g["count"] += 1
        g["refs"].append(q["ref"])
    return sorted(groups.values(), key=lambda g: (-g["count"], g["key"]))


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--in", dest="src", required=True, help="questions JSON: a list of {ref, text}")
    args = ap.parse_args()
    try:
        with open(args.src, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        fail("cannot read --in as JSON")
    if not isinstance(data, list) or not all(
            isinstance(q, dict) and isinstance(q.get("ref"), str) and isinstance(q.get("text"), str) for q in data):
        fail("--in must be a list of {ref, text} with text values")
    print(json.dumps(group(data), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
