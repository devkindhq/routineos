"""definition.json loading, linting and compiling into meta/definition. Standard library only."""
import hashlib
import json
import math
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
# Icons a type or a view may name for the Desk navigation; each is in ICON_NAMES in assets/desk/core/shared.js.
NAV_ICONS = ("house", "inbox", "badge-check", "history", "settings", "list", "dot", "building-2", "briefcase", "user",
             "users", "video", "file-text", "mail", "message-square", "calendar", "receipt", "tag", "folder", "newspaper",
             "git-pull-request", "chart-line", "circle-help", "rss", "file-search", "package", "globe", "link", "external-link")
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
# Desk view modules (desk.modules in a definition): data only, never code.
MODULE_KEYS = ("id", "kind", "label", "icon", "view", "fields")
MODULE_ID_RE = re.compile(r"^[a-z][a-z0-9-]{1,31}$")
MODULE_VIEW_KEYS = ("type", "filters", "window", "sort", "group", "columns")
MODULE_LABEL_MAX = 40
PAGE_IDS = ("today", "approvals", "runs", "workers", "history", "settings", "browse", "entity")
# v1 pages whose addresses now redirect to a v2 page; a module still cannot take their ids.
RETIRED_PAGE_IDS = ("inbox", "suggestions", "views")
# Built-in pages desk.start may name; a custom page is x/<page component id> or p/<spec page id>.
START_PAGES = ("today", "approvals", "runs", "history")
CODE_KEYS = ("script", "html", "js", "code", "template", "style")
# Copy words the Desk never uses; tests/test_desk_bundle.py scans the bundle for the same list.
BANNED_WORDS = ("ai-powered", "smart", "magic", "effortless", "unlock", "supercharge")
EM_DASH = chr(0x2014)


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
    if "shared" in tdef and not isinstance(tdef["shared"], bool):
        problems.append(f"type '{tname}': shared must be true or false (true lets people, AI workers and "
                        f"producers write the same records)")
    if "triage" in tdef and not isinstance(tdef["triage"], bool):
        problems.append(f"type '{tname}': triage must be true or false (true shows Keep and Drop controls on this "
                        f"type; it is not a permission)")
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


def triage_problems(types):
    """Problems when one type declares triage but another type's settingFilters are left without it. With triage on
    any type, the Desk shows Keep and Drop only on triage types, so a type that settings filter would lose the
    override path. `types` is a definition's types or the compiled, merged types."""
    if not isinstance(types, dict) or not any(isinstance(t, dict) and t.get("triage") is True for t in types.values()):
        return []
    return [f"type '{name}': settingFilters needs triage: true, because another type declares triage and the "
            f"Desk then shows Keep and Drop only on triage types"
            for name, t in sorted(types.items())
            if isinstance(t, dict) and t.get("settingFilters") and t.get("triage") is not True]


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
    if not isinstance(tname, str) or tname not in types:
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


def _code_keys(value, path):
    """Paths of keys anywhere in value that would carry code: CODE_KEYS or any key ending in Html."""
    found = []
    if isinstance(value, dict):
        for key, sub in value.items():
            here = f"{path}.{key}"
            if key in CODE_KEYS or (isinstance(key, str) and key.endswith("Html")):
                found.append(here)
            found += _code_keys(sub, here)
    elif isinstance(value, list):
        for i, sub in enumerate(value):
            found += _code_keys(sub, f"{path}[{i}]")
    return found


def copy_problems(label, text):
    """Problems with Desk copy: banned words and em dashes."""
    problems = []
    if EM_DASH in text:
        problems.append(f"{label}: no em dashes")
    for word in BANNED_WORDS:
        if re.search(r"\b" + re.escape(word) + r"\b", text.casefold()):
            problems.append(f"{label}: '{word}' is not Desk copy")
    return problems


def _lint_scope(label, filters):
    """filters.tag and filters.source on a module: a non-empty string or a non-empty list of non-empty strings.
    The Desk drops empty strings from a scope, so an empty one would leave the module unscoped."""
    problems = []
    for key in ("tag", "source"):
        if key not in filters:
            continue
        v = filters[key]
        items = [v] if isinstance(v, str) else v if isinstance(v, list) and v else None
        if items is None or not all(isinstance(x, str) and x.strip() for x in items):
            problems.append(f"{label}: filters.{key} must be a non-empty string or a non-empty list of non-empty strings")
    return problems


def _lint_module(m, types):
    mid = m.get("id")
    label = f"desk module '{mid}'"
    if not isinstance(mid, str) or not MODULE_ID_RE.match(mid):
        return [f"{label}: id must be 2 to 32 lowercase letters, digits and hyphens, starting with a letter"]
    if never_learnable(mid):
        return [f"{label}: the id contains a word learning never touches (push, gate, send, alert, permission, "
                f"budget, maxruns, capoverride); choose another id"]
    problems = [f"{label}: '{p}' would carry code; modules carry data only" for p in _code_keys(m, "module")]
    if problems:
        return problems
    problems = [f"{label}: unknown key '{k}'" for k in m if k not in MODULE_KEYS]
    if mid in PAGE_IDS or mid in RETIRED_PAGE_IDS:
        problems.append(f"{label}: the id is a built-in page; choose another id")
    if m.get("kind") != "view":
        problems.append(f"{label}: kind must be view")
    text = m.get("label")
    if not isinstance(text, str) or not text.strip():
        problems.append(f"{label}: needs a label")
    elif len(text) > MODULE_LABEL_MAX:
        problems.append(f"{label}: label is over {MODULE_LABEL_MAX} characters")
    else:
        problems += copy_problems(label, text)
    if "icon" in m:
        problems += lint_icon(label, m["icon"])
    view = m.get("view")
    if not isinstance(view, dict):
        return problems + [f"{label}: view must be an object with a type"]
    problems += [f"{label}: view key '{k}' is not allowed; a module view has {', '.join(MODULE_VIEW_KEYS)}"
                 for k in view if k not in MODULE_VIEW_KEYS]
    filters = view.get("filters", {})
    if isinstance(filters, dict):
        problems += _lint_scope(label, filters)
        filters = {k: v for k, v in filters.items() if k not in ("tag", "source")}
    problems += [f"{label}: {p}" for p in lint_view(dict(view, id=mid, filters=filters), types)]
    fields = m.get("fields", {})
    if not isinstance(fields, dict):
        return problems + [f"{label}: fields must be an object of field name to component id"]
    declared = (types.get(view.get("type")) or {}).get("fields", {}) if isinstance(view.get("type"), str) else {}
    for fname, comp in fields.items():
        if fname not in declared:
            problems.append(f"{label}: fields names '{fname}', which is not a field of type '{view.get('type')}'")
        if not isinstance(comp, str) or not MODULE_ID_RE.match(comp):
            problems.append(f"{label}: fields.{fname} must be a component id (lowercase letters, digits, hyphens)")
    return problems


HEALTH_LEVELS = ("red", "yellow", "green")


def lint_health(health, types):
    """Problems with desk.health (spec 7c): {<type>: {field, red: [], yellow: [], green: []}}."""
    if not isinstance(health, dict):
        return ["desk.health must be an object of type name to {field, red, yellow, green}"]
    problems = []
    for tname, rule in health.items():
        label = f"desk.health.{tname}"
        if tname not in types:
            problems.append(f"{label}: '{tname}' is not a declared type")
            continue
        if not isinstance(rule, dict):
            problems.append(f"{label} must be an object {{field, red, yellow, green}}")
            continue
        problems += [f"{label}: unknown key '{k}'" for k in rule if k not in ("field",) + HEALTH_LEVELS]
        if rule.get("field") not in ((types[tname] or {}).get("fields") or {}):
            problems.append(f"{label}: field '{rule.get('field')}' is not a field of type '{tname}'")
        seen = {}
        for level in HEALTH_LEVELS:
            values = rule.get(level, [])
            if not isinstance(values, list) or not all(isinstance(v, (str, int, float)) for v in values):
                problems.append(f"{label}.{level} must be a list of values")
                continue
            for v in values:
                if v in seen and seen[v] != level:
                    problems.append(f"{label}: value '{v}' is in both {seen[v]} and {level}")
                seen.setdefault(v, level)
    return problems


# The chips the record page strip knows, in their default order.
STRIP_CHIPS = ("state", "notes", "decision", "captured", "run", "type", "lastSeen")
STRIP_MAX = 8


def lint_record(record, types):
    """Problems with desk.record: {strip: {<type>: [{chip: name} | {field: name}, ...]}}."""
    if not isinstance(record, dict):
        return ["desk.record must be an object with a strip"]
    problems = [f"desk.record: unknown key '{k}'" for k in record if k != "strip"]
    strip = record.get("strip", {})
    if not isinstance(strip, dict):
        return problems + ["desk.record.strip must be an object of type name to a list of chips"]
    for tname, items in strip.items():
        label = f"desk.record.strip.{tname}"
        if tname not in types:
            problems.append(f"{label}: '{tname}' is not a declared type")
            continue
        if not isinstance(items, list) or len(items) > STRIP_MAX:
            problems.append(f"{label} must be a list of at most {STRIP_MAX} chips")
            continue
        fields = (types[tname] or {}).get("fields") or {}
        for i, item in enumerate(items):
            if not isinstance(item, dict) or len(item) != 1 or next(iter(item)) not in ("chip", "field"):
                problems.append(f"{label}[{i}] must be an object with one key, chip or field")
            elif "chip" in item and item["chip"] not in STRIP_CHIPS:
                problems.append(f"{label}[{i}]: chip '{item['chip']}' is not one of {', '.join(STRIP_CHIPS)}")
            elif "field" in item and item["field"] not in fields:
                problems.append(f"{label}[{i}]: field '{item['field']}' is not a field of type '{tname}'")
    return problems


PAGE_KEYS = ("id", "title", "nav", "controls", "filter", "blocks")
PAGE_CONTROLS = ("refresh", "dateRange", "filter")
BLOCK_KINDS = ("tile", "chart", "text", "table", "board")
BLOCK_KEYS = {
    "tile": ("id", "kind", "span", "label", "query", "format", "sparkline"),
    "chart": ("id", "kind", "span", "type", "title", "query", "format", "xLabel", "yLabel", "target"),
    "table": ("id", "kind", "span", "title", "query", "columns", "link"),
    "text": ("id", "kind", "span", "heading", "text"),
    "board": ("id", "kind", "span", "title", "query", "columns", "card", "link"),
}
BOARD_COLUMN_KEYS = ("value", "title")
BOARD_CARD_KEYS = ("title", "badges", "text")
BOARD_BADGES_MAX = 3
CHART_TYPES = ("sparkline", "line", "bar", "stackedBar", "shareBar")
BLOCK_FORMATS = ("number", "percent", "currency")
QUERY_KEYS = ("type", "where", "window", "groupBy", "x", "aggregate", "orderBy", "limit")
QUERY_OPS = ("==", "!=", "<", "<=", ">", ">=", "in", "not-in", "array-contains")
AGGREGATE_OPS = ("latest", "sum", "avg", "count", "delta")
WINDOW_UNITS = ("days", "weeks")
# The longest window a page may ask for. The Desk (core/palette.js SPEC_WINDOW) drops a block over these.
WINDOW_MAX = {"days": 3660, "weeks": 520}
DATE_META_FIELDS = ("lastSeen", "firstSeen")
SPAN_KEYS = ("base", "md")
QUERY_LIMIT_MAX = 1000


def _lint_span(label, span):
    if not isinstance(span, dict) or any(k not in SPAN_KEYS for k in span):
        return [f"{label}: span must be an object with base and md, each 1 to 12"]
    return [f"{label}: span.{k} must be a whole number from 1 to 12" for k, v in span.items()
            if not _whole(v) or not 1 <= v <= 12]


def _lint_query(label, query, kind, types):
    """Problems with a block query: {type, where, window, groupBy, x, aggregate, orderBy, limit}."""
    if not isinstance(query, dict):
        return [f"{label}: query must be an object"]
    problems = [f"{label}: unknown query key '{k}'" for k in query if k not in QUERY_KEYS]
    tname = query.get("type")
    if not isinstance(tname, str) or tname not in types:
        return problems + [f"{label}: query.type is undeclared type '{tname}'"]
    fields = (types[tname] or {}).get("fields") or {}
    known = set(fields) | set(VIEW_META_FIELDS)
    where = query.get("where", [])
    if not isinstance(where, list):
        problems.append(f"{label}: query.where must be a list of [field, operator, value]")
        where = []
    for clause in where:
        if not isinstance(clause, list) or len(clause) != 3 or not isinstance(clause[0], str):
            problems.append(f"{label}: query.where entries must be [field, operator, value]")
            continue
        if clause[0] not in known:
            problems.append(f"{label}: query.where has undeclared field '{clause[0]}'")
        if clause[1] not in QUERY_OPS:
            problems.append(f"{label}: query.where operator '{clause[1]}' is not one of {', '.join(QUERY_OPS)}")
        elif clause[1] in ("in", "not-in") and not isinstance(clause[2], list):
            problems.append(f"{label}: query.where operator '{clause[1]}' needs a list value")
    window = query.get("window")
    if window is not None and window != "range":
        last = window.get("last") if isinstance(window, dict) else None
        if not (isinstance(last, dict) and _whole(last.get("n")) and last["n"] >= 1 and last.get("unit") in WINDOW_UNITS):
            problems.append(f"{label}: query.window must be \"range\" or {{last: {{n, unit}}}} with n 1 or more "
                            f"and unit {' or '.join(WINDOW_UNITS)}")
        elif last["n"] > WINDOW_MAX[last["unit"]]:
            problems.append(f"{label}: query.window.last.n is at most {WINDOW_MAX['days']} days or "
                            f"{WINDOW_MAX['weeks']} weeks")
    group = query.get("groupBy")
    if group is not None and not isinstance(group, str):
        problems.append(f"{label}: query.groupBy must be a field name")
    elif group is not None and group not in known:
        problems.append(f"{label}: query.groupBy has undeclared field '{group}'")
    if group is not None and kind == "tile":
        problems.append(f"{label}: a tile has no groupBy; it shows one number")
    x = query.get("x")
    if kind in ("tile", "chart") and x is None:
        problems.append(f"{label}: a {kind} needs query.x, the date field it plots by")
    elif x is not None and x not in known:
        problems.append(f"{label}: query.x has undeclared field '{x}'")
    elif x is not None and x not in DATE_META_FIELDS and (fields.get(x) or {}).get("type") != "date":
        problems.append(f"{label}: query.x field '{x}' is not a date field")
    if kind in ("table", "board") and window is not None and x is None:
        problems.append(f"{label}: a {kind} with a window needs query.x, the date field the window cuts by")
    if kind == "board" and group is None:
        problems.append(f"{label}: a board needs query.groupBy, the field it groups into columns")
    agg = query.get("aggregate")
    if kind in ("tile", "chart") and agg is None:
        problems.append(f"{label}: a {kind} needs query.aggregate")
    elif agg is not None:
        if not isinstance(agg, dict) or agg.get("op") not in AGGREGATE_OPS:
            problems.append(f"{label}: aggregate op must be one of {', '.join(AGGREGATE_OPS)}")
        else:
            field = agg.get("field")
            if agg["op"] != "count" or field is not None:
                if field not in known:
                    problems.append(f"{label}: aggregate has undeclared field '{field}'")
                elif agg["op"] != "count" and (fields.get(field) or {}).get("type") != "number":
                    problems.append(f"{label}: aggregate field '{field}' is not a number field")
    order = query.get("orderBy")
    if order is not None and not (isinstance(order, list) and len(order) == 2 and order[0] in known
                                  and order[1] in ("asc", "desc")):
        problems.append(f"{label}: query.orderBy must be [field, asc|desc] over a declared field")
    if "limit" in query and kind not in ("table", "board"):
        problems.append(f"{label}: query.limit is only for a table or board")
    elif "limit" in query and not (_whole(query["limit"]) and 1 <= query["limit"] <= QUERY_LIMIT_MAX):
        problems.append(f"{label}: query.limit must be a whole number from 1 to {QUERY_LIMIT_MAX}")
    return problems


def _lint_board(label, block, types):
    """Problems with a board's own keys: board columns [{value, title?}] and card {title, badges?, text?}. A board's
    columns are not a table's columns (a list of field names)."""
    problems = []
    fields = (types.get(block["query"].get("type")) or {}).get("fields") or {}
    known = set(fields) | set(VIEW_META_FIELDS)
    group = block["query"].get("groupBy")
    choices = (fields.get(group) or {}).get("choices") if isinstance(group, str) else None
    is_choice = (fields.get(group) or {}).get("type") == "choice" if isinstance(group, str) else False
    cols = block.get("columns")
    if cols is None:
        if isinstance(group, str) and group in known and not is_choice:
            problems.append(f"{label}: query.groupBy field '{group}' is not a choice field, so give board columns "
                            f"as a list of {{value, title}}")
    elif not isinstance(cols, list) or not cols:
        problems.append(f"{label}: board columns must be a list of {{value, title}}")
    else:
        seen = set()
        for i, col in enumerate(cols):
            where = f"{label}: board columns[{i}]"
            if not isinstance(col, dict) or not isinstance(col.get("value"), str) or not col["value"]:
                problems.append(f"{where} must be an object with a text value")
                continue
            problems += [f"{where} has unknown key '{k}'" for k in col if k not in BOARD_COLUMN_KEYS]
            if col["value"] in seen:
                problems.append(f"{where}: value '{col['value']}' is listed more than once in board columns")
            seen.add(col["value"])
            if is_choice and isinstance(choices, list) and col["value"] not in choices:
                problems.append(f"{where}: value '{col['value']}' is not one of the choices of '{group}'")
            if "title" in col:
                if not isinstance(col["title"], str) or not col["title"].strip():
                    problems.append(f"{where}: title must be text")
                else:
                    problems += copy_problems(f"{where}.title", col["title"])
    card = block.get("card")
    if not isinstance(card, dict):
        return problems + [f"{label}: a board needs card {{title, badges, text}}"]
    problems += [f"{label}: card has unknown key '{k}'" for k in card if k not in BOARD_CARD_KEYS]
    for key in ("title", "text"):
        if key in card and (not isinstance(card[key], str) or card[key] not in known):
            problems.append(f"{label}: card.{key} has undeclared field '{card[key]}'")
    if "title" not in card:
        problems.append(f"{label}: card.title is required, the field shown as the card heading")
    badges = card.get("badges", [])
    if not isinstance(badges, list):
        problems.append(f"{label}: card.badges must be a list of fields")
    else:
        if len(badges) > BOARD_BADGES_MAX:
            problems.append(f"{label}: card.badges is at most {BOARD_BADGES_MAX} fields")
        problems += [f"{label}: card.badges has undeclared field '{b}'" for b in badges
                     if not isinstance(b, str) or b not in known]
    return problems


def _lint_block(label, block, types):
    if not isinstance(block, dict):
        return [f"{label} must be an object"]
    bid = block.get("id")
    label = f"{label}: block '{bid}'"
    problems = []
    if not isinstance(bid, str) or not MODULE_ID_RE.match(bid):
        problems.append(f"{label}: id must match {MODULE_ID_RE.pattern}")
    kind = block.get("kind")
    if kind not in BLOCK_KINDS:
        return problems + [f"{label}: kind '{kind}' is not one of {', '.join(BLOCK_KINDS)}"]
    problems += [f"{label}: unknown key '{k}' for a {kind}" for k in block if k not in BLOCK_KEYS[kind]
                 and k not in CODE_KEYS and not str(k).endswith("Html")]
    if "span" in block:
        problems += _lint_span(label, block["span"])
    if kind == "chart" and block.get("type") not in CHART_TYPES:
        problems.append(f"{label}: chart type '{block.get('type')}' is not one of {', '.join(CHART_TYPES)}")
    if "format" in block and block["format"] not in BLOCK_FORMATS:
        problems.append(f"{label}: format must be one of {', '.join(BLOCK_FORMATS)}")
    for key in ("label", "title", "heading", "xLabel", "yLabel"):
        if key in block:
            if not isinstance(block[key], str) or not block[key].strip():
                problems.append(f"{label}: {key} must be text")
            else:
                problems += copy_problems(f"{label}.{key}", block[key])
    if kind == "tile" and not block.get("label"):
        problems.append(f"{label}: a tile needs a label")
    if kind == "text":
        if not isinstance(block.get("text"), str) or not block["text"].strip():
            problems.append(f"{label}: a text block needs text")
        else:
            problems += copy_problems(f"{label}.text", block["text"])
    else:
        problems += _lint_query(label, block.get("query"), kind, types)
    if kind == "table" and isinstance(block.get("query"), dict):
        tfields = ((types.get(block["query"].get("type")) or {}).get("fields") or {})
        cols = block.get("columns", [])
        if not isinstance(cols, list) or not cols:
            problems.append(f"{label}: columns must be a list of fields")
        else:
            problems += [f"{label}: columns has undeclared field '{c}'" for c in cols
                         if c not in tfields and c not in VIEW_META_FIELDS]
            problems += [f"{label}: columns lists '{c}' more than once" for c in dict.fromkeys(cols) if cols.count(c) > 1]
    if kind == "board" and isinstance(block.get("query"), dict):
        problems += _lint_board(label, block, types)
    for flag in ("sparkline", "link"):
        if flag in block and not isinstance(block[flag], bool):
            problems.append(f"{label}: {flag} must be true or false")
    if "target" in block and (isinstance(block["target"], bool) or not isinstance(block["target"], (int, float))
                              or not math.isfinite(block["target"])):
        problems.append(f"{label}: target must be a number")
    return problems


def lint_pages(pages, types, module_ids=()):
    """Problems with desk.pages, the spec pages: [{id, title, nav, controls, filter, blocks}]. Each problem
    starts desk.pages.<id>: . Not routine.toml [desk] pages, which turns on code pages."""
    if not isinstance(pages, list):
        return ["desk.pages must be a list"]
    problems, seen = [], set()
    for i, pg in enumerate(pages):
        if not isinstance(pg, dict):
            problems.append(f"desk.pages[{i}] must be an object")
            continue
        pid = pg.get("id")
        label = f"desk.pages.{pid}"
        found = []
        if not isinstance(pid, str) or not MODULE_ID_RE.match(pid):
            found.append(f"id must match {MODULE_ID_RE.pattern}")
        elif pid in seen:
            found.append("declared more than once")
        elif pid in PAGE_IDS or pid in RETIRED_PAGE_IDS:
            found.append("the id is a built-in page; choose another id")
        elif never_learnable(pid):
            found.append("the id contains a word learning never touches (push, gate, send, alert, permission, "
                         "budget, maxruns, capoverride); choose another id")
        elif pid in module_ids:
            found.append("the id is also a desk module id; choose another id")
        if isinstance(pid, str):
            seen.add(pid)
        found += [f"unknown key '{k}'" for k in pg if k not in PAGE_KEYS and k not in CODE_KEYS and not str(k).endswith("Html")]
        found += [f"'{p}' would carry code; a spec page carries data only" for p in _code_keys(pg, "page")]
        title = pg.get("title")
        if not isinstance(title, str) or not title.strip():
            found.append("needs a title")
        else:
            found += [p.split(": ", 1)[1] for p in copy_problems("t", title)]
        nav = pg.get("nav")
        if nav is not None:
            if not isinstance(nav, dict) or any(k not in ("label", "icon") for k in nav):
                found.append("nav must be an object with label and icon")
            else:
                if "label" in nav:
                    text = nav["label"]
                    if not isinstance(text, str) or not text.strip() or len(text) > MODULE_LABEL_MAX:
                        found.append(f"nav.label must be text of at most {MODULE_LABEL_MAX} characters")
                    else:
                        found += [p.split(": ", 1)[1] for p in copy_problems("t", text)]
                if "icon" in nav:
                    found += [p.split(": ", 1)[1] for p in lint_icon("nav", nav["icon"])]
        controls = pg.get("controls", [])
        if not isinstance(controls, list):
            found.append("controls must be a list")
            controls = []
        found += [f"control '{c}' is not one of {', '.join(PAGE_CONTROLS)}" for c in controls if c not in PAGE_CONTROLS]
        flt = pg.get("filter")
        every = {f for t in types.values() if isinstance(t, dict) for f in (t.get("fields") or {})} | set(VIEW_META_FIELDS)
        if "filter" in controls and not isinstance(flt, dict):
            found.append("the filter control needs a filter {field, label}")
        elif flt is not None:
            if not isinstance(flt, dict) or flt.get("field") not in every or not isinstance(flt.get("label"), str):
                found.append(f"filter must be {{field, label}} over a declared field; undeclared field '{(flt or {}).get('field') if isinstance(flt, dict) else flt}'")
        blocks = pg.get("blocks")
        if not isinstance(blocks, list):
            found.append("blocks must be a list")
            blocks = []
        queried = {b["query"]["type"] for b in blocks if isinstance(b, dict) and isinstance(b.get("query"), dict)
                   and isinstance(b["query"].get("type"), str)}
        if isinstance(flt, dict) and flt.get("field") in every and flt["field"] not in VIEW_META_FIELDS and not any(
                flt["field"] in ((types.get(t) or {}).get("fields") or {}) for t in queried):
            found.append(f"filter field '{flt['field']}' is declared on no block on this page's types")
        for j, b in enumerate(blocks):
            if isinstance(b, dict) and isinstance(b.get("query"), dict) and b["query"].get("window") == "range" \
                    and "dateRange" not in controls:
                found.append(f"blocks[{j}]: a window of \"range\" needs the dateRange control on the page")
        bids = set()
        for j, b in enumerate(blocks):
            found += [p for p in _lint_block(f"blocks[{j}]", b, types)]
            bid = b.get("id") if isinstance(b, dict) else None
            if isinstance(bid, str):
                if bid in bids:
                    found.append(f"blocks[{j}]: block '{bid}' is declared more than once")
                bids.add(bid)
        problems += [f"{label}: {p}" for p in found]
    return problems


def lint_start(start, page_ids=()):
    """Problems with desk.start, the page an empty Desk address opens. `page_ids` are the definition's spec page ids.
    An x/<id> is checked for shape only here; desk_registry.lint_routine checks it names a page component."""
    if not isinstance(start, str):
        return ["desk.start must be a page address string"]
    if start in START_PAGES:
        return []
    kind, _, pid = start.partition("/")
    if kind == "x" and MODULE_ID_RE.match(pid):
        return []
    if kind == "p" and pid in page_ids:
        return []
    allowed = ", ".join(START_PAGES) + ", x/<page component id> or p/<spec page id>"
    known = sorted(f"p/{p}" for p in page_ids)
    return [f"desk.start '{start}' is not a page; use {allowed}"
            + (f" (spec pages here: {', '.join(known)})" if known else "")]


def lint_hide_lists(value, modules):
    """Problems with desk.hideLists, the types whose default list page the Desk hides: a list of type ids, none twice,
    none that a module of this definition shows. Whether each id is a declared type is checked in compile, which
    sees every producer."""
    if not isinstance(value, list):
        return ["desk.hideLists must be a list of type ids"]
    problems = []
    for tid in value:
        if not isinstance(tid, str) or not tid:
            problems.append("desk.hideLists must hold type ids as text")
    problems += [f"desk.hideLists lists '{t}' more than once" for t in dict.fromkeys(value)
                 if isinstance(t, str) and value.count(t) > 1]
    for m in modules if isinstance(modules, list) else []:
        view = m.get("view") if isinstance(m, dict) else None
        tid = view.get("type") if isinstance(view, dict) else None
        if isinstance(tid, str) and tid in value:
            problems.append(f"desk.hideLists hides type '{tid}', but desk module '{m.get('id')}' shows it; "
                            f"remove the module or the hideLists entry")
    return problems


def start_hide_conflict(start, start_owner, hidden):
    """Problems when desk.start opens the list page of a hidden type. `hidden` maps a type id to the producer that
    hides it. Today lint_start refuses browse/<type>, so this cannot fire from a real definition (Q26 keeps start
    narrow); it is a guard for the day start is widened, and compile calls it."""
    if not isinstance(start, str) or not start.startswith("browse/"):
        return []
    tid = start[len("browse/"):]
    if tid in hidden:
        return [f"desk.start '{start}' ({start_owner}) opens the list of type '{tid}', which {hidden[tid]} hides "
                f"with desk.hideLists"]
    return []


DESK_LINK_KEYS = ("label", "url", "icon")
DESK_LINKS_MAX = 12
DESK_LINK_LABEL_MAX = 40
DEFAULT_LINK_ICON = "external-link"


def _timezone_problem(tz):
    if tz == "local":
        return ""
    if not isinstance(tz, str) or not tz or tz.startswith(("/", ".")) or ".." in tz:
        return "desk.timezone must be 'local' or an IANA zone name such as Australia/Melbourne"
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
    try:
        ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        return f"desk.timezone '{tz}' is not a zone name; use 'local' or one such as Australia/Melbourne"
    return ""


def lint_routine_desk(desk):
    """The [desk] table of a routine.toml: pages, link tables, timezone."""
    import schema
    from urllib.parse import urlsplit
    if desk is None:
        return []
    if not isinstance(desk, dict):
        return ["desk must be a table"]
    problems = [f"desk: unknown key '{k}'; allowed: pages, link, timezone" for k in desk if k not in ("pages", "link", "timezone")]
    if "pages" in desk and not isinstance(desk["pages"], bool):
        problems.append("desk.pages must be true or false")
    if "timezone" in desk:
        msg = _timezone_problem(desk["timezone"])
        if msg:
            problems.append(msg)
    if "link" not in desk:
        return problems
    links = desk["link"]
    if not isinstance(links, list) or not all(isinstance(x, dict) for x in links):
        return problems + ["desk.link must be a list of [[desk.link]] tables"]
    if len(links) > DESK_LINKS_MAX:
        problems.append(f"desk.link: at most {DESK_LINKS_MAX} links per routine")
    seen = set()
    for i, item in enumerate(links):
        label = item.get("label")
        tag = f'desk.link[{i}] "{label}"' if isinstance(label, str) and label else f"desk.link[{i}]"
        found = [f"unknown key '{k}'; allowed: {', '.join(DESK_LINK_KEYS)}" for k in item if k not in DESK_LINK_KEYS]
        if not isinstance(label, str) or not 1 <= len(label) <= DESK_LINK_LABEL_MAX:
            found.append(f"label must be 1 to {DESK_LINK_LABEL_MAX} characters")
        elif copy_problems("label", label):
            found += copy_problems("label", label)
        url = item.get("url")
        if not isinstance(url, str) or not url.startswith("https://"):
            found.append("url must start with https://")
        elif (len(url) > schema.LIST_ITEM_MAX or schema._CONTROL.search(url) or " " in url or '"' in url or "'" in url
              or not re.fullmatch(schema.LIST_FORMATS["https_url"], url)):
            found.append(f"url must be one https:// address of at most {schema.LIST_ITEM_MAX} characters, with no spaces or quotes")
        else:
            parts = urlsplit(url)
            if parts.scheme != "https" or not parts.hostname:
                found.append("url must start with https:// and name a host")
            elif parts.username is not None or parts.password is not None or "@" in parts.netloc:
                found.append("url must not carry a user name or password")
            elif url in seen:
                found.append("another link already has the same url")
            seen.add(url)
        icon = item.get("icon", DEFAULT_LINK_ICON)
        if icon not in NAV_ICONS:
            found.append(f"icon {icon!r} is not a Desk icon; use one of {', '.join(NAV_ICONS)}")
        problems += [f"{tag}: {m}" for m in found]
    return problems


def lint_desk(desk, types):
    """Problems with a definition's desk block: {modules: [view module, ...], health: {...}, record: {strip},
    pages: [...], start: "<page>"}."""
    if not isinstance(desk, dict):
        return ["desk must be an object with a modules list"]
    problems = [f"desk: unknown key '{k}'" for k in desk if k not in ("modules", "health", "record", "pages", "start", "hideLists")]
    if "hideLists" in desk:
        problems += lint_hide_lists(desk["hideLists"], desk.get("modules"))
    if "start" in desk:
        pages = desk.get("pages") if isinstance(desk.get("pages"), list) else []
        problems += lint_start(desk["start"], {p.get("id") for p in pages if isinstance(p, dict) and isinstance(p.get("id"), str)})
    if "pages" in desk:
        mods = desk.get("modules") if isinstance(desk.get("modules"), list) else []
        problems += lint_pages(desk["pages"], types, {m.get("id") for m in mods if isinstance(m, dict) and isinstance(m.get("id"), str)})
    if "health" in desk:
        problems += lint_health(desk["health"], types)
    if "record" in desk:
        problems += lint_record(desk["record"], types)
    modules = desk.get("modules", [])
    if not isinstance(modules, list):
        return problems + ["desk.modules must be a list"]
    seen, cells = set(), {}
    for i, m in enumerate(modules):
        if not isinstance(m, dict):
            problems.append(f"desk.modules[{i}] must be an object")
            continue
        problems += _lint_module(m, types)
        mid = m.get("id")
        if isinstance(mid, str):
            if mid in seen:
                problems.append(f"desk module '{mid}': declared more than once")
            seen.add(mid)
        view, fields = m.get("view"), m.get("fields")
        if not (isinstance(view, dict) and isinstance(view.get("type"), str) and isinstance(fields, dict)):
            continue
        for fname, comp in fields.items():
            key = (view["type"], fname)
            if key in cells and cells[key][1] != comp:
                problems.append(f"desk module '{mid}': field '{fname}' of type '{view['type']}' is shown by "
                                f"'{cells[key][1]}' in module '{cells[key][0]}'; one field has one component")
            cells.setdefault(key, (mid, comp))
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
    problems += triage_problems(types)
    for view in defn.get("views", []):
        problems += lint_view(view if isinstance(view, dict) else {}, types)
    if "learning" in defn:
        problems += lint_learning(defn["learning"], settings)
        bound = {f.get("setting") for t in types.values() if isinstance(t, dict) for f in t.get("settingFilters", [])}
        if isinstance(defn["learning"], dict) and isinstance(defn["learning"].get("limits"), list):
            bound |= set(defn["learning"]["limits"])
        for name in sorted(n for n in bound if isinstance(n, str) and never_learnable(n)):
            problems.append(f"learning: {name} is never learnable; remove its binding or turn learning off")
    if "desk" in defn:
        problems += lint_desk(defn["desk"], types)
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
    out_producers, types, views, modules, module_owner = [], {}, [], [], {}
    health, health_owner = {}, {}
    strips, strip_owner = {}, {}
    pages, page_owner = [], {}
    start, start_owner = None, None
    links, link_owner = [], {}
    tz, tz_owner = None, None
    hide_by = {}  # type id -> producers that hide its list, in producer order
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
                if tdef.get("shared"):
                    types[tname]["shared"] = True
                if tdef.get("triage") is True:
                    types[tname]["triage"] = True
                continue
            if cur["identity"] != tdef.get("identity"):
                problems.append(
                    f"type '{tname}': identity '{cur['identity']}' in {cur['producers'][0]} "
                    f"but '{tdef.get('identity')}' in {pid}")
            if cur["merge"] != merge:
                problems.append(f"type '{tname}': merge default differs between {cur['producers'][0]} and {pid}")
            if bool(cur.get("shared")) != bool(tdef.get("shared")):
                problems.append(f"type '{tname}': shared differs between {cur['producers'][0]} and {pid}; "
                                f"producers of one type must agree")
            if bool(cur.get("triage")) != (tdef.get("triage") is True):
                problems.append(f"type '{tname}': triage differs between {cur['producers'][0]} and {pid}; "
                                f"producers of one type must agree, so add triage: true in both")
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
        # Only what a producer declares; the default page modules ship with the Desk and are never compiled in.
        desk = defn.get("desk") if isinstance(defn, dict) else None
        for m in desk.get("modules", []) if isinstance(desk, dict) and isinstance(desk.get("modules"), list) else []:
            if not isinstance(m, dict):
                continue
            mid = m.get("id")
            if isinstance(mid, str):
                if mid in module_owner and module_owner[mid] != pid:
                    problems.append(f"desk module '{mid}' is declared by {module_owner[mid]} and {pid}")
                module_owner.setdefault(mid, pid)
            modules.append(dict(m, producer=pid))
        for pg in desk.get("pages", []) if isinstance(desk, dict) and isinstance(desk.get("pages"), list) else []:
            if not isinstance(pg, dict):
                continue
            gid = pg.get("id")
            if isinstance(gid, str):
                if gid in page_owner and page_owner[gid] != pid:
                    problems.append(f"desk page '{gid}' is declared by {page_owner[gid]} and {pid}")
                page_owner.setdefault(gid, pid)
            pages.append(dict(pg, producer=pid))
        if isinstance(desk, dict) and isinstance(desk.get("start"), str):
            if start is not None and start != desk["start"]:
                problems.append(f"desk.start is '{start}' in {start_owner} but '{desk['start']}' in {pid}; "
                                f"producers that name a start page must name the same one")
            elif start is None:
                start, start_owner = desk["start"], pid
        for item in p.get("links") or []:
            if isinstance(item, dict) and item.get("url") not in link_owner:
                link_owner[item.get("url")] = pid
                links.append({"label": item.get("label"), "url": item.get("url"),
                              "icon": item.get("icon", DEFAULT_LINK_ICON)})
        ptz = p.get("timezone")
        if isinstance(ptz, str) and ptz != "local":
            if tz is not None and tz != ptz:
                problems.append(f"desk timezone is '{tz}' in {tz_owner} but '{ptz}' in {pid}; "
                                f"producers that name a timezone must name the same one")
            elif tz is None:
                tz, tz_owner = ptz, pid
        hid = desk.get("hideLists") if isinstance(desk, dict) else None
        for tid in hid if isinstance(hid, list) else []:
            if isinstance(tid, str):
                hide_by.setdefault(tid, []).append(pid)
        rules = desk.get("health") if isinstance(desk, dict) else None
        for tname, rule in sorted(rules.items()) if isinstance(rules, dict) else []:
            if tname in health and health[tname] != rule:
                problems.append(f"desk.health for type '{tname}' differs between {health_owner[tname]} and {pid}; "
                                f"two producers may share a type's health only with identical mappings")
            health.setdefault(tname, rule)
            health_owner.setdefault(tname, pid)
        record = desk.get("record") if isinstance(desk, dict) else None
        declared = record.get("strip") if isinstance(record, dict) else None
        for tname, items in sorted(declared.items()) if isinstance(declared, dict) else []:
            if tname in strips and strips[tname] != items:
                problems.append(f"desk.record.strip for type '{tname}' differs between {strip_owner[tname]} and {pid}; "
                                f"two producers may share a type's strip only with identical lists")
            strips.setdefault(tname, items)
            strip_owner.setdefault(tname, pid)
    joins = [(p["id"], p["definition"]["join"]) for p in producers
             if isinstance(p["definition"], dict) and "join" in p["definition"]]
    if len(joins) > 1:
        problems.append(f"join: only one definition.json may carry a join block "
                        f"(found in {joins[0][0]} and {joins[1][0]})")
    elif joins:
        problems += join_card.lint_join(joins[0][1], types)
    problems += [m for m in triage_problems(types) if not any(m in q for q in problems)]
    for tid, hiders in sorted(hide_by.items()):
        if tid not in types:
            problems.append(f"desk.hideLists in {hiders[0]} names type '{tid}', which no producer declares")
    for m in modules:
        view = m.get("view") if isinstance(m.get("view"), dict) else {}
        for hider in hide_by.get(view.get("type"), []):
            if hider != m["producer"]:
                problems.append(f"desk module '{m.get('id')}' ({m['producer']}) shows type '{view['type']}', "
                                f"which {hider} hides with desk.hideLists")
    problems += start_hide_conflict(start, start_owner, {t: h[0] for t, h in hide_by.items()})
    for pg in pages:
        if pg.get("id") in module_owner:
            problems.append(f"desk page '{pg['id']}' is also a desk module id (module from {module_owner[pg['id']]}, page from {pg['producer']})")
    if problems:
        raise DefinitionError(problems)
    body = {"producers": out_producers, "types": types, "views": views}
    if modules:
        body["desk"] = {"modules": modules}
    if pages:
        body.setdefault("desk", {})["pages"] = pages
    if health:
        body.setdefault("desk", {})["health"] = json.loads(json.dumps(health))
    if strips:
        body.setdefault("desk", {})["record"] = {"strip": json.loads(json.dumps(strips))}
    if start is not None:
        body.setdefault("desk", {})["start"] = start
    if hide_by:
        body.setdefault("desk", {})["hideLists"] = sorted(hide_by)
    if links:
        body.setdefault("desk", {})["links"] = links
    if tz is not None:
        body.setdefault("desk", {})["timezone"] = tz
    digest = hashlib.sha256(json.dumps(body, sort_keys=True).encode("utf-8")).hexdigest()[:12]
    compiled = dict(body, version=digest, schema=1)
    size = doc_bytes(compiled)
    if size > MAX_DOC_BYTES:
        raise DefinitionError(f"compiled definition is {size} bytes, over the 256 KiB document limit")
    if joins:
        # Beside the definition, outside the version digest: seeded to meta/join, never meta/definition.
        compiled["join"] = json.loads(json.dumps(joins[0][1]))
    return compiled
