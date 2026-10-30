"""n8n workflows to migration plans. Standard library only (Python 3.11+).

parse() reads a workflow (never runs it) and returns a routineos.migration.v1 plan for migrate.emit. search()
and fetch() read the public n8n template gallery through pack.read_source (https only, no redirects, public
addresses only, a size cap). Nothing is written to disk. Node and parameter names come from
research/migrate.md and the n8n source listed in the migrate design, section M6.
"""
import json
import re
import urllib.parse

import migrate
import pack
import schema

SEARCH_URL = "https://api.n8n.io/api/templates/search?rows={rows}&page=1&search={query}"
FETCH_URL = "https://api.n8n.io/api/templates/workflows/{id}"
SEARCH_CAP = 1024 * 1024
FETCH_CAP = 2 * 1024 * 1024
MAX_ROWS = 20
MAX_QUERY = 200
ID_RE = re.compile(r"^[0-9]{1,12}\Z")
HOURLY = "0 * * * *"
MAX_INPUTS = 30
CODE_KEYS = ("jsCode", "pythonCode", "functionCode")
HTTP_SKIP = ("sendHeaders", "headerParameters", "specifyHeaders", "queryParameters", "sendQuery", "bodyParameters",
             "jsonBody", "body", "sendBody", "authentication", "genericAuthType", "nodeCredentialType", "options")

# Schedule (spec M6): interval key and default per field, and the time keys with their defaults.
INTERVAL = {"seconds": ("secondsInterval", 30), "minutes": ("minutesInterval", 5), "hours": ("hoursInterval", 1),
            "days": ("daysInterval", 1), "weeks": ("weeksInterval", 1), "months": ("monthsInterval", 1)}

OP_WORDS = {"equals": "is equal to", "notEquals": "is not equal to", "contains": "contains",
            "notContains": "does not contain", "startsWith": "starts with", "endsWith": "ends with",
            "notStartsWith": "does not start with", "notEndsWith": "does not end with",
            "regex": "matches the pattern", "notRegex": "does not match the pattern", "gt": "is greater than",
            "gte": "is at least", "lt": "is less than", "lte": "is at most", "exists": "exists",
            "notExists": "does not exist", "empty": "is empty", "notEmpty": "is not empty", "true": "is true",
            "false": "is false", "after": "is after", "before": "is before", "afterOrEquals": "is on or after",
            "beforeOrEquals": "is on or before"}
UNARY = ("exists", "notExists", "empty", "notEmpty", "true", "false")
LEGACY_OPS = {"equal": "equals", "notEqual": "notEquals", "isEmpty": "empty", "isNotEmpty": "notEmpty",
              "larger": "gt", "largerEqual": "gte", "smaller": "lt", "smallerEqual": "lte", "isTrue": "true",
              "isFalse": "false"}
TRIGGER_RANK = {"trigger.schedule": 0, "trigger.app": 1, "trigger.webhook": 2, "trigger.form": 2,
                "trigger.chat": 2, "trigger.subworkflow": 3, "trigger.manual": 4, "trigger.error": 5}
TRIGGER_NOTES = {
    "trigger.webhook": "The source starts on a web request. This routine runs on the schedule and reads requests "
                       "from the Desk queue.",
    "trigger.form": "The source starts when a form is submitted. This routine runs on the schedule and reads "
                    "submissions from the Desk queue.",
    "trigger.chat": "The source starts on a chat message. RoutineOS has no chat entry, so this routine runs on the "
                    "schedule.",
    "trigger.manual": "The source starts by hand. This routine runs on the schedule and can be run from the Desk.",
    "trigger.subworkflow": "The source is called by another workflow. This routine runs on the schedule.",
    "trigger.error": "The source runs when another workflow fails. This routine runs on the schedule.",
    "trigger.app": "The source starts on an event in an app. This routine polls for new items every hour."}

# Expressions (spec M10b)

_EXPR_RE = re.compile(r"\{\{(.*?)\}\}", re.S)
_PATH = r"((?:\.[A-Za-z_$][\w$]*|\[\s*(?:\"[^\"]*\"|'[^']*'|\d+)\s*\])*)"
_PART_RE = re.compile(r"\.([A-Za-z_$][\w$]*)|\[\s*(?:\"([^\"]*)\"|'([^']*)'|(\d+))\s*\]")
_QUOTED = r"(?:\"([^\"]*)\"|'([^']*)')"
_PREV_RE = re.compile(r"^(?:\$json|\$input\.(?:item|first\(\)|last\(\))\.json)" + _PATH + r"$")
_NODE_RE = re.compile(r"^(?:\$\(\s*" + _QUOTED + r"\s*\)\.(?:item|first\(\)|last\(\))|\$node\[\s*" + _QUOTED
                      + r"\s*\])\.json" + _PATH + r"$")
_NOW_RE = re.compile(r"^\$(?:now|today)(?:\.\w+\([^()]*\))*$")
_RESUME_RE = re.compile(r"^\$execution\.resumeUrl$")


def _path(raw):
    out = ""
    for m in _PART_RE.finditer(raw or ""):
        name = m.group(1) or m.group(2) or m.group(3)
        if name is not None:
            out += ("." if out else "") + name.replace("`", "'")
        else:
            out += f"[{m.group(4)}]"
    return out


def rewrite(text, names_to_ids):
    """(text, inputs, issues): the expressions in `text` rewritten as plain words (spec M10b). A string that
    starts with '=' is an expression; '{{ }}' parts are rewritten wherever they appear. `names_to_ids` maps
    source node names to step ids. `inputs` lists each reference; `issues` are expression issues without a
    `where`."""
    if not isinstance(text, str):
        return text, [], []
    is_expr = text.startswith("=")
    if not is_expr and "{{" not in text:
        return text, [], []
    body = text[1:] if is_expr else text
    inputs, issues = [], []

    def add(items, value):
        if value not in items:
            items.append(value)

    def phrase(m):
        expr = " ".join(m.group(1).split())
        hit = _PREV_RE.match(expr)
        if hit:
            path = _path(hit.group(1))
            out = f"`{path}` from the previous step" if path else "the previous step's output"
            add(inputs, out)
            return out
        hit = _NODE_RE.match(expr)
        if hit:
            name = next(g for g in hit.groups()[:4] if g is not None)
            sid = names_to_ids.get(name)
            if sid:
                path = _path(hit.group(5))
                out = f"`{path}` from step `{sid}`" if path else f"the output of step `{sid}`"
                add(inputs, out)
                return out
            add(issues, {"level": "needs-person", "concept": "expression",
                         "message": MISSING_STEP + ": "
                                    f"`{expr.replace(chr(96), chr(39))}`."})
            return f"`{expr.replace(chr(96), chr(39))}`"
        if _NOW_RE.match(expr):
            return "the run's start time"
        if _RESUME_RE.match(expr):
            add(issues, {"level": "info", "concept": "expression",
                         "message": "The resume link is replaced by the gate decision."})
            return "the gate decision"
        shown = expr.replace("`", "'")
        add(issues, {"level": "needs-person", "concept": "expression",
                     "message": f"An expression was kept as written and needs a person: `{shown}`."})
        return f"`{shown}`"

    return _EXPR_RE.sub(phrase, body), inputs, issues


# Schedule (spec M6)


def _int(value, default):
    if isinstance(value, bool):
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _within(value, low, high, default):
    n = _int(value, default)
    return n if low <= n <= high else default


def _days(value):
    """The sorted day-of-week numbers of triggerAtDay (0 is Sunday); [0] when absent."""
    items = value if isinstance(value, list) else [value] if value is not None else [0]
    out = sorted({_int(x, -1) for x in items if 0 <= _int(x, -1) <= 6})
    return out or [0]


def _cron_field(expression):
    """(cron, notes) for an n8n cron expression: the seconds field dropped, the minute field made one number."""
    notes = []
    fields = expression.split()
    if len(fields) == 6:
        fields = fields[1:]
    if len(fields) != 5:
        return migrate.DEFAULT_CRON, [("needs-person", "The cron expression could not be read, so the default "
                                       "schedule was used.")]
    minute = fields[0]
    if not (minute.isdigit() and int(minute) <= 59):
        found = re.search(r"\d+", minute)
        fields[0] = found.group(0) if found and int(found.group(0)) <= 59 else "0"
        notes.append(("needs-person", f"The cron minute field '{minute}' runs more often than hourly. RoutineOS "
                                      f"runs at most hourly, so minute {fields[0]} was used."))
    cron = " ".join(fields)
    if schema._lint_schedule(cron):
        return migrate.DEFAULT_CRON, [("needs-person", "The cron expression could not be used, so the default "
                                       "schedule was used.")]
    return cron, notes


MISSING_STEP = "An expression names a step that is not in the workflow"


def schedule_cron(params):
    """(cron, notes) for a Schedule Trigger's parameters; notes are (level, message) pairs. Only the first rule
    is used (spec M6)."""
    params = params if isinstance(params, dict) else {}
    rule = params.get("rule") if isinstance(params.get("rule"), dict) else {}
    items = rule.get("interval") if isinstance(rule.get("interval"), list) else []
    item = items[0] if items and isinstance(items[0], dict) else {}
    notes = []
    if len(items) > 1:
        notes.append(("needs-person", f"The schedule has {len(items)} rules. Only the first was used."))
    field = item.get("field", "days")
    if field == "cronExpression":
        expression = item.get("expression")
        if not isinstance(expression, str) or expression.startswith("="):
            return migrate.DEFAULT_CRON, notes + [("needs-person", "The cron expression is not plain text, so the "
                                                   "default schedule was used.")]
        cron, more = _cron_field(expression)
        return cron, notes + more
    key, default = INTERVAL.get(field, INTERVAL["days"])
    n = max(1, _int(item.get(key), default))
    hour = _within(item.get("triggerAtHour"), 0, 23, 0)
    minute = _within(item.get("triggerAtMinute"), 0, 59, 0)
    if field in ("seconds", "minutes"):
        return HOURLY, notes + [("needs-person", f"The source runs every {n} {field}. RoutineOS runs at most "
                                                 "hourly, so the routine runs every hour.")]
    if field == "hours":
        if n > 23:
            return f"{minute} 0 * * *", notes + [("needs-person", f"The source runs every {n} hours; the routine "
                                                  "runs daily.")]
        return f"{minute} " + ("*" if n == 1 else f"*/{n}") + " * * *", notes
    if field == "weeks":
        if n > 1:
            notes.append(("needs-person", f"The source runs every {n} weeks; the routine runs every week."))
        days = ",".join(str(d) for d in _days(item.get("triggerAtDay")))
        return f"{minute} {hour} * * {days}", notes
    if field == "months":
        dom = _within(item.get("triggerAtDayOfMonth"), 1, 31, 1)
        return f"{minute} {hour} {dom} " + ("*" if n == 1 else f"*/{n}") + " *", notes
    return f"{minute} {hour} " + ("*" if n == 1 else f"*/{n}") + " * *", notes


# Template gallery (spec M8)


def _read(url, cap, opener):
    try:
        raw = pack.read_source(url, cap, opener or pack.no_redirect_opener())
    except pack.PackError as exc:
        raise migrate.MigrateError(str(exc))
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise migrate.MigrateError("the n8n template service did not return JSON")
    if not isinstance(data, dict):
        raise migrate.MigrateError("the n8n template service returned an unexpected shape")
    return data


def search(query, rows=10, opener=None):
    """{'total': int, 'results': [{'id', 'name', 'views'}]} from the template gallery. `rows` is held to 1..20."""
    if not isinstance(query, str) or not query.strip():
        raise migrate.MigrateError("a search needs some words")
    if len(query) > MAX_QUERY:
        raise migrate.MigrateError(f"a search can be at most {MAX_QUERY} characters")
    try:
        rows = max(1, min(MAX_ROWS, int(rows)))
    except (TypeError, ValueError):
        raise migrate.MigrateError("rows must be a number")
    url = SEARCH_URL.format(rows=rows, query=urllib.parse.quote(query.strip(), safe=""))
    data = _read(url, SEARCH_CAP, opener)
    found = data.get("workflows") if isinstance(data.get("workflows"), list) else []
    results = []
    for w in found[:rows]:
        if not isinstance(w, dict):
            continue
        views = w.get("totalViews", w.get("views"))
        results.append({"id": w.get("id"), "name": migrate.clean(w.get("name"), "search result", []),
                        "views": views if isinstance(views, int) and not isinstance(views, bool) else 0})
    total = data.get("totalWorkflows")
    return {"total": total if isinstance(total, int) and not isinstance(total, bool) else len(results),
            "results": results}


def fetch(template_id, opener=None):
    """(workflow, source) for one template id. The workflow is the importable JSON with the template's name
    and description filled in; the source marks it untrusted."""
    tid = template_id if isinstance(template_id, str) else str(template_id) if isinstance(template_id, int) \
        and not isinstance(template_id, bool) else ""
    if not ID_RE.match(tid):
        raise migrate.MigrateError("a template id is 1 to 12 digits")
    url = FETCH_URL.format(id=tid)
    data = _read(url, FETCH_CAP, opener)
    outer = data.get("workflow")
    if not isinstance(outer, dict):
        raise migrate.MigrateError(f"template {tid} has no workflow nodes")
    # Real shape: response.workflow holds gallery metadata (its own "nodes" lack types) and the importable
    # workflow under response.workflow.workflow. A flat shape is accepted only when it has "connections".
    inner = outer.get("workflow")
    if isinstance(inner, dict) and isinstance(inner.get("nodes"), list):
        data = outer
    elif isinstance(outer.get("nodes"), list) and "connections" in outer:
        data, inner = outer, outer
    else:
        raise migrate.MigrateError(f"template {tid} has no workflow nodes")
    workflow = dict(inner)
    name = migrate.clean(data.get("name") or workflow.get("name"), "template name", [])
    if name:
        workflow["name"] = name
    if isinstance(data.get("description"), str):
        workflow.setdefault("description", data["description"])
    source = {"tool": "n8n", "name": name or f"n8n template {tid}", "ref": f"n8n template {tid}", "url": url,
              "untrusted": True}
    return workflow, source


# Parsing


def _tail(node_type):
    return str(node_type).rsplit(".", 1)[-1]


def _params(node):
    return node["parameters"] if isinstance(node.get("parameters"), dict) else {}


def _text(value):
    return value.strip() if isinstance(value, str) else ""


def _short(text, limit):
    text = " ".join(str(text).split())
    return text if len(text) <= limit else text[:limit - 3].rstrip() + "..."


def _resource_name(value):
    """The cached name of a resource locator value, or ''."""
    if isinstance(value, dict):
        return _text(value.get("cachedResultName"))
    return ""


def _host(url):
    """The host of the first URL in `url`, letters, digits, dots and hyphens only; '' when there is none."""
    m = re.search(r"https?://(?:[^/@\s{]*@)?([A-Za-z0-9.-]+)", url if isinstance(url, str) else "")
    return m.group(1).strip(".") if m else ""


_REF_RE = re.compile(r"\$\(\s*(?:'([^']+)'|\"([^\"]+)\")\s*\)|\$node\[\s*(?:'([^']+)'|\"([^\"]+)\")\s*\]"
                     r"|\$node\.([A-Za-z_]\w*)")


def _collect(value, out):
    """Every string inside a parameters value."""
    if isinstance(value, str):
        out.append(value)
    elif isinstance(value, dict):
        for v in value.values():
            _collect(v, out)
    elif isinstance(value, list):
        for v in value:
            _collect(v, out)


_VERBS = ("send", "post", "create", "delete", "remove", "update", "publish", "trigger", "notify", "execute",
          "run")
_CAMEL_VERB = re.compile(r"(?:" + "|".join(_VERBS) + r")(?=[A-Z0-9_-])")


def _mutating_url(url):
    """True when the path or query of `url` has a segment that names a mutating verb."""
    if not isinstance(url, str):
        return False
    rest = re.sub(r"^=?\s*(?:https?://[^/?#]*)?", "", url.strip())
    for seg in re.split(r"[/?&=#.:,;{}\s]+", rest):
        if _CAMEL_VERB.match(seg) and seg[0].islower():
            return True
        if any(tok.lower() in _VERBS for tok in re.split(r"[-_]", seg)):
            return True
    return False


_BAD = (TypeError, AttributeError, KeyError, ValueError, IndexError)


class _Parser:
    def __init__(self, workflow, outer, source, where=None):
        self.wf, self.outer, self.where = workflow, outer, where or {}
        self.issues, self.seen_issues = [], set()
        self.connectors, self.credentials, self.collections, self.cred_seen = {}, [], [], set()
        self.inputs, self.extra, self.unverified = {}, {}, set()
        self.name_to_id = {}
        nodes = workflow.get("nodes")
        if not isinstance(nodes, list):
            raise migrate.MigrateError("the workflow has no nodes list")
        self.nodes = [n for n in nodes if isinstance(n, dict) and isinstance(n.get("name"), str)]
        self.by_name = {n["name"]: n for n in self.nodes}
        self.pos = {n["name"]: i for i, n in enumerate(self.nodes)}
        self.settings = workflow.get("settings") if isinstance(workflow.get("settings"), dict) else {}
        self.source_arg = source
        self.main, self.incoming, self.subs, self.ai_nodes = {}, {}, {}, set()
        self._connections()

    # Plumbing

    def bad(self, name):
        return migrate.MigrateError(f"node {self.where.get(name, '?')} has a setting of the wrong type and could "
                                    "not be read")

    def c(self, text, where):
        return migrate.clean(text, where, self.issues)

    def issue(self, level, message, concept=None, where=None):
        key = (level, concept, where, message)
        if key in self.seen_issues:
            return
        self.seen_issues.add(key)
        item = {"level": level, "message": message}
        if concept:
            item["concept"] = concept
        if where:
            item["where"] = where
        self.issues.append(item)

    def rw(self, text, sid):
        """Rewrite one string for step `sid`, recording its inputs and expression issues."""
        out, inputs, issues = rewrite(text, self.name_to_id)
        have = self.inputs.setdefault(sid, [])
        for i in inputs:
            if i not in have and len(have) < MAX_INPUTS:
                have.append(i)
        for x in issues:
            if not x["message"].startswith(MISSING_STEP):
                self.issue(x["level"], x["message"], x["concept"], sid)
        return out

    def scan(self, node, sid, skip=CODE_KEYS):
        """Record the references in every expression of a node's parameters."""
        def walk(v, key=None):
            if key in skip:
                return
            if isinstance(v, str):
                if v.startswith("=") or "{{" in v:
                    self.rw(v, sid)
            elif isinstance(v, dict):
                for k, x in v.items():
                    walk(x, k)
            elif isinstance(v, list):
                for x in v:
                    walk(x)
        walk(_params(node))

    def _connections(self):
        conns = self.wf.get("connections") if isinstance(self.wf.get("connections"), dict) else {}
        for n in self.nodes:
            src = n["name"]
            kinds = conns.get(src) if isinstance(conns.get(src), dict) else {}
            for ctype, slots in kinds.items():
                if not isinstance(slots, list):
                    continue
                for index, slot in enumerate(slots):
                    for link in slot if isinstance(slot, list) else []:
                        dest = link.get("node") if isinstance(link, dict) else None
                        if not isinstance(dest, str) or dest not in self.by_name:
                            continue
                        if ctype == "main":
                            self.main.setdefault(src, {}).setdefault(index, []).append(dest)
                            self.incoming.setdefault(dest, []).append(src)
                        elif isinstance(ctype, str) and ctype.startswith("ai_"):
                            self.subs.setdefault(dest, []).append((ctype, src))
                            self.ai_nodes.add(src)

    def disabled(self, n):
        return n.get("disabled") is True

    def trigger_concept(self, n):
        t = str(n.get("type", ""))
        if t == "n8n-nodes-base.start":
            return "trigger.manual"
        hit = migrate.lookup(t, "n8n")
        if hit and hit["kind"] == "concept" and migrate.concept(hit["id"])["family"] == "trigger":
            return hit["id"]
        if t.endswith("Trigger"):
            return "trigger.app"
        return None

    def succ(self, name):
        """Main-connection successors of a node: by output index, then by file order."""
        out = []
        for index in sorted(self.main.get(name, {})):
            for dest in sorted(self.main[name][index], key=self.pos.get):
                if dest not in out:
                    out.append(dest)
        return out

    # The walk

    def order(self, starts):
        """Node names in run order: breadth-first from the starts, then anything unreachable in file order."""
        seen, queue, out = set(starts), list(starts), []
        while queue:
            name = queue.pop(0)
            out.append(name)
            for dest in self.succ(name):
                if dest not in seen and dest not in self.ai_nodes:
                    seen.add(dest)
                    queue.append(dest)
        rest = [n["name"] for n in self.nodes if n["name"] not in seen and n["name"] not in self.ai_nodes]
        return out, rest

    # Triggers

    def trigger(self, triggers):
        """(plan trigger, poll step node or None, the primary trigger node or None)."""
        live = [n for n in triggers if not self.disabled(n)]
        for n in triggers:
            if self.disabled(n):
                self.issue("info", f"Trigger '{self.c(n['name'], 'trigger')}' is disabled and was skipped.",
                           None, "trigger")
        ranked = sorted(live, key=lambda n: (TRIGGER_RANK.get(self.trigger_concept(n), 9), self.pos[n["name"]]))
        tz = _text(self.settings.get("timezone"))
        if not ranked:
            self.issue("info", "The workflow has no trigger. It runs on the default schedule.", "trigger.manual",
                       "trigger")
            trig = {"concept": "trigger.manual", "cron": migrate.DEFAULT_CRON, "note": TRIGGER_NOTES["trigger.manual"]}
            return self.zone(trig, tz), None, None
        n = ranked[0]
        cid = self.trigger_concept(n)
        for other in ranked[1:]:
            oc = self.trigger_concept(other)
            if oc == "trigger.error":
                continue
            self.issue("info", f"A second trigger '{self.c(other['name'], 'trigger')}' ({oc}) was reported only. "
                               f"The routine uses '{self.c(n['name'], 'trigger')}'.", oc, "trigger")
        status = migrate.concept(cid)["status"]
        if cid == "trigger.schedule":
            if n.get("type") == "n8n-nodes-base.cron":
                cron = migrate.DEFAULT_CRON
                self.issue("unverified", "The older Cron node was not read. The default schedule was used.", cid,
                           "trigger")
            else:
                try:
                    cron, notes = schedule_cron(_params(n))
                except _BAD as e:
                    raise self.bad(n["name"]) from e
                for level, message in notes:
                    self.issue(level, message, cid, "trigger")
            trig = {"concept": cid, "cron": cron}
        elif cid == "trigger.app":
            trig = {"concept": cid, "cron": HOURLY, "note": TRIGGER_NOTES[cid]}
            self.issue("info", TRIGGER_NOTES[cid], cid, "trigger")
        else:
            trig = {"concept": cid, "cron": migrate.DEFAULT_CRON, "note": TRIGGER_NOTES[cid]}
            self.issue(status if status in ("needs-person", "unmapped") else "info",
                       TRIGGER_NOTES[cid], cid, "trigger")
        return self.zone(trig, tz), n, n

    def zone(self, trig, tz):
        if tz:
            trig["timezone"] = self.c(tz, "trigger.timezone")
            self.issue("info", f"The source timezone is {trig['timezone']}. RoutineOS schedules are UTC and the "
                               "hours were not shifted.", "trigger.schedule", "trigger")
        return trig

    # Connectors and credentials

    def connector(self, app, access):
        cid = migrate._connector_id(app, access)
        self.connectors.setdefault(cid, {"id": cid, "app": app, "access": access})
        return cid

    def app_issue(self, app, sid):
        info = migrate.app_info(app) or {}
        if app != "http" and info.get("claude_connector") != "verified" and app not in self.unverified:
            self.unverified.add(app)
            self.issue("unverified", f"{info.get('label', app)} is not a verified claude.ai connector. It is "
                                     "offered through Zapier MCP and needs checking.", "step.app", sid)

    def creds(self, node, sid):
        found = node.get("credentials") if isinstance(node.get("credentials"), dict) else {}
        for ctype, ref in found.items():
            name = _text(ref.get("name")) if isinstance(ref, dict) else ""
            item = {"type": self.c(str(ctype), "credentials"), "name": self.c(name or str(ctype), "credentials")}
            if sid:
                item["step"] = sid
            key = (item["type"], item["name"], sid)
            if key not in self.cred_seen:
                self.cred_seen.add(key)
                self.credentials.append(item)
                self.issue("setup", f"Create a connection for {item['type']} ('{item['name']}'). Credential "
                                           "values are never copied.", "credential", sid)

    # Steps

    def op_of(self, n):
        op = _params(n).get("operation")
        return op if isinstance(op, str) and op and not op.startswith("=") else None

    def http_access(self, n, tool=False):
        """(method, access). A GET or HEAD whose path or query carries a mutating verb counts as a write; a
        toolHttpRequest with no stated method does too, since the model fills in the call."""
        p = _params(n)
        stated = p.get("method") or p.get("requestMethod")
        method = str(stated or "GET").upper()
        if method not in ("GET", "HEAD") or (tool and not stated) or _mutating_url(p.get("url")):
            return method, "write"
        return method, "read"

    def read_note(self, access, sid):
        if access == "read":
            self.issue("info", "Confirm this request changes nothing.", "step.http", sid)

    def http_does(self, n, sid):
        method, access = self.http_access(n)
        p = _params(n)
        host = _host(p.get("url"))
        self.scan_http(n, sid)
        if any(p.get(k) not in (None, "", False, {}, [], "none") for k in HTTP_SKIP):
            self.issue("info", "Headers, query values, body values and authentication were not copied.",
                       "step.http", sid)
        where = f"the host {host}" if host else "an address set at run time"
        self.read_note(access, sid)
        return f"Calls {where} with {method}.", method, access

    def scan_http(self, n, sid):
        url = _params(n).get("url")
        if isinstance(url, str) and (url.startswith("=") or "{{" in url):
            self.rw(url, sid)

    def cond_value(self, v, sid):
        if isinstance(v, bool) or isinstance(v, (int, float)):
            return str(v).lower() if isinstance(v, bool) else str(v)
        if not isinstance(v, str):
            return "a value"
        out = self.rw(v, sid)
        out = _short(out, 80)
        return out if out != v or "`" in out else f'"{out}"'

    def cond_text(self, left, op, right, sid):
        key = LEGACY_OPS.get(op, op)
        word = OP_WORDS.get(key, str(op))
        text = f"{self.cond_value(left, sid)} {word}"
        return text if key in UNARY or right is None else f"{text} {self.cond_value(right, sid)}"

    def conditions(self, cond, sid):
        """Plain words for an IF v2 / Filter / Switch conditions block, or '' when unreadable."""
        parts = []
        if isinstance(cond, dict):
            for c in cond.get("conditions", []) if isinstance(cond.get("conditions"), list) else []:
                if isinstance(c, dict):
                    op = c.get("operator", {})
                    parts.append(self.cond_text(c.get("leftValue"), op.get("operation") if isinstance(op, dict)
                                                else None, c.get("rightValue"), sid))
            joiner = " or " if cond.get("combinator") == "or" else " and "
            for kind in ("string", "number", "boolean", "dateTime"):
                for c in cond.get(kind, []) if isinstance(cond.get(kind), list) else []:
                    if isinstance(c, dict):
                        parts.append(self.cond_text(c.get("value1"), c.get("operation"), c.get("value2"), sid))
            if cond.get("combineOperation") == "any":
                joiner = " or "
            return joiner.join(parts) if parts else ""
        return ""

    def branch_does(self, n, sid):
        p, tail = _params(n), _tail(n["type"])
        if tail == "switch":
            rules = p.get("rules", {}).get("values") if isinstance(p.get("rules"), dict) else None
            lines = []
            for i, r in enumerate(rules if isinstance(rules, list) else []):
                if isinstance(r, dict):
                    label = _text(r.get("outputKey")) or f"output {i + 1}"
                    text = self.conditions(r.get("conditions"), sid)
                    if text:
                        lines.append(f"{label}: {text}")
            if lines:
                return "Routes each item. " + "; ".join(lines) + "."
        else:
            text = self.conditions(p.get("conditions"), sid)
            if text:
                return (f"Keeps items where {text}." if tail == "filter"
                        else f"Checks whether {text}. The true output continues one way, the false output another.")
        self.issue("info", "The condition could not be read from the source, so the step is described in general "
                           "terms.", "step.branch", sid)
        return {"if": "Checks a condition and routes items.", "switch": "Routes items by rules.",
                "filter": "Keeps only the items that match a condition."}.get(tail, "Checks a condition.")

    def transform_does(self, n, sid):
        p, tail = _params(n), _tail(n["type"])
        if tail == "set":
            pairs = []
            assigns = p.get("assignments", {}).get("assignments") if isinstance(p.get("assignments"), dict) else None
            for a in assigns if isinstance(assigns, list) else []:
                if isinstance(a, dict) and _text(a.get("name")):
                    pairs.append((_text(a["name"]), a.get("value")))
            values = p.get("values") if isinstance(p.get("values"), dict) else {}
            for kind in ("string", "number", "boolean"):
                for a in values.get(kind, []) if isinstance(values.get(kind), list) else []:
                    if isinstance(a, dict) and _text(a.get("name")):
                        pairs.append((_text(a["name"]), a.get("value")))
            if pairs:
                shown = [f"`{k}` = {self.cond_value(v, sid)}" for k, v in pairs[:10]]
                return "Sets " + ", ".join(shown) + (f" and {len(pairs) - 10} more" if len(pairs) > 10 else "") + "."
            self.issue("info", "The fields this step sets could not be read from the source.", "step.transform",
                       sid)
            return "Sets or changes fields on each item."
        return f"Reshapes the items ({tail})."

    def code_step(self, n, step):
        p = _params(n)
        lang = "python" if str(p.get("language", "")).lower().startswith("python") or "pythonCode" in p \
            else "javascript"
        key = {"python": "pythonCode"}.get(lang, "jsCode")
        body = p.get(key) if isinstance(p.get(key), str) else p.get("functionCode")
        step["code"] = {"language": lang, "text": self.c(body if isinstance(body, str) else "", f"{step['id']}.code")}
        step["does"] = f"Runs custom {lang} code. The original code is kept beside the stub."
        self.issue("needs-person", f"The {lang} code was not translated. A stub was written and the original is "
                                   "kept for a person to translate.", "step.code", step["id"])

    def model_step(self, n, step):
        p = _params(n)
        opts = p.get("options") if isinstance(p.get("options"), dict) else {}
        system = _text(opts.get("systemMessage")) or _text(opts.get("systemPromptTemplate"))
        msgs = p.get("messages", {}).get("messageValues") if isinstance(p.get("messages"), dict) else None
        if not system and isinstance(msgs, list):
            system = "\n\n".join(_text(m.get("message")) for m in msgs if isinstance(m, dict) and _text(m.get("message")))
        prompt = next((_text(p.get(k)) for k in ("text", "prompt", "inputText", "query") if _text(p.get(k))), "")
        sid = step["id"]
        cats = p.get("categories", {}).get("categories") if isinstance(p.get("categories"), dict) else None
        names = [_text(c.get("category")) for c in cats if isinstance(c, dict)] if isinstance(cats, list) else []
        if any(names):
            system = (system + "\n\n" if system else "") + "Categories: " + ", ".join(x for x in names if x) + "."
        skill = {}
        if system:
            skill["system"] = self.c(self.rw(system, sid), f"{sid}.system")
        if prompt:
            skill["prompt"] = self.c(self.rw(prompt, sid), f"{sid}.prompt")
        if skill:
            step["skill"] = skill
        step["does"] = "Runs a model with the agent's instructions." if step["concept"] == "step.agent" \
            else "Runs a model on the input with the source's instructions."

    def wait_step(self, n, step):
        p = _params(n)
        resume = str(p.get("resume", "timeInterval"))
        if resume in ("webhook", "form") or _tail(n.get("type", "")) == "form":
            step["concept"] = "step.wait-approval"
            step["does"] = "Waits for a person to approve before the steps after it run."
            self.issue("info", "The source waits for a call or form. The gate covers this: a person approves on "
                               "the Desk.", "step.wait-approval", step["id"])
        else:
            amount, unit = p.get("amount"), _text(p.get("unit"))
            step["concept"] = "step.wait-time"
            step["does"] = "Waits before the next steps. In RoutineOS that is a run boundary: the next steps "\
                           "happen on the next run." + (f" The source waited {amount} {unit}." if amount and unit
                                                        else "")
            self.issue("info", "A timed wait becomes a run boundary.", "step.wait-time", step["id"])

    def app_step(self, n, hit, step):
        app, sid = hit["id"], step["id"]
        op = self.op_of(n)
        access = migrate.classify_access(op)
        label = (migrate.app_info(app) or {}).get("label", app)
        resource = _text(_params(n).get("resource"))
        step.update(app=app, access=access, connectors=[self.connector(app, access)])
        if op:
            step["op"] = "delete" if "delete" in op.lower() else self.c(op, f"{sid}.op")
        else:
            self.issue("info", "The operation is not stated, so the step is treated as a write.", "step.app", sid)
        verb = f"{op}" if op else "an action"
        what = f" on {resource}" if resource else ""
        step["does"] = f"Does '{verb}'{what} in {label} ({access})."
        self.app_issue(app, sid)

    def make_step(self, n, sid):
        t = str(n.get("type", ""))
        hit = migrate.lookup(t, "n8n")
        step = {"id": sid, "title": self.c(n["name"], f"{sid}.title"), "source": self.c(n["name"], f"{sid}.source")}
        if hit is None:
            step.update(concept="step.unknown", does=f"The node type '{self.c(t, sid)}' has no mapping.")
            self.issue("unmapped", f"Node '{step['title']}' ({self.c(t, sid)}) has no mapping and became a "
                                   "placeholder step.", "step.unknown", sid)
            self.scan(n, sid)
            return step
        cid = hit["id"]
        step["concept"] = "step.app" if hit["kind"] == "app" else cid
        if hit["kind"] == "app" and "sendandwait" in (self.op_of(n) or "").lower():
            step["concept"] = "step.wait-approval"
            step["does"] = "Waits for a person to approve before the steps after it run."
            self.issue("info", "The source sends a message and waits for the answer (sendAndWait). The gate covers "
                               "this: a person approves on the Desk, and the message is not sent.",
                       "step.wait-approval", sid)
            self.scan(n, sid)
        elif hit["kind"] == "app":
            self.app_step(n, hit, step)
            self.scan(n, sid)
        elif cid == "step.http":
            step["does"], method, access = self.http_does(n, sid)
            step.update(app="http", access=access, op=method, connectors=[self.connector("http", access)])
        elif cid == "step.code":
            self.code_step(n, step)
        elif cid in ("step.agent", "step.llm"):
            self.model_step(n, step)
            self.scan(n, sid)
        elif cid == "step.branch":
            step["does"] = self.branch_does(n, sid)
            outs = self.branch_outputs(n)
            if outs:
                step["does"] += " " + outs
            self.scan(n, sid)
        elif cid == "step.merge":
            srcs = [f"`{self.name_to_id.get(s, s)}`" for s in self.incoming.get(n["name"], [])]
            mode = _text(_params(n).get("mode")) or "append"
            step["does"] = f"Combines the inputs ({mode})" + (f" from {', '.join(srcs)}" if srcs else "") + "."
        elif cid == "step.loop":
            size = _params(n).get("batchSize")
            step["does"] = "Runs the steps that follow for each " + (f"batch of {size} items" if isinstance(
                size, int) and not isinstance(size, bool) else "batch of items") + "."
        elif cid == "step.transform":
            step["does"] = self.transform_does(n, sid)
            self.scan(n, sid)
        elif cid in ("step.wait-time", "step.wait-approval"):
            self.wait_step(n, step)
        elif cid == "step.respond":
            step["does"] = "Prepares the reply to the caller. The output goes to the Desk Inbox."
            self.issue("needs-person", "A response to the caller has no RoutineOS equivalent. The output goes to "
                                       "the Desk Inbox.", cid, sid)
        elif cid == "step.subworkflow":
            name = _resource_name(_params(n).get("workflowId")) or "a child workflow"
            step["does"] = f"Calls the workflow '{self.c(name, sid)}'. Fold it in or make it its own routine."
            self.issue("needs-person", f"Sub-workflow '{self.c(name, sid)}' must be folded in or made its own "
                                       "routine.", cid, sid)
        elif cid == "failure.node":
            msg = _text(_params(n).get("errorMessage"))
            step["does"] = "Stops the run with an error" + (f": {_short(self.rw(msg, sid), 120)}" if msg else ".")
            self.issue("info", "A Stop and Error step becomes a failure rule in the prompt.", cid, sid)
        elif cid == "step.noop":
            step["does"] = "Does nothing."
        else:
            step["does"] = f"Handles '{_tail(t)}' as a model step."
            self.scan(n, sid)
        if cid == "step.ai-vector":
            self.issue("unmapped", "RoutineOS has no vector store. This step needs a person.", cid, sid)
        elif cid == "step.ai-memory":
            self.memory(sid, sid)
        oe = n.get("onError")
        if n.get("continueOnFail") is True or oe in ("continueRegularOutput", "continueErrorOutput"):
            step["on_error"] = "continue"
            extra = " Its error output branch needs a person to wire." if oe == "continueErrorOutput" else ""
            self.issue("info", "The source continues past errors in this step, so the prompt says to continue."
                       + extra, "failure.node", sid)
        elif oe == "stopWorkflow":
            step["on_error"] = "stop"
        return step

    def branch_outputs(self, n):
        tail = _tail(n["type"])
        slots = self.main.get(n["name"], {})
        labels = {"if": ("true", "false"), "filter": ("kept", "dropped")}.get(tail)
        parts = []
        for index in sorted(slots):
            targets = [f"`{self.name_to_id.get(d, d)}`" for d in sorted(slots[index], key=self.pos.get)
                       if not self.disabled(self.by_name[d])]
            if targets:
                label = labels[index] if labels and index < len(labels) else f"output {index + 1}"
                parts.append(f"The {label} output goes to {', '.join(targets)}.")
        return " ".join(parts)

    def memory(self, sid, root_id):
        col = f"memory/{root_id}"
        if col not in self.collections:
            self.collections.append(col)
        self.issue("info", f"Memory becomes the store collection {col}. Session ids are not carried.",
                   "step.ai-memory", sid)

    # AI sub-nodes

    def fold(self, root_name, step, seen):
        for ctype, sub_name in self.subs.get(root_name, []):
            if sub_name in seen:
                continue
            seen.add(sub_name)
            sub = self.by_name[sub_name]
            if self.disabled(sub):
                self.issue("info", f"Sub-node '{self.c(sub_name, step['id'])}' is disabled and was skipped.", None,
                           step["id"])
                continue
            self.fold_one(step, ctype, sub)
            self.creds(sub, step["id"])
            self.fold(sub_name, step, seen)

    def fold_one(self, step, ctype, sub):
        sid, t = step["id"], str(sub.get("type", ""))
        label = self.c(sub["name"], sid)
        p = _params(sub)
        if ctype == "ai_languageModel":
            model = p.get("model")
            model = _text(model.get("value") if isinstance(model, dict) else model)
            self.issue("info", f"Model provider: {self.c(_tail(t), sid)}" + (f", model {self.c(model, sid)}"
                       if model else "") + ". RoutineOS runs on Claude.", "step.ai-model", sid)
        elif ctype == "ai_memory":
            self.memory(sid, sid)
            self.extra.setdefault(sid, []).append("Keeps a memory in the store.")
        elif ctype == "ai_outputParser":
            shape = _text(p.get("jsonSchemaExample")) or _text(p.get("inputSchema"))
            if shape and "skill" in step:
                step["skill"]["system"] = (step["skill"].get("system", "") + "\n\nOutput shape: "
                                           + self.c(_short(shape, 600), sid)).strip()
            self.issue("info", f"Output parser '{label}' is described in the skill, not enforced.",
                       "step.ai-output-parser", sid)
        elif ctype == "ai_tool":
            self.tool(step, sub, label)
        else:
            self.issue("unmapped", f"'{label}' ({ctype[3:]}) belongs to a vector or retrieval setup that RoutineOS "
                                   "does not have.", "step.ai-vector", sid)

    def tool(self, step, sub, label):
        sid, t = step["id"], str(sub.get("type", ""))
        p = _params(sub)
        hit = migrate.lookup(t, "n8n")
        if hit and hit["kind"] == "app":
            op = self.op_of(sub)
            access = migrate.classify_access(op)
            cid = self.connector(hit["id"], access)
            step.setdefault("connectors", [])
            if cid not in step["connectors"]:
                step["connectors"].append(cid)
            self.extra.setdefault(sid, []).append(f"Tool {label}: {hit['id']} ({access}).")
            self.issue("info", f"Tool '{label}' becomes the {hit['id']} connector ({access}).", "step.ai-tool", sid)
            self.app_issue(hit["id"], sid)
        elif hit and hit["id"] == "step.http" or t.endswith(".toolHttpRequest"):
            method, access = self.http_access(sub, tool=t.endswith(".toolHttpRequest"))
            self.read_note(access, sid)
            cid = self.connector("http", access)
            step.setdefault("connectors", [])
            if cid not in step["connectors"]:
                step["connectors"].append(cid)
            host = _host(p.get("url"))
            self.extra.setdefault(sid, []).append(f"Tool {label}: HTTP {method}" + (f" on {host}" if host else "")
                                                  + ".")
            self.issue("info", f"Tool '{label}' becomes the http connector ({access}). Headers and authentication "
                               "were not copied.", "step.ai-tool", sid)
        elif hit and hit["id"] == "step.ai-vector":
            self.issue("unmapped", f"Tool '{label}' searches a vector store. RoutineOS has no vector store.",
                       "step.ai-vector", sid)
        elif t.endswith(".toolWorkflow"):
            name = _resource_name(p.get("workflowId")) or "a child workflow"
            step["access"] = "write"
            self.issue("needs-person", f"Tool '{label}' calls the workflow '{self.c(name, sid)}'. Fold it in or "
                                       "make it its own routine.", "step.subworkflow", sid)
        elif t.endswith(".toolCode"):
            step["access"] = "write"
            self.issue("needs-person", f"Tool '{label}' runs code. It was not translated.", "step.code", sid)
        else:
            # Fail closed: a tool with no mapping may have side effects, so the step waits for approval.
            step["access"] = "write"
            self.extra.setdefault(sid, []).append(f"Tool {label}.")
            self.issue("needs-person", f"Tool '{label}' ({self.c(_tail(t), sid)}) has no RoutineOS mapping. Wire it "
                                       "to a connector or remove it; until then the step waits for approval.",
                       "step.ai-tool", sid)

    # Putting the plan together

    def run(self):
        outer = self.outer
        wf_name = _text(outer.get("name")) or _text(self.wf.get("name"))
        starts_all = [n for n in self.nodes if self.trigger_concept(n) and n["name"] not in self.ai_nodes]
        trig, poll_node, primary = self.trigger(starts_all)
        starts = [n["name"] for n in starts_all if not self.disabled(n)]
        if not starts:
            starts = [n["name"] for n in self.nodes if n["name"] not in self.incoming
                      and n["name"] not in self.ai_nodes and not n["type"].endswith("stickyNote")]
        walked, rest = self.order(starts)
        sticky = [n for n in self.nodes if str(n.get("type", "")).endswith("stickyNote")]
        trigger_names = {n["name"] for n in starts_all}
        flow = [x for x in walked + rest if x not in trigger_names and not str(
            self.by_name[x].get("type", "")).endswith("stickyNote")]
        for name in rest:
            if name not in trigger_names and self.by_name[name] not in sticky and not self.disabled(self.by_name[name]):
                self.issue("info", f"Node '{self.c(name, name)}' is not connected from the trigger. It was added "
                                   "at the end.", None, None)
        taken = set()
        poll_id = migrate.unique_slug(poll_node["name"], taken) if poll_node and \
            trig["concept"] == "trigger.app" else None
        for x in flow:
            if not self.disabled(self.by_name[x]):
                self.name_to_id[x] = migrate.unique_slug(x, taken)
        for name in trigger_names:
            self.name_to_id.setdefault(name, poll_id if name == (poll_node or {}).get("name") and poll_id
                                       else "trigger")
        for root, subs in self.subs.items():
            for _, sub_name in subs:
                if root in self.name_to_id:
                    self.name_to_id.setdefault(sub_name, self.name_to_id[root])
        on_error_only = self.error_branch(starts)
        steps = []
        if poll_id:
            steps.append(self.poll_step(poll_node, poll_id))
        for name in flow:
            n = self.by_name[name]
            if self.disabled(n):
                self.issue("info", f"Node '{self.c(name, name)}' is disabled and was skipped.", None, None)
                continue
            try:
                step = self.make_step(n, self.name_to_id[name])
                if step["concept"] != "step.wait-approval":
                    self.creds(n, step["id"])
                self.fold(name, step, set())
            except _BAD as e:
                raise self.bad(name) from e
            if self.extra.get(step["id"]):
                step["does"] = step["does"] + " " + " ".join(self.extra[step["id"]])
            if name in on_error_only:
                step["does"] = "Only if an earlier step failed: " + step["does"]
                self.issue("needs-person", f"{step['title']} sits on an error output, so it should run only when an "
                           "earlier step fails. RoutineOS has no error branch: check the prompt wording holds.",
                           "failure.node", step["id"])
            steps.append(step)
        for n in starts_all:
            if not self.disabled(n) and n is not poll_node:
                self.creds(n, None)
        if poll_node is not None and poll_id is None:
            self.creds(poll_node, None)
        self.add_needs(steps, poll_id, poll_node)
        for s in steps:
            s["does"] = self.c(s["does"], f"{s['id']}.does")
            if self.inputs.get(s["id"]):
                s["inputs"] = [self.c(i, f"{s['id']}.inputs") for i in self.inputs[s["id"]]]
        notes = []
        for n in sticky:
            text = _text(_params(n).get("content"))
            if text:
                notes.append(self.c(_short(text, 1000), "notes"))
        failure = self.failure(trig)
        self.state()
        title = self.c(wf_name, "name") or "Migrated n8n workflow"
        source = self.source(wf_name)
        used = {c for s in steps for c in s.get("connectors", [])}
        plan = {"format": migrate.FORMAT, "source": source, "id": migrate.slug(wf_name or "", "migrated-routine"),
                "title": title, "summary": self.summary(title, steps), "category": "general",
                "kind": self.kind(steps, poll_id), "trigger": trig, "steps": steps,
                "connectors": [c for cid, c in self.connectors.items() if cid in used]}
        for key, value in (("collections", self.collections), ("credentials", self.credentials), ("notes", notes)):
            if value:
                plan[key] = value
        if failure:
            plan["failure"] = failure
        plan["issues"] = self.issues
        return plan

    def error_index(self, n):
        """The output slot that carries errors for a node set to continueErrorOutput. n8n appends the error output
        after the node's own outputs (getNodeOutputs in
        https://raw.githubusercontent.com/n8n-io/n8n/master/packages/workflow/src/node-helpers.ts, fetched
        2026-10-30). If declares two outputs (.../nodes-base/nodes/If/V2/IfV2.node.ts) and Filter v2 declares one
        (.../Filter/V2/FilterV2.node.ts). Switch counts its rules plus the fallback; that count is read from the
        v3 parameters and is unverified for older versions."""
        tail, p = _tail(n.get("type", "")), _params(n)
        if tail == "if":
            return 2
        if tail == "switch":
            rules = (p.get("rules") or {}).get("values") if isinstance(p.get("rules"), dict) else None
            count = len(rules) if isinstance(rules, list) else 0
            extra = 1 if isinstance(p.get("options"), dict) and p["options"].get("fallbackOutput") == "extra" else 0
            return count + extra
        return 1

    def error_branch(self, starts):
        """Names of nodes reached only through an error output."""
        errors = {n["name"]: self.error_index(n) for n in self.nodes if n.get("onError") == "continueErrorOutput"
                  and not self.disabled(n)}
        if not errors:
            return set()

        def reach(roots, skip_errors):
            seen, queue = set(roots), list(roots)
            while queue:
                name = queue.pop()
                for index, dests in self.main.get(name, {}).items():
                    if skip_errors and errors.get(name) == index:
                        continue
                    for d in dests:
                        if d not in seen and d not in self.ai_nodes:
                            seen.add(d)
                            queue.append(d)
            return seen

        error_roots = {d for name, i in errors.items() for d in self.main.get(name, {}).get(i, [])}
        return reach(error_roots, False) - reach(starts, True)

    def add_needs(self, steps, poll_id, poll_node):
        """Set step['needs']: the step ids each step reads from, by named reference and by flow position."""
        order = {s["id"]: i for i, s in enumerate(steps)}
        owner = {sid: [self.by_name[x]] for x, sid in self.name_to_id.items()
                 if sid in order and x in self.by_name and x not in self.ai_nodes}
        if poll_id and poll_node is not None:
            owner[poll_id] = [poll_node]

        def nearest(name, seen):
            """Step ids reached from node `name`: its own step, else the nearest emitted ancestors."""
            sid = self.name_to_id.get(name)
            if sid in order:
                return [sid]
            out = []
            for prev in self.incoming.get(name, []):
                if prev not in seen:
                    seen.add(prev)
                    out += nearest(prev, seen)
            return out

        def group(root, seen):
            found = [root]
            for _, sub in self.subs.get(root["name"], []):
                if sub not in seen and sub in self.by_name:
                    seen.add(sub)
                    found += group(self.by_name[sub], seen)
            return found

        wants = {}
        for s in steps:
            nodes = [m for root in owner.get(s["id"], []) for m in group(root, {root["name"]})]
            strings = []
            for m in nodes:
                _collect(_params(m), strings)
            need, missing = set(), []
            for text in strings:
                for hit in _REF_RE.finditer(text):
                    name = next(g for g in hit.groups() if g is not None)
                    if name in self.by_name:
                        need.update(nearest(name, {name}))
                    elif name not in missing:
                        missing.append(name)
            # Flow position is a control dependency whatever the expressions name: a step wired after the gate
            # or a write step must not run before it.
            for root in owner.get(s["id"], []):
                for prev in self.incoming.get(root["name"], []):
                    need.update(nearest(prev, {prev, root["name"]}))
            for name in missing:
                shown = _short(self.c(name, f"{s['id']}.reference"), 80)
                self.issue("needs-person", f"{s['title']} refers to a node named '{shown}' that is not in this "
                                           "workflow.", "expression", s["id"])
            need.discard(s["id"])
            wants[s["id"]] = need
        self.sort_steps(steps, wants, lambda s: self.issue(
            "needs-person", f"{s['title']} is part of a loop in the source connections; its order was chosen by "
            "position, so check it.", None, s["id"]))

    @staticmethod
    def sort_steps(steps, wants, on_cycle=None):
        """Reorder `steps` so every need is an earlier step (stable: the walk order breaks ties). A cycle is
        broken by dropping the unplaced needs of its first step."""
        left, placed, out = list(steps), set(), []
        while left:
            ready = [s for s in left if wants[s["id"]] <= placed]
            pick = ready[0] if ready else left[0]
            if not ready:
                dropped = wants[pick["id"]] - placed
                wants[pick["id"]] -= dropped
                if dropped and on_cycle:
                    on_cycle(pick)
            left.remove(pick)
            placed.add(pick["id"])
            out.append(pick)
        steps[:] = out
        rank = {s["id"]: i for i, s in enumerate(steps)}
        for s in steps:
            need = sorted(wants[s["id"]], key=rank.get)
            if need:
                s["needs"] = need
            else:
                s.pop("needs", None)

    def poll_step(self, n, sid):
        hit = migrate.lookup(str(n.get("type", "")), "n8n")
        step = {"id": sid, "title": self.c(n["name"], f"{sid}.title"), "source": self.c(n["name"], f"{sid}.source")}
        if hit and hit["kind"] == "app":
            label = (migrate.app_info(hit["id"]) or {}).get("label", hit["id"])
            step.update(concept="step.app", app=hit["id"], access="read", op="poll",
                        does=f"Polls {label} for new items every hour.", connectors=[self.connector(hit["id"], "read")])
            self.app_issue(hit["id"], sid)
        elif hit:
            step.update(concept="step.http", app="http", access="read", op="poll",
                        does="Polls the source for new items every hour.", connectors=[self.connector("http", "read")])
        else:
            step.update(concept="step.unknown", does=f"The trigger type '{self.c(str(n.get('type')), sid)}' has no "
                                                     "mapping.")
            self.issue("unmapped", f"Trigger '{step['title']}' has no mapping and became a placeholder step.",
                       "step.unknown", sid)
        self.creds(n, sid)
        self.scan(n, sid)
        return step

    def failure(self, trig):
        ew = self.settings.get("errorWorkflow")
        named = isinstance(ew, (str, int)) and not isinstance(ew, bool) and str(ew) not in ("", "DEFAULT")
        has_trigger = any(str(n.get("type")) == "n8n-nodes-base.errorTrigger" for n in self.nodes
                          if not self.disabled(n))
        if not (named or has_trigger):
            return None
        if named:
            self.issue("info", "The source names an error workflow. A failure raises an Inbox alert instead.",
                       "failure.workflow", None)
        if has_trigger:
            self.issue("info", "This workflow starts on an error. Failures raise an Inbox alert.", "trigger.error",
                       "trigger" if trig["concept"] == "trigger.error" else None)
        return {"alert": True, "note": "A failed run raises an Inbox alert and the run is marked failed or partial."}

    def state(self):
        data = self.wf.get("staticData")
        if isinstance(data, dict) and data and any(v not in (None, {}, []) for v in data.values()):
            if "state/workflow" not in self.collections:
                self.collections.append("state/workflow")
            self.issue("info", "The source keeps state between runs (staticData). It becomes the store collection "
                               "state/workflow. The values are not copied.", "step.store", None)

    def source(self, wf_name):
        given = self.source_arg if isinstance(self.source_arg, dict) else {}
        src = {"tool": "n8n", "name": self.c(_text(given.get("name")) or wf_name or "n8n workflow", "source.name")}
        for key in ("ref", "url"):
            if _text(given.get(key)):
                src[key] = self.c(given[key], f"source.{key}")
        if isinstance(given.get("untrusted"), bool):
            src["untrusted"] = given["untrusted"]
        return src

    def summary(self, title, steps):
        desc = _text(self.outer.get("description")) or _text(self.wf.get("description"))
        if desc:
            return self.c(_short(desc, 300), "summary")
        return f"Migrated from the n8n workflow '{_short(title, 80)}' with {len(steps)} steps."

    def kind(self, steps, poll_id):
        work = [s for s in steps if s["concept"] not in ("step.noop", "step.note")]
        code = [s for s in work if s["concept"] == "step.code"]
        if work and len(code) == len(work):
            return "code"
        models = [s for s in work if s["concept"] in ("step.agent", "step.llm")]
        others = [s for s in work if s not in models and s["id"] != poll_id and s["concept"] != "step.respond"]
        if len(models) == 1 and not others:
            return "skill"
        return "hybrid" if code and len(code) * 2 >= len(work) else "workflow"


def parse(workflow, source=None):
    """A routineos.migration.v1 plan for an n8n workflow: a bare workflow or a template response that holds it
    under 'workflow'. Raises MigrateError when it is not a workflow."""
    if not isinstance(workflow, dict):
        raise migrate.MigrateError("an n8n workflow must be a JSON object")
    outer, wf = workflow, workflow
    while "nodes" not in wf and isinstance(wf.get("workflow"), dict):
        wf = wf["workflow"]
    if not isinstance(wf.get("nodes"), list):
        raise migrate.MigrateError("this is not an n8n workflow: it has no nodes list")
    nodes, skipped, where = [], [], {}
    names = {n["name"] for n in wf["nodes"] if isinstance(n, dict) and isinstance(n.get("name"), str)}
    for i, n in enumerate(wf["nodes"]):
        if not isinstance(n, dict):
            raise migrate.MigrateError(f"node {i + 1} is not an object")
        if not isinstance(n.get("type"), str) or not n["type"].strip():
            raise migrate.MigrateError(f"node {i + 1} has no text 'type'")
        if n.get("name") is None:
            # Connections refer to nodes by name, so a nameless node is never wired in.
            if n["type"].endswith("stickyNote"):
                n = dict(n, name=f"Sticky note {i}")
                while n["name"] in names:
                    n["name"] += "_"
                names.add(n["name"])
            else:
                skipped.append((i, n["type"]))
                continue
        elif not isinstance(n["name"], str) or not n["name"].strip():
            raise migrate.MigrateError(f"node {i + 1} has no text 'name'")
        if n.get("parameters") is not None and not isinstance(n["parameters"], dict):
            raise migrate.MigrateError(f"node {i + 1} has parameters that are not an object")
        where[n["name"]] = i + 1
        nodes.append(n)
    if wf.get("connections") is not None and not isinstance(wf["connections"], dict):
        raise migrate.MigrateError("the connections are not an object")
    wf = dict(wf, nodes=nodes)
    plan = _Parser(wf, outer, source, where).run()
    for i, kind in skipped:
        hit = migrate.lookup(kind, "n8n")
        label = (migrate.app_info(hit["id"]) or {}).get("label") if hit and hit["kind"] == "app" else None
        label = migrate.clean(label or _tail(kind), "node type", plan["issues"])
        plan["issues"].append({"level": "needs-person", "message": f"A {label} node (position {i + 1}) has no name "
                               "and was skipped; check the routine still does what you expect."})
    return plan
