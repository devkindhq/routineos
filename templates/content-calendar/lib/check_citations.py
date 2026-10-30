"""Check that a draft's [n] citation markers and its sources match. Standard library only.

Usage: python3 lib/check_citations.py --draft draft.md --sources sources.json

sources.json is a list of {n, url} with whole-number n. Every [n] marker in the draft needs a
source n, every source must be cited at least once, and no n may be listed twice. Prints one line
per problem and exits 1 when there is any; otherwise prints a summary and exits 0. Exit 2 on
unreadable or malformed input.
"""
import argparse
import json
import re
import sys

MARKER_RE = re.compile(r"\[(\d+)\]")


def fail(msg):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(2)


def problems_of(text, sources):
    markers = [int(m) for m in MARKER_RE.findall(text)]
    numbers = [s["n"] for s in sources]
    out = []
    for n in sorted({n for n in numbers if numbers.count(n) > 1}):
        out.append(f"source {n} is listed more than once")
    for n in sorted(set(markers) - set(numbers)):
        out.append(f"marker [{n}] has no source")
    for n in sorted(set(numbers) - set(markers)):
        out.append(f"source {n} is never cited")
    return markers, out


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--draft", required=True)
    ap.add_argument("--sources", required=True)
    args = ap.parse_args()
    try:
        with open(args.draft, encoding="utf-8") as fh:
            text = fh.read()
        with open(args.sources, encoding="utf-8") as fh:
            sources = json.load(fh)
    except (OSError, ValueError):
        fail("cannot read --draft as text or --sources as JSON")
    if not isinstance(sources, list) or not all(
            isinstance(s, dict) and isinstance(s.get("n"), int) and not isinstance(s.get("n"), bool)
            and isinstance(s.get("url"), str) for s in sources):
        fail("--sources must be a list of {n, url} with whole-number n")
    markers, problems = problems_of(text, sources)
    for p in problems:
        print(p)
    if problems:
        sys.exit(1)
    print(f"ok: {len(markers)} markers, {len(sources)} sources")


if __name__ == "__main__":
    main()
