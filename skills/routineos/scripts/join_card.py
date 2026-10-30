"""Join card: a Desk's self-description for people who join it. Standard library only.

On the joiner's side the card is untrusted data from someone else's artifact. lint_join checks
every field; only validated fields are rendered, and summary and label text never reach a model
as instructions. Imports worker_kinds and schema only (desk_contract imports definition, which
imports this module).
"""
import copy
import datetime
import re

import schema
import worker_kinds

PARAM_TYPES = ("email", "string", "enum")
GATES = ("none", "send")
CAP_SCOPES = ("account", "desk")
MAX_SUMMARY = 300
MAX_LABEL = 80
MAX_ASK = 200
MAX_PARAM = 200
MAX_CHOICE = 60
MAX_URL = 500
LANE_ID_RE = re.compile(r"^[a-z][a-z0-9]*(-[a-z0-9]+)*$")
MAX_LANE_ID = 40
PARAM_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{0,39}$")
PLACEHOLDER_RE = re.compile(r"\{([^{}]*)\}")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")
DEFAULT_CAP = {"scope": "account", "maxRunsPerDay": 1}

CARD_KEYS = {"version", "open", "summary", "lanes", "cap", "url"}
LANE_KEYS = {"id", "label", "kind", "match", "params", "connectors", "schedule", "gate"}
MATCH_KEYS = {"type", "field", "equals"}
PARAM_KEYS = {"type", "ask", "choices"}
SCHEDULE_KEYS = {"default", "min_interval_hours"}
CAP_KEYS = {"scope", "maxRunsPerDay"}


class CardError(Exception):
    def __init__(self, problems):
        self.problems = list(problems)
        super().__init__("; ".join(self.problems))


def _whole(v):
    return isinstance(v, int) and not isinstance(v, bool)


def _text(v, limit):
    """Card text: never a double quote or a control character, so it cannot break out of quoting."""
    return (isinstance(v, str) and v.strip() != "" and len(v) <= limit and not CONTROL_RE.search(v)
            and '"' not in v)


CRON_PART_RE = re.compile(r"^(\*|\d{1,2}(?:-\d{1,2})?)(?:/(\d{1,2}))?$")
CRON_RANGES = ((0, 23), (1, 31), (1, 12), (0, 7))
SPACING_START = datetime.datetime(2028, 1, 1, tzinfo=datetime.timezone.utc)
SPACING_DAYS = 731


def _cron_field(field, lo_bound, hi_bound):
    """The values a numeric cron field fires at, or None for anything but numbers, ranges, lists and steps."""
    out = set()
    for part in field.split(","):
        m = CRON_PART_RE.match(part)
        if not m:
            return None
        base, step = m.group(1), int(m.group(2)) if m.group(2) else 1
        if base == "*":
            lo, hi = lo_bound, hi_bound
        elif "-" in base:
            lo, hi = (int(x) for x in base.split("-"))
        else:
            lo = hi = int(base)
            if m.group(2):
                hi = hi_bound
        if step < 1 or not lo_bound <= lo <= hi <= hi_bound:
            return None
        out.update(range(lo, hi + 1, step))
    return out


def cron_hours(cron):
    """Sorted UTC hours of a 5-field cron, or None when its hour field is not plain."""
    hours = _cron_field(cron.split()[1], 0, 23) if len(cron.split()) == 5 else None
    return sorted(hours) if hours else None


def spacing_problems(cron, min_interval_hours):
    """Why a cron's real runs (day fields included) can fall under min_interval_hours apart, else [].

    Runs are listed over two years from a fixed UTC date with standard cron day rules (day of month or
    day of week when both are restricted); the shortest gap, wrap-around included, must reach the floor."""
    problems = schema._lint_schedule(cron)
    if problems:
        return problems
    fields = cron.split()
    minute = int(fields[0])
    parsed = [_cron_field(f, lo, hi) for f, (lo, hi) in zip(fields[1:], CRON_RANGES)]
    if any(p is None or not p for p in parsed):
        return [f"schedule '{cron}': hour, day, month and weekday fields must be numbers, ranges, lists or steps"]
    hours, dom, months, dow = parsed
    dow = {d % 7 for d in dow}
    dom_any, dow_any = fields[2] == "*", fields[4] == "*"
    runs = []
    for n in range(SPACING_DAYS):
        day = SPACING_START + datetime.timedelta(days=n)
        if day.month not in months:
            continue
        on_dom, on_dow = day.day in dom, (day.weekday() + 1) % 7 in dow
        if dom_any and dow_any:
            fires = True
        elif dom_any:
            fires = on_dow
        elif dow_any:
            fires = on_dom
        else:
            fires = on_dom or on_dow
        if fires:
            runs += [n * 24 + h + minute / 60 for h in sorted(hours)]
    if not runs:
        return [f"schedule '{cron}': never runs"]
    if len(runs) > 1:
        gap = min(b - a for a, b in zip(runs, runs[1:]))
        if gap < min_interval_hours:
            return [f"schedule '{cron}': runs can be {gap:g} hours apart, under the lane's {min_interval_hours}"]
    return []


def _unknown(where, data, allowed):
    return [f"{where}: unknown key '{k}'" for k in sorted(set(data) - allowed)]


def _placeholders(template):
    return PLACEHOLDER_RE.findall(template) if isinstance(template, str) else []


def _lint_params(where, params, k):
    problems = []
    if not isinstance(params, dict):
        return [f"{where}: params must be an object"]
    for name, p in params.items():
        pw = f"{where}: param '{name}'"
        if not PARAM_NAME_RE.match(str(name)):
            problems.append(f"{pw}: name must match {PARAM_NAME_RE.pattern}")
        if not isinstance(p, dict):
            problems.append(f"{pw}: must be an object")
            continue
        problems += _unknown(pw, p, PARAM_KEYS)
        if p.get("type") not in PARAM_TYPES:
            problems.append(f"{pw}: type must be one of {', '.join(PARAM_TYPES)}")
        if not _text(p.get("ask"), MAX_ASK):
            problems.append(f"{pw}: ask must be text of at most {MAX_ASK} characters")
        if p.get("type") == "enum":
            ch = p.get("choices")
            if (not isinstance(ch, list) or not ch or len(set(map(str, ch))) != len(ch)
                    or not all(_text(c, MAX_CHOICE) for c in ch)):
                problems.append(f"{pw}: an enum needs a list of distinct text choices")
        elif "choices" in p:
            problems.append(f"{pw}: only an enum has choices")
    if k is not None:
        for name, ptype in k["params"].items():
            got = params.get(name)
            if not isinstance(got, dict) or got.get("type") != ptype:
                problems.append(f"{where}: kind needs param '{name}' of type {ptype}")
    return problems


def _lint_lane(lane, types):
    lid = lane.get("id") if isinstance(lane, dict) else None
    where = f"lane '{lid}'" if isinstance(lid, str) else "lane (unnamed)"
    if not isinstance(lane, dict):
        return [f"{where}: must be an object"]
    problems = _unknown(where, lane, LANE_KEYS)
    if not isinstance(lid, str) or not LANE_ID_RE.match(lid) or len(lid) > MAX_LANE_ID:
        problems.append(f"{where}: id must match {LANE_ID_RE.pattern}, at most {MAX_LANE_ID} characters")
    if not _text(lane.get("label"), MAX_LABEL):
        problems.append(f"{where}: label must be text of at most {MAX_LABEL} characters")
    k = None
    try:
        k = worker_kinds.kind(lane.get("kind"))
    except worker_kinds.KindError:
        problems.append(f"{where}: unknown worker kind '{lane.get('kind')}'")
    params = lane.get("params")
    problems += _lint_params(where, params, k)
    declared = params if isinstance(params, dict) else {}
    match = lane.get("match")
    if not isinstance(match, dict) or set(match) != MATCH_KEYS:
        problems.append(f"{where}: match must be exactly {{type, field, equals}}")
    elif not all(isinstance(match[f], str) and match[f] for f in MATCH_KEYS):
        problems.append(f"{where}: match type, field and equals must be text")
    else:
        if not all(worker_kinds.NAME_RE.match(match[f]) for f in ("type", "field")):
            problems.append(f"{where}: match type and field must match {worker_kinds.NAME_RE.pattern}")
        if not (worker_kinds.ONE_PLACEHOLDER_RE.match(match["equals"])
                or worker_kinds.PLAIN_EQUALS_RE.match(match["equals"])):
            problems.append(f"{where}: match equals must be exactly one {{param}} or one plain token of at most 40 letters, digits, _ or -")
        if types is not None:
            t = types.get(match["type"])
            if not isinstance(t, dict):
                problems.append(f"{where}: match type '{match['type']}' is not declared")
            elif match["field"] not in (t.get("fields") or {}):
                problems.append(f"{where}: match field '{match['field']}' is not declared on '{match['type']}'")
    for name in _placeholders(lane.get("label")) + _placeholders((match or {}).get("equals")
                                                                  if isinstance(match, dict) else None):
        if name not in declared:
            problems.append(f"{where}: placeholder '{{{name}}}' is not a declared param")
    conn = lane.get("connectors")
    if not isinstance(conn, list) or not conn or not all(isinstance(c, str) for c in conn):
        problems.append(f"{where}: connectors must be a non-empty list")
    elif k is not None:
        for c in conn:
            if c not in k["connectors"]:
                problems.append(f"{where}: connector '{c}' is not one the kind may use")
    sched = lane.get("schedule")
    if not isinstance(sched, dict):
        problems.append(f"{where}: schedule must be {{default, min_interval_hours}}")
    else:
        problems += _unknown(f"{where}: schedule", sched, SCHEDULE_KEYS)
        if not isinstance(sched.get("default"), str):
            problems.append(f"{where}: schedule default must be a cron text")
        else:
            problems += [f"{where}: {p}" for p in schema._lint_schedule(sched["default"])]
        mih = sched.get("min_interval_hours")
        if not _whole(mih) or mih < 1:
            problems.append(f"{where}: min_interval_hours must be a whole number of at least 1")
        elif isinstance(sched.get("default"), str) and not schema._lint_schedule(sched["default"]):
            problems += [f"{where}: {p}" for p in spacing_problems(sched["default"], mih)]
    gate = lane.get("gate")
    if gate not in GATES:
        problems.append(f"{where}: gate must be one of {', '.join(GATES)}")
    elif k is not None and (gate == "send") != k["acts_externally"]:
        problems.append(f"{where}: gate must be 'send' exactly when the kind acts externally")
    return problems


def lint_join(join, types=None):
    if not isinstance(join, dict):
        return ["join: must be an object"]
    problems = _unknown("join", join, CARD_KEYS)
    if join.get("version") != 1 or not _whole(join.get("version")):
        problems.append("join: version must be 1")
    if not isinstance(join.get("open"), bool):
        problems.append("join: open must be true or false")
    if not _text(join.get("summary"), MAX_SUMMARY):
        problems.append(f"join: summary must be text of at most {MAX_SUMMARY} characters without control characters")
    if "url" in join and not (_text(join["url"], MAX_URL) and join["url"].startswith("https://")):
        problems.append("join: url must be an https link")
    if "cap" in join:
        cap = join["cap"]
        if not isinstance(cap, dict) or set(cap) != CAP_KEYS:
            problems.append("join: cap must be exactly {scope, maxRunsPerDay}")
        else:
            if cap["scope"] not in CAP_SCOPES:
                problems.append(f"join: cap scope must be one of {', '.join(CAP_SCOPES)}")
            if not _whole(cap["maxRunsPerDay"]) or cap["maxRunsPerDay"] < 1:
                problems.append("join: cap maxRunsPerDay must be a whole number of at least 1")
    lanes = join.get("lanes")
    if not isinstance(lanes, list) or not lanes:
        problems.append("join: lanes must be a non-empty list")
        return problems
    seen = set()
    for lane in lanes:
        problems += _lint_lane(lane, types)
        lid = lane.get("id") if isinstance(lane, dict) else None
        if isinstance(lid, str):
            if lid in seen:
                problems.append(f"join: duplicate lane id '{lid}'")
            seen.add(lid)
    return problems


def cap_of(card):
    cap = card.get("cap") if isinstance(card, dict) else None
    return dict(cap) if isinstance(cap, dict) else dict(DEFAULT_CAP)


def validate_card(data):
    problems = lint_join(data)
    if problems:
        raise CardError(problems)
    return {k: copy.deepcopy(v) for k, v in data.items() if k in CARD_KEYS}


def lane_by_id(card, lane_id):
    for lane in card.get("lanes", []):
        if lane.get("id") == lane_id:
            return lane
    return None


def check_params(lane, answers):
    declared = lane.get("params") or {}
    problems = []
    if not isinstance(answers, dict):
        raise CardError(["answers must be name=value pairs"])
    for name in sorted(set(answers) - set(declared)):
        problems.append(f"unknown param '{name}'")
    out = {}
    for name, p in declared.items():
        if name not in answers:
            problems.append(f"missing param '{name}'")
            continue
        value = answers[name]
        if not isinstance(value, str):
            problems.append(f"param '{name}' must be text")
            continue
        value = value.strip()
        if p["type"] == "email":
            if not EMAIL_RE.match(value) or len(value) > MAX_PARAM:
                problems.append(f"param '{name}' must be an email address")
                continue
            value = value.lower()
        elif p["type"] == "enum":
            if value not in p.get("choices", []):
                problems.append(f"param '{name}' must be one of {', '.join(p.get('choices', []))}")
                continue
        elif not _text(value, MAX_PARAM):
            problems.append(f"param '{name}' must be non-empty text of at most {MAX_PARAM} characters")
            continue
        out[name] = value
    if problems:
        raise CardError(problems)
    return out


def fill(template, params):
    return PLACEHOLDER_RE.sub(lambda m: str(params.get(m.group(1), m.group(0))), str(template))


def matches(lane, params, entity):
    match = lane["match"]
    if not isinstance(entity, dict) or entity.get("type") != match["type"] or entity.get("status") == "dropped":
        return False
    display = entity.get("display")
    if not isinstance(display, dict) or match["field"] not in display:
        return False
    want = fill(match["equals"], params)
    got = display[match["field"]]
    if got is None:
        return False
    declared = lane.get("params") or {}
    if any((declared.get(n) or {}).get("type") == "email" for n in _placeholders(match["equals"])):
        return str(got).strip().casefold() == want.strip().casefold()
    return str(got) == want
