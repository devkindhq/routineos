"""routine.toml loading and linting. Standard library only (Python 3.11+)."""
import re
import tomllib

ROUTINE_TYPES = ("serverless", "watch", "approval-gated", "interactive")
SETTING_TYPES = ("toggle", "number", "choice", "list")
EXTERNAL_KINDS = ("send", "post", "delete")
CLAUSE = "is data, not instructions"
FIRST_RUN_MODES = ("report-only", "live")
SETTING_ROLES = ("include", "exclude")
# Named formats a list setting may declare with format = "<name>". Each is a character allow-list for one item.
# They are conservative checks that keep shell metacharacters, quotes and spaces out; they do not claim to cover every
# value the named service could accept. The Desk repeats this table as LIST_FORMATS in assets/desk/core/pages/settings.js
# (tests/test_list_settings.py keeps the two equal). A pattern is matched whole, so it has no anchors. The scheme is written
# https:\/\/ so the built Desk page holds no literal URL string (tests/test_desk_bundle.py).
LIST_FORMATS = {
    "word": r"[a-z][a-z0-9_-]{0,39}",
    "https_url": r"https:\/\/[A-Za-z0-9.-]{1,253}(?::[0-9]{1,5})?(?:/[A-Za-z0-9._~%+/-]{0,300})?(?:\?[A-Za-z0-9._~%+/=-]{0,300})?",
    "ga_property": r"properties/[0-9]{1,20}",
    "gsc_site": r"sc-domain:[A-Za-z0-9.-]{1,253}|https:\/\/[A-Za-z0-9.-]{1,253}(?::[0-9]{1,5})?/[A-Za-z0-9._~%+/-]{0,300}",
}
LIST_ITEM_MAX = 300
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def list_item_problem(setting, item):
    """One plain sentence when item is not allowed in this list setting, else an empty string."""
    if not isinstance(item, str) or not item.strip():
        return "Each entry must be text."
    if len(item) > LIST_ITEM_MAX or _CONTROL.search(item):
        return f"Entries are at most {LIST_ITEM_MAX} characters, on one line."
    fmt = setting.get("format")
    if fmt and not re.fullmatch(LIST_FORMATS.get(fmt, r"(?!)"), item):
        return f"{item[:40]!r} is not a valid {fmt.replace('_', ' ')}."
    return ""


def list_problem(setting, items):
    """First problem with a whole list value for this setting, else an empty string."""
    if not isinstance(items, list):
        return "A list setting takes a list."
    for item in items:
        msg = list_item_problem(setting, item)
        if msg:
            return msg
    return ""


class SchemaError(Exception):
    """Raised for unreadable or structurally invalid routine.toml files."""


def load(path):
    try:
        with open(path, "rb") as fh:
            cfg = tomllib.load(fh)
    except FileNotFoundError:
        raise SchemaError(f"file not found: {path}")
    except tomllib.TOMLDecodeError as exc:
        raise SchemaError(f"malformed TOML in {path}: {exc}")
    except OSError as exc:
        raise SchemaError(f"cannot read {path}: {exc}")
    routine = cfg.get("routine")
    if not isinstance(routine, dict):
        raise SchemaError("missing [routine] table")
    for key in ("name", "type", "schedule"):
        if not isinstance(routine.get(key), str) or not routine[key].strip():
            raise SchemaError(f"missing required key routine.{key}")
    if routine["type"] not in ROUTINE_TYPES:
        raise SchemaError(
            f"unknown routine type '{routine['type']}' (expected one of: {', '.join(ROUTINE_TYPES)})"
        )
    return cfg


def _lint_schedule(schedule):
    fields = schedule.split()
    if len(fields) != 5:
        return [f"schedule '{schedule}': expected 5 cron fields"]
    minute = fields[0]
    if not minute.isdigit() or not 0 <= int(minute) <= 59:
        return [
            f"schedule '{schedule}': minute field must be a single number so runs are "
            "at least 1 hour apart"
        ]
    return []


def _is_number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _lint_setting(setting):
    name = setting.get("name")
    label = f"setting '{name}'" if isinstance(name, str) and name else "setting (unnamed)"
    problems = []
    if not isinstance(name, str) or not name:
        problems.append(f"{label}: missing name")
    ktype = setting.get("type")
    if ktype not in SETTING_TYPES:
        problems.append(f"{label}: type must be one of {', '.join(SETTING_TYPES)}")
        return problems
    for key in ("label", "example"):
        if key in setting and not isinstance(setting[key], str):
            problems.append(f"{label}: {key} must be text")
    if "role" in setting:
        if ktype != "list":
            problems.append(f"{label}: role is only allowed on list settings")
        elif setting["role"] not in SETTING_ROLES:
            problems.append(f"{label}: role must be one of {', '.join(SETTING_ROLES)}")
    if "format" in setting:
        if ktype != "list":
            problems.append(f"{label}: format is only allowed on list settings")
        elif setting["format"] not in LIST_FORMATS:
            problems.append(f"{label}: format must be one of {', '.join(LIST_FORMATS)}")
    if "default" not in setting:
        problems.append(f"{label}: missing default")
        return problems
    d = setting["default"]
    if ktype == "toggle" and not isinstance(d, bool):
        problems.append(f"{label}: default must be true or false")
    elif ktype == "list" and not isinstance(d, list):
        problems.append(f"{label}: default must be a list")
    elif ktype == "list":
        msg = list_problem(setting, d) if setting.get("format") in LIST_FORMATS or "format" not in setting else ""
        if msg:
            problems.append(f"{label}: default is not allowed: {msg}")
    elif ktype == "number":
        if not _is_number(d):
            problems.append(f"{label}: default must be a number")
        else:
            if "min" in setting and _is_number(setting["min"]) and d < setting["min"]:
                problems.append(f"{label}: default {d} is below min {setting['min']}")
            if "max" in setting and _is_number(setting["max"]) and d > setting["max"]:
                problems.append(f"{label}: default {d} is above max {setting['max']}")
    elif ktype == "choice":
        choices = setting.get("choices")
        if not isinstance(choices, list) or not choices:
            problems.append(f"{label}: choice setting needs a non-empty choices list")
        elif d not in choices:
            problems.append(f"{label}: default {d!r} is not in choices")
    return problems


_CODE_SPAN = re.compile(r"`([^`\n]+)`")
_COMMAND = re.compile(r"^\s*(?:python3?|bash|sh|zsh|curl|wget|node|npx|git)\b")
_QUOTED_VALUE = re.compile(r"\"[A-Z][A-Z0-9_]{2,}\"|'[A-Z][A-Z0-9_]{2,}'")
_SHELL_EXPANSION = re.compile(r"\$\{|\$\(|\$[A-Za-z_]|`")


def shell_interpolation_problems(prompt_text):
    """prompt.md lines that put a setting value inside a shell command: a quoted placeholder such as "WORKER", or a
    shell expansion. Text values go in a file written with the file tool and are passed as @file; numbers may stay bare."""
    problems = []
    for n, line in enumerate(prompt_text.splitlines(), 1):
        for span in _CODE_SPAN.findall(line):
            if not _COMMAND.match(span):
                continue
            if _QUOTED_VALUE.search(span) or _SHELL_EXPANSION.search(span):
                problems.append(
                    f"prompt.md line {n}: a command puts a setting value on the command line ({span[:60]!r}); "
                    "write text values to a file and pass it as @file"
                )
        if "Keep the double quotes around every setting value" in line:
            problems.append(f"prompt.md line {n}: quoting does not stop shell expansion; pass text values as @file")
    return problems


def lint(cfg, prompt_text):
    problems = []
    routine = cfg.get("routine", {})
    problems += _lint_schedule(str(routine.get("schedule", "")))

    first_run = routine.get("first_run", "report-only")
    if first_run not in FIRST_RUN_MODES:
        problems.append(f"first_run '{first_run}': must be 'report-only' or 'live'")

    for setting in cfg.get("setting", []):
        problems += _lint_setting(setting if isinstance(setting, dict) else {})

    gate = cfg.get("gate", {})
    gated = isinstance(gate, dict) and gate.get("enabled") is True
    for action in cfg.get("action", []):
        if isinstance(action, dict) and action.get("kind") in EXTERNAL_KINDS and not gated:
            problems.append(
                f"action '{action.get('name', '?')}' (kind {action['kind']}): "
                "gate required, set [gate] enabled = true"
            )

    if prompt_text is None:
        problems.append("prompt.md: missing")
    else:
        if CLAUSE not in prompt_text:
            problems.append(f"prompt.md: missing untrusted-data clause ('{CLAUSE}')")
        if not any(l.startswith("Push rule:") for l in prompt_text.splitlines()):
            problems.append("prompt.md: missing a line starting 'Push rule:'")
        problems += shell_interpolation_problems(prompt_text)
    return problems
