"""app.toml loading, linting and status derivation. Standard library only (Python 3.11+)."""
import os
import re
import tomllib

import schema

STATUSES = ("not live", "live, not yet tested", "live and tested", "retired")
SECRET_PATTERNS = (
    re.compile(r"sk-[A-Za-z0-9_-]{20,}"),
    re.compile(r"AKIA[0-9A-Z]{16}"),
    re.compile(r"AIza[0-9A-Za-z_-]{35}"),
    re.compile(r"ya29\.[0-9A-Za-z_-]{20,}"),
)
PREFIX = "app.toml: "
DELIVERY_MODES = ("repo", "account-skill", "inline")
SKILL_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
UPLOAD_KEYS = ("name", "description", "license", "compatibility", "metadata", "allowed-tools")
MAX_SKILL_DESCRIPTION = 1536
NETWORK_LEVELS = ("none", "trusted", "limited", "full", "custom")
ENV_VAR_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class AppError(Exception):
    """Raised for unreadable or structurally invalid app.toml files."""


def load(path):
    try:
        with open(path, "rb") as fh:
            app = tomllib.load(fh)
    except FileNotFoundError:
        raise AppError(f"file not found: {path}")
    except tomllib.TOMLDecodeError as exc:
        raise AppError(f"malformed TOML in {path}: {exc}")
    except OSError as exc:
        raise AppError(f"cannot read {path}: {exc}")
    table = app.get("app")
    if not isinstance(table, dict):
        raise AppError("missing [app] table")
    for key in ("id", "title", "status"):
        if not isinstance(table.get(key), str) or not table[key].strip():
            raise AppError(f"missing required key app.{key}")
    return app


def _dicts(value):
    return [v for v in value if isinstance(v, dict)] if isinstance(value, list) else []


def _strings(value):
    return [v for v in value if isinstance(v, str)] if isinstance(value, list) else []


def _scan_secrets(node, path, out):
    if isinstance(node, str):
        if any(p.search(node) for p in SECRET_PATTERNS):
            out.append(f"{PREFIX}{path}: looks like a secret value, remove it")
    elif isinstance(node, dict):
        for key, val in node.items():
            _scan_secrets(val, f"{path}.{key}" if path else str(key), out)
    elif isinstance(node, list):
        for i, val in enumerate(node):
            _scan_secrets(val, f"{path}[{i}]", out)


def delivery(routine):
    """The delivery mode of a routine; repo when not stated."""
    value = routine.get("delivery")
    return value if isinstance(value, str) else "repo"


def _delivery_problems(app, routines):
    out = []
    deployed_repo = (app.get("deployed") or {}).get("repo")
    for r in routines:
        rname = r.get("name", "?")
        if "delivery" in r:
            mode = r["delivery"]
            if mode not in DELIVERY_MODES:
                out.append(f"{PREFIX}routine '{rname}': unknown delivery '{mode}', use one of {', '.join(DELIVERY_MODES)}")
                continue
        else:
            mode = "repo"
        skill = r.get("skill")
        if "skill" in r and (not isinstance(skill, str) or not SKILL_NAME_RE.match(skill)):
            out.append(f"{PREFIX}routine '{rname}': skill must be a lowercase name with letters, digits and hyphens")
        elif mode == "account-skill" and not skill:
            out.append(f"{PREFIX}routine '{rname}': delivery 'account-skill' needs a skill name")
        if mode == "repo" and "delivery" in r and not (r.get("repo") or deployed_repo):
            out.append(f"{PREFIX}routine '{rname}': delivery 'repo' needs a repo, set repo = 'owner/name' on the routine")
    return out


def is_default_env(env):
    """True when the [environment] table names the shared Default environment or says it is shared."""
    return env.get("shared") is True or str(env.get("name", "")).strip().lower() == "default"


def _environment_problems(app):
    """Checks for the optional [environment] table. Values are never echoed back."""
    if "environment" not in app:
        return []
    env = app["environment"]
    p = f"{PREFIX}[environment]"
    if not isinstance(env, dict):
        return [f"{p} must be a table"]
    out = []
    if "name" in env and (not isinstance(env["name"], str) or not env["name"].strip()):
        out.append(f"{p}.name must be text")
    if "network" in env and env["network"] not in NETWORK_LEVELS:
        out.append(f"{p}.network must be one of {', '.join(NETWORK_LEVELS)}")
    for key in ("setup_script", "shared"):
        if key in env and not isinstance(env[key], bool):
            out.append(f"{p}.{key} must be true or false")
    if "allowed_domains" in env:
        doms = env["allowed_domains"]
        if not isinstance(doms, list) or not all(isinstance(x, str) and x.strip() for x in doms):
            out.append(f"{p}.allowed_domains must be a list of host names")
    if "env_vars" in env:
        names = env["env_vars"]
        if not isinstance(names, list) or not all(isinstance(x, str) for x in names):
            out.append(f"{p}.env_vars must be a list of variable names")
        else:
            for i, name in enumerate(names):
                if not ENV_VAR_NAME_RE.match(name):
                    out.append(f"{p}.env_vars[{i}]: names only, never values; remove the value")
    return out


def _frontmatter(text):
    """Top-level frontmatter keys mapped to their value text, or None when there is no frontmatter."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return None
    keys = {}
    current = None
    for line in lines[1:]:
        if line.strip() == "---":
            return keys
        m = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", line)
        if m:
            current = m.group(1)
            keys[current] = m.group(2)
        elif current is not None and line.strip():
            keys[current] += " " + line.strip()
    return None


def skill_problems(app, d):
    """Skill checks for routines that name a skill whose SKILL.md is in the app folder."""
    out = []
    for r in _dicts(app.get("routine")):
        skill = r.get("skill")
        if not isinstance(skill, str) or not SKILL_NAME_RE.match(skill):
            continue
        rname = r.get("name", "?")
        for base in ("skills", os.path.join(".claude", "skills")):
            rel = os.path.join(base, skill, "SKILL.md")
            path = os.path.join(d, rel)
            if not os.path.isfile(path):
                continue
            try:
                with open(path, encoding="utf-8") as fh:
                    fm = _frontmatter(fh.read())
            except (OSError, UnicodeDecodeError):
                continue
            if fm is None:
                continue
            if delivery(r) == "account-skill":
                extra = sorted(k for k in fm if k not in UPLOAD_KEYS)
                if extra:
                    out.append(f"{rel}: frontmatter key(s) {', '.join(extra)} not allowed in an uploaded skill, allowed are {', '.join(UPLOAD_KEYS)}")
            desc = fm.get("description", "")
            if len(desc) > MAX_SKILL_DESCRIPTION:
                out.append(f"{rel}: description is {len(desc):,} characters, over the {MAX_SKILL_DESCRIPTION:,} limit (routine '{rname}')")
    return out


def secret_problems(app):
    """Secret-shaped values in the manifest, reported by key path only."""
    out = []
    _scan_secrets(app, "", out)
    return out


SCAN_EXTENSIONS = (".md", ".toml", ".py", ".json", ".txt", ".yaml", ".yml", ".js", ".sh")
SKIP_DIRS = ("__pycache__", ".git", "node_modules", "dashboard")


def scan_dir(d):
    """Secret-shaped values in the other files of an app folder, reported as file:line only, never the value."""
    out = []
    for root, dirs, files in os.walk(d):
        dirs[:] = sorted(n for n in dirs if n not in SKIP_DIRS)
        for fname in sorted(files):
            path = os.path.join(root, fname)
            rel = os.path.relpath(path, d)
            if rel == "app.toml" or not fname.endswith(SCAN_EXTENSIONS):
                continue
            try:
                with open(path, encoding="utf-8") as fh:
                    lines = fh.read().splitlines()
            except (OSError, UnicodeDecodeError):
                continue
            for n, line in enumerate(lines, 1):
                if any(p.search(line) for p in SECRET_PATTERNS):
                    out.append(f"{rel}:{n}: looks like a secret value, remove it")
    return out


def redact(text):
    """Replace secret-shaped values in text."""
    for p in SECRET_PATTERNS:
        text = p.sub("[redacted]", text)
    return text


def lint(app):
    problems = []
    routines = _dicts(app.get("routine"))
    collections = _dicts(app.get("collection"))
    integrations = _dicts(app.get("integration"))

    declared = {i.get("name") for i in integrations}
    declared_hosts = {h for i in integrations for h in _strings(i.get("hosts"))}
    for r in routines:
        rname = r.get("name", "?")
        for c in _strings(r.get("connectors")):
            if c not in declared:
                problems.append(f"{PREFIX}routine '{rname}' uses connector '{c}' which is not declared in [[integration]]")
        for h in _strings(r.get("hosts")):
            if h not in declared_hosts and not any(p.search(h) for p in SECRET_PATTERNS):
                problems.append(f"{PREFIX}routine '{rname}' uses host '{h}' which is not declared in [[integration]]")

    writers = {}
    for c in collections:
        writers.setdefault(c.get("name"), []).append(c.get("writer"))
    for name, ws in writers.items():
        if len(ws) > 1:
            problems.append(f"{PREFIX}collection '{name}' has more than one writer")
    for r in routines:
        rname = r.get("name", "?")
        for coll in _strings(r.get("writes")):
            if rname not in writers.get(coll, []):
                problems.append(f"{PREFIX}routine '{rname}' writes collection '{coll}' but does not own it, add [[collection]] name = '{coll}' writer = '{rname}' to app.toml")

    for i in integrations:
        if i.get("direction") == "write" and i.get("gate") is not True:
            problems.append(f"{PREFIX}integration '{i.get('name', '?')}' writes externally, set gate = true")

    for s in _dicts(app.get("secret")):
        if s.get("where") == "env-var":
            problems.append(f"{PREFIX}secret '{s.get('name', '?')}': secrets are never stored in an env var")

    problems += _delivery_problems(app, routines)
    problems += _environment_problems(app)
    for r in routines:
        if "tools" in r and (not isinstance(r["tools"], list) or not all(isinstance(t, str) for t in r["tools"])):
            problems.append(f"{PREFIX}routine '{r.get('name', '?')}': tools must be a list of tool names")
    problems += secret_problems(app)

    status = (app.get("app") or {}).get("status")
    ids = (app.get("deployed") or {}).get("routine_ids")
    if status in ("live, not yet tested", "live and tested") and not ids:
        problems.append(f"{PREFIX}status '{status}' needs [deployed].routine_ids to be non-empty")

    for r in routines:
        rname = r.get("name", "?")
        sched = r.get("schedule")
        if isinstance(sched, str):
            problems += [f"{PREFIX}routine '{rname}': {p}" for p in schema._lint_schedule(sched)]
        elif sched is not None:
            problems.append(f"{PREFIX}routine '{rname}': schedule must be text")

    risks = app.get("risks")
    if isinstance(risks, dict) and "relies_on" in risks:
        ro = risks["relies_on"]
        if not isinstance(ro, list) or not all(isinstance(x, str) for x in ro):
            problems.append(f"{PREFIX}[risks].relies_on must be a list of capability ids")

    budget = app.get("budget")
    if not isinstance(budget, dict) or "max_runs_per_day" not in budget:
        problems.append(f"{PREFIX}missing [budget].max_runs_per_day")
    else:
        cap = budget["max_runs_per_day"]
        if isinstance(cap, bool) or not isinstance(cap, int) or cap < 1:
            problems.append(f"{PREFIX}[budget].max_runs_per_day must be a whole number of 1 or more")
    return problems


def derive_status(app, verified):
    if (app.get("app") or {}).get("status") == "retired":
        return "retired"
    if not (app.get("deployed") or {}).get("routine_ids"):
        return "not live"
    return "live and tested" if verified else "live, not yet tested"
