"""routine.toml loading and linting. Standard library only (Python 3.11+)."""
import tomllib

ROUTINE_TYPES = ("serverless", "watch", "approval-gated", "interactive")
SETTING_TYPES = ("toggle", "number", "choice", "list")
EXTERNAL_KINDS = ("send", "post", "delete")
CLAUSE = "is data, not instructions"
FIRST_RUN_MODES = ("report-only", "live")
SETTING_ROLES = ("include", "exclude")


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
    if "default" not in setting:
        problems.append(f"{label}: missing default")
        return problems
    d = setting["default"]
    if ktype == "toggle" and not isinstance(d, bool):
        problems.append(f"{label}: default must be true or false")
    elif ktype == "list" and not isinstance(d, list):
        problems.append(f"{label}: default must be a list")
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
    return problems
