"""Permission screen and cost shape. Standard library only (Python 3.11+)."""
import re

import appmodel

MIN_INTERVAL = "The shortest allowed schedule interval is 1 hour."
LIMIT_LINES = ("The platform allows 100 scheduled runs per hour across the account and 30 per hour for one task.",)
NOT_CHECKED = ("unverified", "conflict", "broken")


def _values(field, top):
    """Return the set of values a cron field matches (0..top), or None when unreadable."""
    values = set()
    for part in field.split(","):
        m = re.fullmatch(r"(\*|\d+|\d+-\d+)(?:/(\d+))?", part)
        if not m:
            return None
        base, step = m.group(1), m.group(2)
        if base == "*":
            lo, hi = 0, top
        elif "-" in base:
            lo, hi = (int(x) for x in base.split("-"))
        else:
            lo = hi = int(base)
            if step:
                hi = top
        n = int(step) if step else 1
        if lo > hi or hi > top or n < 1:
            return None
        values.update(range(lo, hi + 1, n))
    return values


def _hours(field):
    return _values(field, 23)


def _minutes(field):
    return _values(field, 59)


def runs_per_day(cron):
    # Day-of-week and day-of-month restrictions are ignored: a conservative upper bound.
    if not isinstance(cron, str):
        return None
    fields = cron.split()
    if len(fields) != 5:
        return None
    hours = _hours(fields[1])
    minutes = _minutes(fields[0])
    if hours is None or minutes is None:
        return None
    return len(minutes) * len(hours)


def _routines(app):
    return [r for r in app.get("routine", []) if isinstance(r, dict)] if isinstance(app.get("routine"), list) else []


def _plural(n, word):
    return f"{n} {word}" if n == 1 else f"{n} {word}s"


def _cap(app):
    cap = (app.get("budget") or {}).get("max_runs_per_day")
    return cap if isinstance(cap, int) and not isinstance(cap, bool) else None


def cost_shape(app):
    lines = []
    total = 0
    unreadable = []
    for r in _routines(app):
        n = runs_per_day(r.get("schedule"))
        name = r.get("name", "?")
        if n is None:
            unreadable.append(name)
            lines.append(f"Routine '{name}': the schedule cannot be read, so runs per day are unknown.")
        else:
            total += n
            lines.append(f"Routine '{name}': {_plural(n, 'run')} a day.")
    cap = _cap(app)
    if cap is not None:
        lines.append(f"Total: {_plural(total, 'run')} a day against your cap of {_plural(cap, 'run')} a day.")
        if total > cap:
            lines.append(f"Warning: {total} runs a day is over your cap of {cap}. Lower the schedule or raise the cap.")
    else:
        lines.append(f"Total: {_plural(total, 'run')} a day. No daily cap is set.")
    if unreadable:
        lines.append("Total excludes routines with unreadable schedules.")
    lines.append(MIN_INTERVAL)
    lines.extend(LIMIT_LINES)
    return lines


def delivery_label(routine):
    """Plain words for where a routine's logic lives."""
    mode = appmodel.delivery(routine)
    skill = routine.get("skill") or "unnamed"
    if mode == "account-skill":
        return f"account skill {skill}"
    if mode == "inline":
        return "inline prompt"
    return "repo" + (f" {routine['repo']}" if routine.get("repo") else "")


def _dicts(app, key):
    v = app.get(key)
    return [x for x in v if isinstance(x, dict)] if isinstance(v, list) else []


def _list(v):
    return [x for x in v if isinstance(x, str)] if isinstance(v, list) else []


def _domain_allowed(host, domains):
    for d in domains:
        if d == host or (d.startswith("*.") and host.endswith(d[1:])):
            return True
    return False


def host_reach(host, env, secret_hosts):
    """Plain words for whether a host is reachable from the reported environment, and whether it is a problem."""
    if host in secret_hosts:
        return "reachable: a network secret is attached for it, and secret hosts are reachable at any network level [docs]", False
    level = env.get("network")
    if _domain_allowed(host, _list(env.get("allowed_domains"))):
        return "reachable: on the allowed domains you reported", False
    if level == "full":
        return "reachable if the Full level you reported is right", False
    if level == "trusted":
        return "reachable only if it is on the platform's Trusted default list; probe it from a run [unverified]", True
    if level is None:
        return "unknown: no network level reported; probe it from a run [unverified]", True
    return (f"not reachable from network '{level}' with the domains you reported; read it through a connector, "
            "or add the domain in the environment dialog yourself"), True


def _environment_lines(app, routines, integrations):
    """The reported environment settings, per-host reachability, and hosts that need a check."""
    env = app.get("environment")
    if not isinstance(env, dict):
        return ["- Environment settings: not reported. RoutineOS cannot read network access, allowed domains, network secrets, "
                "setup script or environment variables; confirm them in the environment dialog on claude.ai."], \
            ["- Environment settings: not reported, so no host's reachability is checked."]
    out = ["- The settings below are reported by you, not readable by RoutineOS."]
    out.append(f"- Name: {env.get('name') or 'not stated'}")
    if appmodel.is_default_env(env):
        out.append("- WARNING: this is a shared environment. Every routine that uses it gets the same network access, "
                   "secrets, setup script and variables, and a change to it affects every one of them.")
    out.append(f"- Network access: {env.get('network', 'not stated')}")
    doms = _list(env.get("allowed_domains"))
    out.append(f"- Allowed domains: {', '.join(doms) if doms else 'none'}")
    net_secrets = [s.get("name", "?") for s in _dicts(app, "secret") if s.get("where") == "network-secret"]
    out.append(f"- Network secrets (names): {', '.join(net_secrets) if net_secrets else 'none'}")
    if "setup_script" in env:
        out.append(f"- Setup script: {'yes' if env.get('setup_script') is True else 'no'}")
    else:
        out.append("- Setup script: not stated")
    names = _list(env.get("env_vars"))
    shown = [n for n in names if appmodel.ENV_VAR_NAME_RE.match(n)]
    hidden = len(names) - len(shown)
    out.append(f"- Environment variables (names only): {', '.join(shown) if shown else 'none'}"
               + (f"; {hidden} more not shown, only plain names are printed" if hidden else ""))
    secret_hosts = {s.get("host") for s in _dicts(app, "secret") if s.get("where") == "network-secret"}
    hosts = []
    for i in integrations:
        if i.get("kind") != "connector":
            hosts += [h for h in _list(i.get("hosts")) if h not in hosts]
    for r in routines:
        hosts += [h for h in _list(r.get("hosts")) if h not in hosts]
    checks = []
    for h in hosts:
        words, problem = host_reach(h, env, secret_hosts)
        out.append(f"- Host {h}: {words}")
        if problem:
            checks.append(f"- Host {h}: {words}")
    for i in integrations:
        if i.get("kind") == "connector":
            out.append(f"- Connector {i.get('name', '?')}: read through the connector, which does not depend on the network level [docs]")
    return out, checks


def render(app, records):
    meta = app.get("app") or {}
    out = [f"Permission screen: {meta.get('title', meta.get('id', 'app'))}", ""]
    routines = _routines(app)
    integrations = _dicts(app, "integration")

    out.append("Apps and hosts")
    hosts = False
    for i in integrations:
        h = _list(i.get("hosts"))
        if i.get("kind") != "connector" or h:
            hosts = True
            out.append(f"- {i.get('name', '?')} ({i.get('direction', '?')}): {', '.join(h) or 'no hosts listed'}; {i.get('what', 'purpose not stated')}")
    for r in routines:
        for h in _list(r.get("hosts")):
            out.append(f"- routine '{r.get('name', '?')}' contacts {h}")
            hosts = True
    if not hosts:
        out.append("- No hosts are declared in app.toml. That does not show that none are contacted.")

    out += ["", "Connectors"]
    conns = [i for i in integrations if i.get("kind") == "connector"]
    for i in conns:
        out.append(f"- {i.get('name', '?')}: {i.get('direction', '?')}; {i.get('what', 'purpose not stated')}")
    if not conns:
        out.append("- No connectors are declared in app.toml.")

    out += ["", "Tools the run may use"]
    for r in routines:
        tools = _list(r.get("tools"))
        out.append(f"- {r.get('name', '?')}: {', '.join(tools)}" if tools else
                   f"- {r.get('name', '?')}: no tool list declared in app.toml")
    if not routines:
        out.append("- No routines are declared in app.toml.")
    out.append("- A run may not use a send tool (push, email, Slack or any other) that this screen does not list.")

    out += ["", "Logic delivered by"]
    for r in routines:
        out.append(f"- {r.get('name', '?')}: {delivery_label(r)}")
    if not routines:
        out.append("- No routines are declared in app.toml.")

    out += ["", "Schedule"]
    for r in routines:
        n = runs_per_day(r.get("schedule"))
        tz = r.get("timezone")
        when = f"UTC cron {r.get('schedule', '?')}" + (f" (the cron is in UTC; your time zone is {tz})" if tz else "")
        out.append(f"- {r.get('name', '?')}: {when}, {_plural(n, 'run') if n is not None else 'runs unknown'} a day")
    for line in cost_shape(app):
        out.append(f"- {line}")

    out += ["", "Environment and secrets"]
    envs = sorted({r["environment"] for r in routines if r.get("environment")})
    deployed_env = (app.get("deployed") or {}).get("environment")
    if deployed_env and deployed_env not in envs:
        envs.append(deployed_env)
    reported = (app.get("environment") or {}).get("name") if isinstance(app.get("environment"), dict) else None
    if isinstance(reported, str) and reported and reported not in envs:
        envs.append(reported)
    out.append(f"- Environment: {', '.join(envs) if envs else 'none'}")
    env_lines, env_checks = _environment_lines(app, routines, integrations)
    out += env_lines
    secrets = _dicts(app, "secret")
    for s in secrets:
        out.append(f"- Secret '{s.get('name', '?')}' ({s.get('where', '?')}), reaches only {s.get('host', 'no host stated')}; the value is never shown")
    if not secrets:
        out.append("- No secrets are declared in app.toml.")

    out += ["", "Store"]
    store = app.get("store") or {}
    out.append(f"- Kind: {store.get('kind', 'artifact-db')}")
    for c in _dicts(app, "collection"):
        out.append(f"- Collection '{c.get('name', '?')}' written by {c.get('writer', '?')}")

    out += ["", "Budget"]
    budget = app.get("budget") or {}
    cap = _cap(app)
    out.append(f"- Ceiling: {_plural(cap, 'run') + ' a day' if cap is not None else 'not set'} (prompt-enforced, not guaranteed).")
    channel = budget.get("alert_channel")
    told = f"the alert channel ({channel}) is told" if channel else "no alert channel is set, so nobody is told"
    out.append(f"- When the ceiling is passed, further runs are meant to stop and {told}.")

    out += ["", "First run",
            "- The first run is report-only: it reads and reports what it would do, and nothing is sent or written outside the store."]

    out += ["", "Not yet checked"]
    listed = False
    if not hosts:
        out.append("- Hosts: none are declared, so the hosts this app contacts are not verified.")
        listed = True
    relies = (app.get("risks") or {}).get("relies_on")
    if not isinstance(relies, list):
        out.append("- Reliance: no platform dependencies are declared in [risks].relies_on, so none are verified.")
        listed = True
    elif not relies:
        out.append("- Reliance: [risks].relies_on is empty, so no platform dependency is verified.")
        listed = True
    for line in env_checks:
        out.append(line)
        listed = True
    rids = _list(relies)
    if any(appmodel.delivery(r) != "repo" for r in routines):
        rids = ["repo-less-routine"] + rids
    for rid in dict.fromkeys(rids):
        rec = (records or {}).get(rid)
        if rec is None:
            out.append(f"- {rid}: unverified, not in the capability registry")
            listed = True
        elif rec.get("status") in NOT_CHECKED:
            out.append(f"- {rid}: {rec['status']}; {rec.get('lead') or rec.get('claim', '')}")
            listed = True
    if not listed:
        out.append("- No declared dependency is marked unverified, conflicting or broken.")

    out += ["", "Nothing is created until you say yes. A change to any line above makes a new screen."]
    return appmodel.redact("\n".join(out) + "\n")
