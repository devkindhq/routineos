"""definition.json loading, linting and compiling into meta/definition. Standard library only."""
import hashlib
import json
import re

import join_card

FIELD_TYPES = ("text", "number", "date", "url", "choice", "list", "bool")
MERGE_POLICIES = ("merge", "separate")
NAME_RULES = ("domain", "name")
# What a view can name, matching the Desk: BROWSE_META in browse.js and readFilterState's keys.
VIEW_META_FIELDS = ("lastSeen", "firstSeen", "seenCount", "status", "dropReason")
VIEW_FILTER_KEYS = ("q", "status", "starred", "tag", "source", "reason", "fields")
VIEW_STATUSES = ("all", "active", "dropped")
VIEW_WINDOWS = ("all", "week", "month", "last-month")
# Icons a type or a view may name for the Desk navigation; each is a symbol in assets/desk/src/icons.js.
NAV_ICONS = ("house", "inbox", "badge-check", "history", "settings", "list", "dot", "building-2", "briefcase", "user",
             "users", "video", "file-text", "mail", "message-square", "calendar", "receipt", "tag", "folder", "newspaper",
             "git-pull-request", "chart-line", "circle-help", "rss", "file-search", "package", "globe", "link")
TYPE_RE = re.compile(r"^[a-z][a-z0-9]*(-[a-z0-9]+)*$")
VIEW_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
MAX_DOC_BYTES = 256 * 1024
SIGNALS = ("override", "uncaptured_term", "dead_item", "source_health", "limit_pressure",
           "connections", "edit_drift", "manual_repetition", "people_drop")
LEARNING_DEFAULTS = {"minSample": 5, "minEffect": 0.6, "cooldownDays": 14, "maxPerRun": 3, "deadAfterRuns": 10}
# (minimum, maximum or None) per number; minEffect is a share above 0 and at most 1.
LEARNING_RANGES = {"minSample": (1, None), "cooldownDays": (0, None), "maxPerRun": (0, 10), "deadAfterRuns": (2, None)}
KNOWN_LIMITS = ("max_inbox_per_run",)
# The push rule, gates, cap overrides and send permissions are never learnable, whatever a routine names them.
# Names are matched with case and separators removed, so PushRule, push-rule and push_rule are one name.
NEVER_LEARNABLE_RE = re.compile(r"push|gate|send|alert|permission|budget|maxruns|capoverride")


class DefinitionError(Exception):
    """Raised for unreadable definitions or a workspace that does not compile."""

    def __init__(self, problems):
        self.problems = [problems] if isinstance(problems, str) else list(problems)
        super().__init__("; ".join(self.problems))


def load(path):
    try:
        with open(path, encoding="utf-8") as fh:
            defn = json.load(fh)
    except FileNotFoundError:
        raise DefinitionError(f"file not found: {path}")
    except json.JSONDecodeError as exc:
        raise DefinitionError(f"malformed JSON in {path}: {exc}")
    except OSError as exc:
        raise DefinitionError(f"cannot read {path}: {exc}")
    if not isinstance(defn, dict):
        raise DefinitionError(f"{path}: top level must be an object")
    return defn


def doc_bytes(doc):
    return len(json.dumps(doc, sort_keys=True, separators=(",", ":")).encode("utf-8"))


def _lint_identity(tname, tdef):
    rule = tdef.get("identity")
    if not isinstance(rule, str) or not rule:
        return [f"type '{tname}': missing identity rule"]
    if rule in NAME_RULES:
        return []
    if rule.startswith("field:"):
        if rule[6:] not in tdef.get("fields", {}):
            return [f"type '{tname}': identity {rule} names an undeclared field"]
        return []
    return [f"type '{tname}': identity must be domain, name or field:<name>, not '{rule}'"]


def lint_icon(label, value):
    """Problems with an optional nav icon name on a type or a view."""
    if value in NAV_ICONS:
        return []
    return [f"{label}: icon {value!r} is not a Desk icon; use one of {', '.join(NAV_ICONS)}"]


def _lint_type(tname, tdef, types, settings):
    if not TYPE_RE.match(tname):
        return [f"type '{tname}': name must be lowercase letters and digits, single hyphens only"]
    if not isinstance(tdef, dict):
        return [f"type '{tname}': must be an object"]
    problems = []
    fields = tdef.get("fields")
    if not isinstance(fields, dict) or not fields:
        problems.append(f"type '{tname}': needs at least one field")
        fields = {}
    for fname, fdef in fields.items():
        ftype = fdef.get("type") if isinstance(fdef, dict) else None
        if ftype not in FIELD_TYPES:
            problems.append(f"type '{tname}' field '{fname}': type {ftype!r} is not one of {', '.join(FIELD_TYPES)}")
        elif ftype == "choice" and not (isinstance(fdef.get("choices"), list) and fdef["choices"]):
            problems.append(f"type '{tname}' field '{fname}': choice field needs a choices list")
    problems += _lint_identity(tname, tdef)
    if "icon" in tdef:
        problems += lint_icon(f"type '{tname}'", tdef["icon"])
    if tdef.get("merge", "merge") not in MERGE_POLICIES:
        problems.append(f"type '{tname}': merge must be merge or separate")
    for link in tdef.get("links", []):
        if link not in types:
            problems.append(f"type '{tname}': link to undeclared type '{link}'")
    by_name = {s.get("name"): s for s in settings if isinstance(s, dict)}
    for flt in tdef.get("settingFilters", []):
        sname, field = flt.get("setting"), flt.get("field")
        setting = by_name.get(sname)
        if setting is None:
            problems.append(f"type '{tname}': settingFilters names unknown setting '{sname}'")
        elif setting.get("type") != "list" or setting.get("role") not in ("include", "exclude"):
            problems.append(f"type '{tname}': setting '{sname}' used as a filter needs type list and a role")
        if field not in fields:
            problems.append(f"type '{tname}': settingFilters names undeclared field '{field}'")
    return problems


def lint_view(view, types):
    """Problems with one view in the Desk's shape: filters {q, status, starred, tag, source, reason,
    fields {field: value}}, window, sort {field, dir}, group (a field name), columns."""
    vid = view.get("id")
    label = f"view '{vid}'"
    problems = []
    if not isinstance(vid, str) or not VIEW_ID_RE.match(vid):
        problems.append(f"{label}: id must be lowercase letters, digits and hyphens")
    if "icon" in view:
        problems += lint_icon(label, view["icon"])
    tname = view.get("type")
    if tname not in types:
        return problems + [f"{label}: undeclared type '{tname}'"]
    known = set(types[tname].get("fields", {})) | set(VIEW_META_FIELDS)
    filters = view.get("filters", {})
    if not isinstance(filters, dict):
        return problems + [f"{label}: filters must be an object"]
    for key in filters:
        if key not in VIEW_FILTER_KEYS:
            problems.append(f"{label}: unknown filter '{key}'; field filters go under filters.fields")
    if filters.get("status", "all") not in VIEW_STATUSES:
        problems.append(f"{label}: filters.status must be one of {', '.join(VIEW_STATUSES)}")
    fields = filters.get("fields", {})
    if not isinstance(fields, dict):
        problems.append(f"{label}: filters.fields must be an object of field to value")
        fields = {}
    if view.get("window", "all") not in VIEW_WINDOWS:
        problems.append(f"{label}: window must be one of {', '.join(VIEW_WINDOWS)}")
    group = view.get("group", "")
    if not isinstance(group, str):
        problems.append(f"{label}: group must be a field name")
        group = ""
    sort = view.get("sort")
    if sort is not None and not (isinstance(sort, dict) and sort.get("dir", "desc") in ("asc", "desc")):
        problems.append(f"{label}: sort must be {{field, dir}} with dir asc or desc")
    used = list(view.get("columns") or []) + list(fields) + ([group] if group else [])
    if isinstance(sort, dict):
        used.append(sort.get("field"))
    for f in used:
        if f not in known:
            problems.append(f"{label}: undeclared field '{f}'")
    return problems


def lint(defn, settings_schema):
    """Problems with one producer's definition.json, given its [[setting]] list."""
    problems = []
    if not isinstance(defn.get("version"), int) or isinstance(defn.get("version"), bool) or defn["version"] < 1:
        problems.append("version must be a whole number of 1 or more")
    types = defn.get("types")
    if not isinstance(types, dict) or not types:
        return problems + ["types: declare at least one entity type"]
    settings = list(settings_schema or [])
    for tname, tdef in types.items():
        problems += _lint_type(tname, tdef, types, settings)
    for view in defn.get("views", []):
        problems += lint_view(view if isinstance(view, dict) else {}, types)
    if "learning" in defn:
        problems += lint_learning(defn["learning"], settings)
        bound = {f.get("setting") for t in types.values() if isinstance(t, dict) for f in t.get("settingFilters", [])}
        if isinstance(defn["learning"], dict) and isinstance(defn["learning"].get("limits"), list):
            bound |= set(defn["learning"]["limits"])
        for name in sorted(n for n in bound if isinstance(n, str) and never_learnable(n)):
            problems.append(f"learning: {name} is never learnable; remove its binding or turn learning off")
    if defn.get("inbox"):
        cap = [s for s in settings if s.get("name") == "max_inbox_per_run"]
        if not cap or cap[0].get("type") != "number":
            problems.append("inbox: a producer that writes Inbox messages must declare a number setting max_inbox_per_run")
    return problems


def never_learnable(name):
    return bool(NEVER_LEARNABLE_RE.search(re.sub(r"[^0-9a-z]", "", str(name).casefold())))


def _whole(v):
    return isinstance(v, int) and not isinstance(v, bool)


def lint_learning(learning, settings):
    """Problems with a definition's learning block, given its [[setting]] list."""
    if not isinstance(learning, dict):
        return ["learning must be an object"]
    problems = []
    for key in learning:
        if key not in ("enabled", "signals", "limits") and key not in LEARNING_DEFAULTS:
            problems.append(f"learning: unknown key '{key}'")
    if not isinstance(learning.get("enabled"), bool):
        problems.append("learning.enabled must be true or false")
    signals = learning.get("signals", {})
    if not isinstance(signals, dict):
        problems.append("learning.signals must be an object of signal: true or false")
        signals = {}
    for name, on in signals.items():
        if name not in SIGNALS:
            problems.append(f"learning.signals: unknown signal '{name}' (known: {', '.join(SIGNALS)})")
        elif not isinstance(on, bool):
            problems.append(f"learning.signals.{name} must be true or false")
    for key, (low, high) in LEARNING_RANGES.items():
        if key in learning:
            v = learning[key]
            if not _whole(v) or v < low or (high is not None and v > high):
                span = f"{low} to {high}" if high is not None else f"{low} or more"
                problems.append(f"learning.{key} must be a whole number of {span}")
    if "minEffect" in learning:
        v = learning["minEffect"]
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not 0 < v <= 1:
            problems.append("learning.minEffect must be a share above 0 and at most 1")
    declared = {s.get("name"): s for s in settings}
    limits = learning.get("limits", [])
    if not isinstance(limits, list):
        problems.append("learning.limits must be a list of setting names")
        limits = []
    for name in limits:
        if name not in KNOWN_LIMITS:
            problems.append(f"learning.limits: '{name}' is not a limit learning can tune (known: {', '.join(KNOWN_LIMITS)})")
        elif (declared.get(name) or {}).get("type") != "number":
            problems.append(f"learning.limits: '{name}' is not a declared number setting")
    return problems


def learning_config(learning):
    """The learning block with defaults filled in, or None when the definition declares none (no learning)."""
    if not isinstance(learning, dict):
        return None
    cfg = dict(LEARNING_DEFAULTS, enabled=bool(learning.get("enabled")), limits=list(learning.get("limits", [])))
    cfg.update({k: learning[k] for k in LEARNING_DEFAULTS if k in learning})
    chosen = learning.get("signals", {})
    cfg["signals"] = {name: chosen.get(name, True) is not False for name in SIGNALS}
    return cfg


def _tagged(pid, tdef):
    return [dict(producer=pid, **f) for f in tdef.get("settingFilters", [])]


def compile(producers) -> dict:
    """Merge producers [{id, label, schedule, definition, settings, template?}] into meta/definition."""
    problems = []
    out_producers, types, views = [], {}, []
    for p in producers:
        pid, defn, settings = p["id"], p["definition"], list(p.get("settings", []))
        problems += [f"{pid}: {msg}" for msg in lint(defn, settings)]
        out_producers.append({
            "id": pid,
            "label": defn.get("label") or p.get("label") or pid,
            "schedule": p.get("schedule", ""),
            "definitionVersion": defn.get("version"),
            "inbox": bool(defn.get("inbox")),
            "types": sorted(defn.get("types", {})),
            "settings": settings,
        })
        if "learning" in defn:
            out_producers[-1]["learning"] = learning_config(defn["learning"])
        for tname, tdef in sorted(defn.get("types", {}).items()):
            if not isinstance(tdef, dict):
                continue
            merge = tdef.get("merge", "merge")
            cur = types.get(tname)
            if cur is None:
                types[tname] = {
                    "label": tdef.get("label", tname),
                    "plural": tdef.get("plural", tdef.get("label", tname)),
                    "identity": tdef.get("identity"),
                    "merge": merge,
                    "fields": dict(tdef.get("fields", {})),
                    # Field order as declared; stores and sorted JSON do not keep object key order.
                    "order": list(tdef.get("fields", {})),
                    "links": sorted(set(tdef.get("links", []))),
                    "settingFilters": _tagged(pid, tdef),
                    "producers": [pid],
                }
                if "icon" in tdef:
                    types[tname]["icon"] = tdef["icon"]
                continue
            if cur["identity"] != tdef.get("identity"):
                problems.append(
                    f"type '{tname}': identity '{cur['identity']}' in {cur['producers'][0]} "
                    f"but '{tdef.get('identity')}' in {pid}")
            if cur["merge"] != merge:
                problems.append(f"type '{tname}': merge default differs between {cur['producers'][0]} and {pid}")
            for fname, fdef in tdef.get("fields", {}).items():
                old = cur["fields"].get(fname)
                if old is not None and old.get("type") != fdef.get("type"):
                    problems.append(f"type '{tname}' field '{fname}': type differs between producers")
                if fname not in cur["fields"]:
                    cur["order"].append(fname)
                cur["fields"].setdefault(fname, fdef)
            # Like the label, the first producer that names an icon sets it.
            if "icon" in tdef:
                cur.setdefault("icon", tdef["icon"])
            cur["links"] = sorted(set(cur["links"]) | set(tdef.get("links", [])))
            cur["settingFilters"] += _tagged(pid, tdef)
            cur["producers"].append(pid)
        for view in defn.get("views", []):
            views.append(dict(view, producer=pid, madeBy="definition"))
    joins = [(p["id"], p["definition"]["join"]) for p in producers
             if isinstance(p["definition"], dict) and "join" in p["definition"]]
    if len(joins) > 1:
        problems.append(f"join: only one definition.json may carry a join block "
                        f"(found in {joins[0][0]} and {joins[1][0]})")
    elif joins:
        problems += join_card.lint_join(joins[0][1], types)
    if problems:
        raise DefinitionError(problems)
    body = {"producers": out_producers, "types": types, "views": views}
    digest = hashlib.sha256(json.dumps(body, sort_keys=True).encode("utf-8")).hexdigest()[:12]
    compiled = dict(body, version=digest, schema=1)
    size = doc_bytes(compiled)
    if size > MAX_DOC_BYTES:
        raise DefinitionError(f"compiled definition is {size} bytes, over the 256 KiB document limit")
    if joins:
        # Beside the definition, outside the version digest: seeded to meta/join, never meta/definition.
        compiled["join"] = json.loads(json.dumps(joins[0][1]))
    return compiled
