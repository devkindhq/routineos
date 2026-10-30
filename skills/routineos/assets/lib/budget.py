"""Daily run budget for a routine. Pure functions plus a small CLI, standard library only.

State is the `state/budget` document: {"days": {"YYYY-MM-DD": {"runs": int, "steps": int, "tokens": int | None}}}.

CLI (run it as a script; `python3 -I` works because nothing is imported from the working directory):
    python3 budget.py decide --max-runs N [--state FILE|-] [--also FILE ...] [--today YYYY-MM-DD]
    python3 budget.py record --steps N [--tokens N] [--state FILE|-] [--today YYYY-MM-DD] [--out FILE]
Omit --state when `state/budget` does not exist yet. --state - reads stdin. The state may be the
document itself or an object holding it under "data". --today defaults to today's UTC date.
--also (decide only) adds other writers' counters on a Desk whose cap is per Desk; their runs are summed.
Both print JSON; record also writes the new state to --out, ready for an ArtifactData set (file_path).
"""
import argparse
import copy
import datetime
import json
import re
import sys


DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _count(v):
    return isinstance(v, int) and not isinstance(v, bool) and v >= 0


def valid(state):
    """Whether state is an absent or well-formed counter: every day's runs and steps a non-negative int.
    A worker's counter lives in a Desk doc its joiner can write, so it is never trusted unchecked."""
    if not state:
        return state in ({}, None)
    if not isinstance(state, dict) or set(state) - {"days"} or not isinstance(state.get("days", {}), dict):
        return False
    for day, v in state.get("days", {}).items():
        if not DAY_RE.match(str(day)) or not isinstance(v, dict) or not _count(v.get("runs", 0)):
            return False
        if not _count(v.get("steps", 0)) or not (v.get("tokens") is None or _count(v["tokens"])):
            return False
    return True


def _runs(state, today):
    return ((state or {}).get("days") or {}).get(today, {}).get("runs", 0)


def decide(state, today, max_runs, others=None):
    """Whether another run is allowed today: {"allow": bool, "runs": int, "reason": str}.

    others: the other writers' counters on a Desk capped per Desk; today's runs are summed over all.
    An invalid own counter refuses the run; an invalid other counter is skipped, so one writer cannot
    block the rest by writing garbage.
    """
    if not valid(state):
        return {"allow": False, "runs": 0, "reason": "the run counter is not valid; no run until it is fixed"}
    runs = _runs(state, today)
    if others is not None:
        runs += sum(_runs(o, today) for o in others if valid(o))
        if runs >= max_runs:
            return {"allow": False, "runs": runs, "reason": f"Daily cap reached for this Desk ({runs} of {max_runs} runs)"}
        return {"allow": True, "runs": runs, "reason": f"{runs} of {max_runs} runs used on this Desk"}
    if runs >= max_runs:
        return {"allow": False, "runs": runs, "reason": f"daily cap reached ({runs} of {max_runs} runs)"}
    return {"allow": True, "runs": runs, "reason": f"{runs} of {max_runs} runs used"}


def record(state, today, steps, tokens=None):
    """A new state with today's runs and steps incremented; tokens summed when given, else left as is."""
    new = copy.deepcopy(state) if state else {}
    day = new.setdefault("days", {}).setdefault(today, {"runs": 0, "steps": 0, "tokens": None})
    day["runs"] += 1
    day["steps"] += steps
    if tokens is not None:
        day["tokens"] = (day["tokens"] or 0) + tokens
    return new


def _load_state(path):
    if not path:
        return {}
    if path == "-":
        obj = json.load(sys.stdin)
    else:
        with open(path, encoding="utf-8") as fh:
            obj = json.load(fh)
    if not isinstance(obj, dict):
        raise ValueError("state must be a JSON object")
    if "days" not in obj and isinstance(obj.get("data"), dict):
        obj = obj["data"]
    return obj


def main(argv=None):
    p = argparse.ArgumentParser(prog="budget.py")
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("decide", "record"):
        s = sub.add_parser(name)
        s.add_argument("--state", help="state/budget JSON file, or - for stdin; omit when the doc does not exist")
        s.add_argument("--today", help="YYYY-MM-DD (default today's UTC date)")
        if name == "decide":
            s.add_argument("--max-runs", type=int, required=True)
            s.add_argument("--also", nargs="+", default=None, help="other writers' counter files (Desk-wide cap)")
        else:
            s.add_argument("--steps", type=int, required=True)
            s.add_argument("--tokens", type=int)
            s.add_argument("--out", help="also write the new state to this file")
    args = p.parse_args(argv)
    today = args.today or datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
    try:
        state = _load_state(args.state)
        if args.cmd == "decide":
            others = [_load_state(f) for f in args.also] if args.also else None
            result = decide(state, today, args.max_runs, others)
        else:
            result = record(state, today, args.steps, args.tokens)
            if args.out:
                with open(args.out, "w", encoding="utf-8") as fh:
                    json.dump(result, fh, indent=2, sort_keys=True)
    except (OSError, ValueError, AttributeError, TypeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
