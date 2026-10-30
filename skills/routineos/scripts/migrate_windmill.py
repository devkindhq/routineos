"""Windmill OpenFlow JSON to a migration plan. Standard library only (Python 3.11+).

Parsing only reads and classifies; migrate.emit is the one place that writes pack shapes. A flow is data: no code
in it is run, no path in it is fetched, and a credential is recorded by its path, never by a value.
Source: https://raw.githubusercontent.com/windmill-labs/windmill/main/openflow.openapi.yaml
"""
import json
import re

import migrate
from migrate import MigrateError

LOOP_PREFIX = "For each item: "
# FlowValue keys that have no RoutineOS equivalent; named in one info issue when present.
IGNORED_FLOW_KEYS = ("preprocessor_module", "same_worker", "preserve_step_tags", "early_return", "chat_input_enabled",
                     "priority", "concurrent_limit", "concurrency_key", "concurrency_time_window_s", "cache_ttl",
                     "delete_after_secs", "skip_expr", "flow_env", "groups")
STRUCTURAL = ("step.noop", "step.branch", "step.loop", "step.wait-approval", "step.note", "step.merge")
MODEL_STEPS = ("step.agent", "step.llm", "step.app", "step.http", "step.transform", "step.subworkflow", "step.unknown")
RESULT_REF = re.compile(r"\bresults\.([A-Za-z0-9_]+)((?:\.[A-Za-z0-9_]+)*)")
INPUT_REF = re.compile(r"\bflow_input\.([A-Za-z0-9_]+)((?:\.[A-Za-z0-9_]+)*)")
PURE_REF = re.compile(r"\s*(?:results|flow_input)\.[A-Za-z0-9_.]+\s*\Z")
RESERVED_SETTING = "max_inbox_per_run"


def load_text(text):
    """The flow object from JSON text. YAML is refused: the standard library cannot read it."""
    if not isinstance(text, str) or not text.lstrip().startswith("{"):
        raise MigrateError("Windmill YAML is not supported. Export the flow as JSON (an OpenFlow object starting "
                           "with '{') and run the command again.")
    try:
        flow = json.loads(text)
    except json.JSONDecodeError as exc:
        raise MigrateError(f"the flow is not valid JSON ({exc.msg} at line {exc.lineno}); export it as JSON")
    if not isinstance(flow, dict):
        raise MigrateError("the flow must be a JSON object")
    return flow


def setting_name(raw):
    """A valid setting name from a Windmill input name."""
    name = migrate.slug(raw, "input", 60).replace("-", "_")
    if not migrate.SETTING_NAME_RE.match(name):
        name = "s_" + name
    return name + "_input" if name == RESERVED_SETTING else name


def _tick(text, limit=300):
    """Text safe inside one pair of backticks, on one line."""
    text = " ".join(str(text).replace("`", "'").split())
    return text if len(text) <= limit else text[:limit - 3].rstrip() + "..."


def _num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def _words(text):
    return re.split(r"[^a-z0-9]+", str(text).casefold())


def _app_for(path):
    """The catalog app id a resource path names (by its last segment), or None."""
    seg = str(path).rstrip("/").rsplit("/", 1)[-1]
    norm = re.sub(r"[^a-z0-9]", "", seg.lower())
    cands = [norm] + [t for t in _words(seg) if t]
    for cand in cands:
        for app_id, info in migrate.load_concepts()["apps"].items():
            names = {app_id.lower(), re.sub(r"[^a-z0-9]", "", info.get("label", "").lower())}
            names |= {re.sub(r"[^a-z0-9]", "", n.lower()) for n in info.get("windmill", [])}
            if cand and cand in names:
                return app_id
    return None


class _Parser:
    def __init__(self, flow, source):
        self.flow = flow
        self.value = flow["value"]
        self.source = source
        self.steps, self.issues, self.connectors, self.credentials = [], [], [], []
        self.taken = set()
        self.ids = {}       # id(module dict) -> step id
        self.raw2sid = {}   # Windmill module id -> step id
        self.known_inputs = set()
        self.warned_inputs = set()

    # Issues and ids

    def issue(self, level, message, where=None, concept=None):
        row = {"level": level, "message": message}
        if where:
            row["where"] = where
        if concept:
            row["concept"] = concept
        if row not in self.issues:
            self.issues.append(row)

    def assign(self, modules):
        for m in modules if isinstance(modules, list) else []:
            if not isinstance(m, dict):
                continue
            v = m.get("value") if isinstance(m.get("value"), dict) else {}
            raw = m.get("id") if isinstance(m.get("id"), str) else ""
            sid = migrate.unique_slug(raw or m.get("summary") or v.get("type") or "step", self.taken)
            self.ids[id(m)] = sid
            self.raw2sid.setdefault(raw, sid)
            self.assign(v.get("modules"))
            for b in v.get("branches") if isinstance(v.get("branches"), list) else []:
                self.assign(b.get("modules") if isinstance(b, dict) else None)
            self.assign(v.get("default"))

    # Expressions and input transforms

    def expr(self, text, sid, inputs, label):
        """Readable text for a JavaScript expression; adds explicit inputs; flags what it could not rewrite."""
        text = str(text)
        for m in RESULT_REF.finditer(text):
            other = self.raw2sid.get(m.group(1)) or migrate.slug(m.group(1), "step")
            field = m.group(2).lstrip(".") or "result"
            self._input(inputs, f"`{field}` from step `{other}`")
        for m in INPUT_REF.finditer(text):
            if m.group(1) == "iter":
                self._input(inputs, "The current loop item")
                continue
            name = setting_name(m.group(1))
            self._input(inputs, f"Setting `{name}`")
            if name not in self.known_inputs and name not in self.warned_inputs:
                self.warned_inputs.add(name)
                self.issue("info", f"The flow reads input `{m.group(1)}`, which is not in its schema; add a setting "
                           f"called `{name}` if it matters.", where=sid, concept="expression")
        if PURE_REF.match(text):
            return f"`{_tick(text)}`"
        self.issue("needs-person", f"{label} is an expression kept as written: `{_tick(text)}`. Check what it does.",
                   where=sid, concept="expression")
        return f"`{_tick(text)}`"

    @staticmethod
    def _input(inputs, text):
        if text not in inputs:
            inputs.append(text)

    def scan_static(self, value, sid, conns):
        if isinstance(value, str):
            if value.startswith("$res:"):
                self.resource(value[5:], sid, conns)
            elif value.startswith("$var:"):
                self.variable(value[5:], sid)
        elif isinstance(value, dict):
            for v in value.values():
                self.scan_static(v, sid, conns)
        elif isinstance(value, list):
            for v in value:
                self.scan_static(v, sid, conns)

    def credential(self, ctype, name, sid):
        row = {"type": ctype, "name": name, "step": sid}
        if row not in self.credentials:
            self.credentials.append(row)

    def resource(self, path, sid, conns):
        self.credential("windmill resource", path, sid)
        app = _app_for(path)
        if app is None:
            self.issue("setup", f"Resource `{path}` has no matching app in the concept map. Set up what it "
                       "connects to by hand.", where=sid, concept="credential")
            return
        cid = migrate.slug(app, "app") + "-write"
        row = {"id": cid, "app": app, "access": migrate.classify_access(None)}
        if row not in self.connectors:
            self.connectors.append(row)
        if cid not in conns:
            conns.append(cid)
        self.issue("unverified", f"Resource `{path}` looks like {migrate.app_info(app)['label']}, guessed from its "
                   "name. Check it, then set up the connector.", where=sid)

    def variable(self, path, sid):
        self.credential("windmill variable", path, sid)
        self.issue("setup", f"Variable `{path}` is referenced by path only. Re-create its value in the "
                   "environment yourself.", where=sid, concept="credential")

    def transforms(self, tr, sid, inputs, conns):
        """{key: static value} for the static transforms; records inputs, credentials and connectors."""
        static = {}
        if not isinstance(tr, dict):
            return static
        for key, t in tr.items():
            if not isinstance(t, dict):
                continue
            kind = t.get("type")
            if kind == "static":
                static[key] = t.get("value")
                self.scan_static(t.get("value"), sid, conns)
            elif kind == "javascript" and isinstance(t.get("expr"), str):
                static[key] = None
                text = self.expr(t["expr"], sid, inputs, f"Input `{key}`")
                if not PURE_REF.match(t["expr"]):
                    self._input(inputs, f"`{key}` = {text}")
            elif kind == "ai":
                self._input(inputs, f"`{key}` is decided by the model")
        return static

    # Module extras: skip_if, stop_after_if, sleep, retry, continue_on_error

    def extras(self, m, sid, inputs, step_over):
        bits = []
        skip = m.get("skip_if")
        if isinstance(skip, dict) and isinstance(skip.get("expr"), str):
            bits.append(f"Skipped when {self.expr(skip['expr'], sid, inputs, 'Skip condition')}.")
        for key, text in (("stop_after_if", "Stops the flow after this step when"),
                          ("stop_after_all_iters_if", "Stops the flow after every pass when")):
            stop = m.get(key)
            if isinstance(stop, dict) and isinstance(stop.get("expr"), str):
                more = " Later steps are skipped." if stop.get("skip_if_stopped") else ""
                more += " It ends in an error." if stop.get("error_message") is not None else ""
                bits.append(f"{text} {self.expr(stop['expr'], sid, inputs, 'Stop condition')}.{more}")
        sleep = m.get("sleep")
        if isinstance(sleep, dict):
            if sleep.get("type") == "static" and _num(sleep.get("value")):
                bits.append(f"Waits {sleep['value']} seconds before the next step.")
            elif isinstance(sleep.get("expr"), str):
                bits.append(f"Waits {self.expr(sleep['expr'], sid, inputs, 'Sleep time')} before the next step.")
            self.issue("info", "A wait inside a run is not carried; delays become run boundaries.", where=sid,
                       concept="step.wait-time")
        retry = m.get("retry")
        if isinstance(retry, dict) and retry:
            parts = []
            for name in ("constant", "exponential"):
                r = retry.get(name)
                if isinstance(r, dict) and r.get("attempts"):
                    parts.append(f"{name} backoff, {r['attempts']} attempts")
            if isinstance(retry.get("retry_if"), dict) and isinstance(retry["retry_if"].get("expr"), str):
                parts.append(f"only when {self.expr(retry['retry_if']['expr'], sid, inputs, 'Retry condition')}")
            bits.append("Retries on failure (" + ", ".join(parts or ["see the source"]) + ").")
            self.issue("info", "Retry settings are described in the step, not enforced.", where=sid)
        if m.get("continue_on_error") is True:
            step_over["on_error"] = "continue"
            bits.append("If it fails, the flow continues.")
            self.issue("info", "The source continues when this step fails; the stage's failure rule says continue.",
                       where=sid, concept="failure.node")
        return bits

    # Steps

    def add(self, sid, concept, title, does, prefix, **extra):
        step = {"id": sid, "concept": concept, "title": title.strip() or sid, "does": prefix + does.strip()}
        step.update({k: v for k, v in extra.items() if v not in (None, [], {})})
        self.steps.append(step)

    def suspend(self, m, sid, title, prefix):
        s = m["suspend"]
        aid = migrate.unique_slug(f"{sid}-approval", self.taken)
        need = s.get("required_events") if isinstance(s.get("required_events"), int) else 1
        bits = [f"Waits for {need} approval{'s' if need != 1 else ''} after '{title}' has run, before the next step."]
        if s.get("timeout"):
            end = "the flow continues" if s.get("continue_on_disapprove_timeout") else "the flow is cancelled"
            bits.append(f"After {s['timeout']} seconds without an answer, {end}.")
        form = (s.get("resume_form") or {}).get("schema") if isinstance(s.get("resume_form"), dict) else None
        if isinstance(form, dict) and isinstance(form.get("properties"), dict) and form["properties"]:
            bits.append("The approver fills in: " + ", ".join(str(k) for k in form["properties"]) + ".")
        if s.get("self_approval_disabled"):
            bits.append("The person who started the flow cannot approve.")
        self.add(aid, "step.wait-approval", f"Approval after {title}", " ".join(bits), prefix,
                 source=f"suspend on {sid}")

    def walk(self, modules, prefix=""):
        if not isinstance(modules, list):
            return
        for m in modules:
            v = m.get("value") if isinstance(m, dict) else None
            if not isinstance(v, dict):
                self.issue("needs-person", "A module without a value object was skipped.", concept="step.unknown")
                continue
            sid = self.ids[id(m)]
            raw = m.get("id") if isinstance(m.get("id"), str) else sid
            kind = v.get("type") if isinstance(v.get("type"), str) else ""
            title = m.get("summary") if isinstance(m.get("summary"), str) and m["summary"].strip() else f"{kind or 'module'} {raw}"
            hit = migrate.lookup(kind, "windmill") if kind else None
            cid = hit["id"] if hit and hit["kind"] == "concept" else "step.unknown"
            inputs, conns, over = [], [], {}
            static = self.transforms(v.get("input_transforms"), sid, inputs, conns)
            if cid == "step.unknown":
                does = f"A module of type '{kind or 'unknown'}' that this converter does not know."
                self.issue("unmapped", f"Module type '{kind or 'unknown'}' is not in the concept map.", where=sid,
                           concept="step.unknown")
            else:
                does = getattr(self, "_" + kind)(v, sid, title, inputs, conns, over, prefix, static)
            bits = self.extras(m, sid, inputs, over)
            if "skill" in over and not over["skill"]:
                over.pop("skill")
            self.add(sid, cid, title, " ".join([does] + bits), prefix, inputs=inputs, connectors=conns,
                     source=raw, **over)
            self.after(v, sid, kind, prefix)
            if isinstance(m.get("suspend"), dict):
                self.suspend(m, sid, title, prefix)

    def after(self, v, sid, kind, prefix):
        """Flatten the modules inside a loop or branch after its own step."""
        if kind in ("forloopflow", "whileloopflow"):
            self.walk(v.get("modules"), prefix + LOOP_PREFIX)
        elif kind in ("branchone", "branchall"):
            for i, b in enumerate(v.get("branches") if isinstance(v.get("branches"), list) else [], 1):
                if isinstance(b, dict):
                    self.walk(b.get("modules"), prefix + f"Branch {self.branch_name(b, i)}: ")
            if kind == "branchone":
                self.walk(v.get("default"), prefix + "Branch default: ")

    @staticmethod
    def branch_name(b, i):
        return b["summary"].strip() if isinstance(b.get("summary"), str) and b["summary"].strip() else str(i)

    # One handler per module type: returns the step's "does" and may set step keys through `over`

    def _rawscript(self, v, sid, title, inputs, conns, over, prefix, static):
        lang = v.get("language") if isinstance(v.get("language"), str) else None
        over["code"] = {k: x for k, x in (("language", lang), ("text", v.get("content") if isinstance(
            v.get("content"), str) else "")) if x is not None}
        return f"Runs a {lang or 'code'} script: {title}."

    def _called(self, v, sid, what, conns):
        path = v.get("path") if isinstance(v.get("path"), str) else "(no path)"
        hub = path.startswith("hub/")
        self.issue("needs-person", f"Calls the Windmill {what} `{path}`, which is not in this file"
                   + ("; it is a Windmill hub item and was not copied" if hub else "")
                   + ". Make it its own routine or fold it in by hand.", where=sid, concept="step.subworkflow")
        return f"Calls the Windmill {what} `{path}`" + (" (from the Windmill hub)." if hub else ".")

    def _script(self, v, sid, title, inputs, conns, over, prefix, static):
        return self._called(v, sid, "script", conns)

    def _flow(self, v, sid, title, inputs, conns, over, prefix, static):
        return self._called(v, sid, "flow", conns)

    def _identity(self, v, sid, title, inputs, conns, over, prefix, static):
        return "Passes its input through unchanged."

    def _loop_head(self, v, sid, inputs, over, what):
        bits = []
        it = v.get("iterator")
        if isinstance(it, dict) and it.get("type") == "javascript" and isinstance(it.get("expr"), str):
            bits.append(f"the items given by {self.expr(it['expr'], sid, inputs, 'Loop iterator')}")
        elif isinstance(it, dict) and isinstance(it.get("value"), list):
            bits.append(f"a fixed list of {len(it['value'])} items")
        if v.get("skip_failures"):
            over["on_error"] = "continue"
            bits.append("a failed item is skipped")
        if v.get("parallel"):
            bits.append("Windmill ran items in parallel; here they run in order")
        return what + (" (" + "; ".join(bits) + ")" if bits else "")

    def _forloopflow(self, v, sid, title, inputs, conns, over, prefix, static):
        return self._loop_head(v, sid, inputs, over, "Runs the steps below for each item") + "."

    def _whileloopflow(self, v, sid, title, inputs, conns, over, prefix, static):
        return self._loop_head(v, sid, inputs, over, "Repeats the steps below until a stop condition is met") + "."

    def _branches(self, v, sid, inputs, with_default):
        parts = []
        for i, b in enumerate(v.get("branches") if isinstance(v.get("branches"), list) else [], 1):
            if not isinstance(b, dict):
                continue
            name = self.branch_name(b, i)
            if isinstance(b.get("expr"), str):
                parts.append(f"Branch {name}: when {self.expr(b['expr'], sid, inputs, f'Branch {name} condition')}")
            else:
                parts.append(f"Branch {name}" + (" (a failure here is skipped)" if b.get("skip_failure") else ""))
        if with_default and v.get("default") is not None:
            parts.append("Branch default: otherwise")
        return parts

    def _branchone(self, v, sid, title, inputs, conns, over, prefix, static):
        parts = self._branches(v, sid, inputs, True)
        return "Takes the first branch whose condition holds. " + "; ".join(parts) + "."

    def _branchall(self, v, sid, title, inputs, conns, over, prefix, static):
        parts = self._branches(v, sid, inputs, False)
        extra = " Windmill may run them in parallel; here they run in order." if v.get("parallel") else ""
        return "Takes every branch." + extra + " " + "; ".join(parts) + "."

    def _aidecision(self, v, sid, title, inputs, conns, over, prefix, static):
        q = static.get("questions")
        names = ", ".join(str(k) for k in q) if isinstance(q, dict) and q else None
        return "The model chooses a path" + (f" by answering: {names}." if names else ".")

    def _aiagent(self, v, sid, title, inputs, conns, over, prefix, static):
        skill = {}
        for key, part in (("system_prompt", "system"), ("user_message", "prompt")):
            if isinstance(static.get(key), str):
                skill[part] = static[key]
            elif key in (v["input_transforms"] if isinstance(v.get("input_transforms"), dict) else {}) \
                    and static.get(key) is None:
                self.issue("needs-person", f"The agent's `{key}` is computed at run time. It is listed as an input; "
                           "write the text by hand.", where=sid, concept="step.agent")
        over["skill"] = skill
        bits = ["An agent step."]
        prov = static.get("provider")
        model = prov.get("model") if isinstance(prov, dict) and isinstance(prov.get("model"), str) else None
        if model:
            bits.append(f"Windmill used the model `{_tick(model, 80)}`; RoutineOS uses Claude.")
        tools = v.get("tools") if isinstance(v.get("tools"), list) else []
        names = []
        for t in tools:
            if not isinstance(t, dict):
                continue
            names.append(str(t.get("summary") or t.get("id") or "tool"))
            val = t.get("value") if isinstance(t.get("value"), dict) else {}
            self.transforms(val.get("input_transforms"), sid, inputs, conns)
        if names:
            bits.append("Tools: " + ", ".join(names) + ".")
            self.issue("info", "Agent tools are named in the step. Set up a connector for each by hand.", where=sid,
                       concept="step.ai-tool")
        return " ".join(bits)

    # The whole flow

    def settings(self):
        schema = self.flow.get("schema")
        props = schema.get("properties") if isinstance(schema, dict) and isinstance(schema.get("properties"), dict) else {}
        out, names = [], set()
        for raw, p in props.items():
            if not isinstance(p, dict):
                continue
            name = setting_name(raw)
            base, n = name, 1
            while name in names:
                n += 1
                name = f"{base}_{n}"
            names.add(name)
            self.known_inputs.add(name)  # steps may read it even when no setting can hold it
            label = p.get("title") if isinstance(p.get("title"), str) and p["title"].strip() else str(raw)
            ptype, default = p.get("type"), p.get("default")
            row = {"name": name, "label": label}
            items = p.get("items") if isinstance(p.get("items"), dict) else {}
            if isinstance(p.get("enum"), list) and p["enum"]:
                choices = [c if isinstance(c, str) else str(c) for c in p["enum"]]
                row.update(type="choice", choices=choices,
                           default=default if isinstance(default, str) and default in choices else choices[0])
            elif ptype == "boolean":
                row.update(type="toggle", default=default if isinstance(default, bool) else False)
            elif ptype in ("number", "integer"):
                lo, hi = p.get("minimum"), p.get("maximum")
                if _num(lo) and _num(hi) and lo > hi:
                    raise MigrateError(f"Flow input `{raw}` has a minimum ({lo}) greater than its maximum ({hi}) in the "
                                       "source flow's schema. Fix the schema in the flow and run again.")
                d = default if _num(default) else (lo if _num(lo) else 0)
                if _num(lo):
                    row["min"], d = lo, max(d, lo)
                if _num(hi):
                    row["max"], d = hi, min(d, hi)
                row.update(type="number", default=d)
            elif ptype == "array" and items.get("type") == "string":
                keep = [x for x in default if isinstance(x, str)] if isinstance(default, list) else []
                recipient = any(w in migrate.pack.RECIPIENT_WORDS or w.rstrip("s") in migrate.pack.RECIPIENT_WORDS
                                for w in _words(raw))
                row.update(type="list", default=[] if recipient else keep)
            else:
                self.issue("needs-person", f"Flow input `{raw}` is {'text' if ptype == 'string' else ptype or 'untyped'}, which a RoutineOS setting "
                           "cannot hold. Put the value in the prompt or on a Desk item.", where=f"settings.{name}")
                continue
            out.append(row)
        return out

    def run(self):
        value = self.value
        modules = value["modules"]
        fm = value.get("failure_module")
        self.assign(modules)
        settings = self.settings()
        self.walk(modules)
        plan_failure = {}
        if isinstance(fm, dict):
            fv = fm.get("value") if isinstance(fm.get("value"), dict) else {}
            what = fm.get("summary") if isinstance(fm.get("summary"), str) and fm["summary"].strip() else "the error handler"
            lang = f" ({fv['language']})" if isinstance(fv.get("language"), str) else ""
            plan_failure = {"alert": True, "note": f"The flow's failure module '{what}'{lang} is not carried. A "
                            "failed run sends an alert to the Desk Inbox instead."}
            self.issue("needs-person", f"The failure module '{what}' ran a {fv.get('type') or 'module'}{lang}. "
                       "Rewrite what it did as the alert text, by hand.", where="failure_module",
                       concept="failure.workflow")
        ignored = [k for k in IGNORED_FLOW_KEYS if k in value]
        if ignored:
            self.issue("info", "These flow settings have no RoutineOS equivalent and were not carried: "
                       + ", ".join(ignored) + ".")
        name = self.flow.get("summary") if isinstance(self.flow.get("summary"), str) and self.flow["summary"].strip() \
            else "Windmill flow"
        desc = self.flow.get("description") if isinstance(self.flow.get("description"), str) else ""
        src = {"tool": "windmill", "name": name, "ref": "flow.json"}
        if isinstance(self.source, str):
            src["ref"] = self.source
        elif isinstance(self.source, dict):
            src.update({k: v for k, v in self.source.items() if k in migrate.SOURCE_KEYS and k != "tool"})
        notes = [n["text"] for n in value.get("notes", []) if isinstance(n, dict) and isinstance(n.get("text"), str)] \
            if isinstance(value.get("notes"), list) else []
        plan = {"format": migrate.FORMAT, "source": src, "id": migrate.slug(name),
                "title": name, "summary": " ".join(desc.split())[:300] or name, "category": "general",
                "kind": self.kind(), "trigger": {"concept": "trigger.schedule", "cron": migrate.DEFAULT_CRON,
                                                 "note": "Windmill schedules live outside the flow file."},
                "steps": self.steps, "connectors": self.connectors, "settings": settings, "collections": [],
                "credentials": self.credentials, "failure": plan_failure, "notes": notes, "issues": self.issues}
        if not plan["failure"]:
            del plan["failure"]
        removed = []
        plan = migrate._clean_tree(plan, "", removed)
        plan["issues"] += removed
        problems = migrate.validate_plan(plan)
        if problems:
            raise MigrateError(["the Windmill converter built an invalid plan (a converter bug)"] + problems)
        return plan

    def kind(self):
        working = [s["concept"] for s in self.steps if s["concept"] not in STRUCTURAL]
        if not working:
            return "workflow"
        code = working.count("step.code")
        if code == len(working):
            return "code"
        if len(working) == 1 and working[0] in ("step.agent", "step.llm"):
            return "skill"
        if code == 0:
            return "workflow"
        return "workflow" if sum(1 for c in working if c in MODEL_STEPS) > code else "hybrid"


def parse(flow, source=None):
    """A migration plan (routineos.migration.v1) from an OpenFlow object. `source` is a file name or a source dict."""
    if not isinstance(flow, dict):
        raise MigrateError("the flow must be an object")
    value = flow.get("value")
    if not isinstance(value, dict) or not isinstance(value.get("modules"), list):
        raise MigrateError("not an OpenFlow flow: it needs value.modules as a list")
    return _Parser(flow, source).run()
