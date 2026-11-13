"""Blueprint graph derivation. Standard library only (Python 3.11+).

derive() reads routine.toml, pack.json, definition.json and app.toml through the existing parsers and returns one graph dict. It holds no
coordinates and never infers a verified state.
"""
import hashlib
import json
import os
import re
import tomllib

import appmodel
import definition
import migrate
import pack as packmod
import schema

FORMAT = "routineos.blueprint.v1"
BLUEPRINT_TABLES = ("requirement", "infra", "integration", "approval")
NODE_KINDS = ("trigger", "routine", "stage", "connector", "mcp", "http", "infra", "store", "gate", "output", "setting", "secret")
STATEFUL_KINDS = ("connector", "mcp", "http", "infra")
STATES = ("verified", "docs", "unverified", "needs-research", "needs-building")
DISPLAY_STATES = STATES + ("conflict",)
EDGE_TYPES = ("starts", "runs", "next", "reads", "writes", "stores", "passes", "shows", "configures", "uses-secret")
# registry status -> graph state (spec 6.9); conflict and broken show as conflict, never hidden
REGISTRY_STATE = {"pilot-verified": "verified", "docs-stated": "docs", "unverified": "unverified", "conflict": "conflict", "broken": "conflict"}
# weakest first, so a part that relies on several records shows the weakest
_WEAKEST = ("conflict", "needs-building", "needs-research", "unverified", "docs", "verified")
# an [[integration]] kind of secret-host is an http host that carries a secret
_INTEGRATION_KINDS = {"connector": "connector", "mcp": "mcp", "http": "http", "secret-host": "http"}


class BlueprintError(Exception):
    """Raised when a Blueprint source cannot be read."""


def _strings(value):
    return [v for v in value if isinstance(v, str)] if isinstance(value, list) else []


def _dicts(value):
    return [v for v in value if isinstance(v, dict)] if isinstance(value, list) else []


class _Graph:
    def __init__(self):
        self.nodes = {}
        self.edges = {}
        self.requirements = []
        self.approval = None

    def node(self, kind, name, label, source_file, source_key, state=None, needs=None, detail=None, nid=None):
        nid = nid or f"{kind}:{name}"
        if nid not in self.nodes:
            if kind in STATEFUL_KINDS and state is None:
                state = "needs-research"
            self.nodes[nid] = {
                "id": nid, "kind": kind, "label": label, "name": name,
                "state": state if kind in STATEFUL_KINDS else None,
                "needs": needs,
                "source": {"file": source_file, "key": source_key},
                "serves": [], "detail": detail or {},
            }
        return nid

    def edge(self, a, b, etype, label=None):
        self.edges.setdefault((a, b, etype), {"from": a, "to": b, "type": etype, "label": label})

    def out(self):
        return {
            "format": FORMAT,
            "nodes": [self.nodes[k] for k in sorted(self.nodes)],
            "edges": [self.edges[k] for k in sorted(self.edges)],
            "requirements": [], "approval": None, "hash": None, "warnings": [],
        }


def _registry_state(rec_ids, records):
    if any(i not in records for i in rec_ids):
        return None  # an id the registry does not know cannot be relied on, so it cannot yield a stronger state
    found = [REGISTRY_STATE[records[i]["status"]] for i in rec_ids if i in records and records[i].get("status") in REGISTRY_STATE]
    return min(found, key=_WEAKEST.index) if found else None


def _part_state(entry, records, wid=None, warn=None):
    """(state, needs) of a stateful part: a registry record wins, then an authored valid state, else needs-research.
    When warn (a list) and wid are given, authored problems are appended to warn."""
    rel = entry.get("relies_on")
    ids = [rel] if isinstance(rel, str) else _strings(rel)
    records = records or {}
    state = _registry_state(ids, records)
    authored = entry.get("state")
    if warn is not None:
        for i in ids:
            if i not in records:
                warn.append(f"blueprint: '{wid}': relies_on '{i}' is not in the registry")
        if state is not None:
            if authored is not None and authored != state:
                status = min((records[i]["status"] for i in ids if records.get(i, {}).get("status") in REGISTRY_STATE),
                             key=lambda x: _WEAKEST.index(REGISTRY_STATE[x]))
                warn.append(f"blueprint: '{wid}': registry says {status}, authored state '{authored}' ignored")
        elif authored is not None and authored not in STATES:
            warn.append(f"blueprint: '{wid}': state '{authored}' is not one of verified, docs, unverified, needs-research, needs-building")
    if state is None and authored in STATES and not ids:
        state = authored
    needs = entry.get("needs") if isinstance(entry.get("needs"), str) else None
    return state or "needs-research", needs


def _set_state(g, nid, entry, records, warn):
    state, needs = _part_state(entry, records, nid, warn)
    g.nodes[nid]["state"] = state
    g.nodes[nid]["needs"] = needs


def _from_routine(g, cfg, fname, scope=""):
    """Nodes and edges from one routine.toml. scope prefixes routine-owned ids when several routines share a graph."""
    r = cfg["routine"]
    name = r["name"]
    p = f"{scope}." if scope else ""
    trig = g.node("trigger", "schedule", r["schedule"], fname, "routine.schedule", detail={"cron": r["schedule"]}, nid=f"trigger:{p}schedule")
    rid = g.node("routine", name, name, fname, "routine", detail={"type": r["type"], "first_run": r.get("first_run", "report-only")})
    g.edge(trig, rid, "starts")
    for i, s in enumerate(_dicts(cfg.get("setting"))):
        if isinstance(s.get("name"), str):
            sid = g.node("setting", s["name"], s.get("label", s["name"]), fname, f"setting[{i}]", detail={"type": s.get("type")}, nid=f"setting:{p}{s['name']}")
            g.edge(sid, rid, "configures")
    stores = []
    store = cfg.get("store")
    if isinstance(store, dict) and isinstance(store.get("adapter"), str):
        stores.append(g.node("store", store["adapter"], store["adapter"], fname, "store.adapter", detail={"adapter": store["adapter"]}))
    gate = cfg.get("gate")
    gate_id = None
    if isinstance(gate, dict) and gate.get("enabled") is True:
        gate_id = g.node("gate", "gate", "Approval gate", fname, "gate", detail={"transport": gate.get("transport")}, nid=f"gate:{p}gate")
    ws = cfg.get("workspace")
    if isinstance(ws, dict) and ws.get("enabled") is True:
        desk = g.node("output", "desk", "Desk", fname, "workspace", nid=f"output:{p}desk")
        for s in stores:
            g.edge(s, desk, "shows")
    for i, a in enumerate(_dicts(cfg.get("action"))):
        if isinstance(a.get("name"), str):
            oid = g.node("output", a["name"], a["name"], fname, f"action[{i}]", detail={"action_kind": a.get("kind")}, nid=f"output:{p}{a['name']}")
            if gate_id:
                g.edge(gate_id, oid, "passes")
    return rid, stores, gate_id


def _from_pack(g, meta, fname, rid, stores, gate_id, scope=""):
    p = f"{scope}." if scope else ""
    stages = _dicts(meta.get("stages"))
    sid = {}
    for i, s in enumerate(stages):
        if isinstance(s.get("id"), str):
            sid[s["id"]] = g.node("stage", s["id"], s.get("title", s["id"]), fname, f"stages[{i}]",
                                  detail={"stage_kind": s.get("kind"), "does": s.get("does")}, nid=f"stage:{p}{s['id']}")
    order = [sid[s["id"]] for s in stages if s.get("id") in sid]
    if order:
        g.edge(rid, order[0], "runs")
    for a, b in zip(order, order[1:]):
        g.edge(a, b, "next")
    write_conns = []
    for i, c in enumerate(_dicts(meta.get("connectors"))):
        if not isinstance(c.get("id"), str):
            continue
        kind = c.get("kind") if c.get("kind") in ("mcp", "http") else "connector"
        cid = g.node(kind, c["id"], c.get("label", c["id"]), fname, f"connectors[{i}]",
                     detail={"connector_kind": c.get("kind"), "access": c.get("access"), "purpose": c.get("purpose"),
                             "required": c.get("required"), "alternatives": _strings(c.get("alternatives"))})
        users = set(_strings(c.get("stages"))) | {s["id"] for s in stages if c["id"] in _strings(s.get("connectors"))}
        for u in sorted(users & set(sid)):
            if c.get("access") == "write":
                g.edge(sid[u], cid, "writes")
            else:
                g.edge(cid, sid[u], "reads")
        if c.get("access") == "write":
            write_conns.append(cid)
    for s in stages:
        writes = _strings(s.get("writes"))
        if s.get("id") in sid and writes:
            for st in stores:
                g.edge(sid[s["id"]], st, "stores", ", ".join(writes))
    if gate_id:
        for cid in write_conns:
            g.edge(gate_id, cid, "passes")


def _from_app(g, app, fname, records, rids, warn):
    integ = {}
    for i, it in enumerate(_dicts(app.get("integration"))):
        name = it.get("name")
        if not isinstance(name, str):
            continue
        kind = _INTEGRATION_KINDS.get(it.get("kind"), "connector")
        nid = g.node(kind, name, name, fname, f"integration[{i}]",
                     detail={"integration_kind": it.get("kind"), "direction": it.get("direction"), "gate": it.get("gate"), "hosts": _strings(it.get("hosts"))})
        _set_state(g, nid, it, records, warn)
        integ[name] = (nid, it)
    colls = {}
    for i, c in enumerate(_dicts(app.get("collection"))):
        if isinstance(c.get("name"), str):
            colls[c["name"]] = g.node("store", c["name"], c["name"], fname, f"collection[{i}]", detail={"writer": c.get("writer")})
    secrets = []
    for i, s in enumerate(_dicts(app.get("secret"))):
        if isinstance(s.get("name"), str):
            secrets.append((g.node("secret", s["name"], s["name"], fname, f"secret[{i}]", detail={"where": s.get("where"), "host": s.get("host")}), s))
    for i, r in enumerate(_dicts(app.get("routine"))):
        name = r.get("name")
        if not isinstance(name, str):
            continue
        rid = rids.get(name) or g.node("routine", name, name, fname, f"routine[{i}]", detail={"type": r.get("type")})
        for c in _strings(r.get("connectors")):
            if c in integ:
                nid, it = integ[c]
                if it.get("direction") == "write":
                    g.edge(rid, nid, "writes")
                else:
                    g.edge(nid, rid, "reads")
        for h in _strings(r.get("hosts")):
            hid = g.node("http", h, h, fname, f"routine[{i}].hosts", detail={"host": h})
            g.edge(hid, rid, "reads")
        for coll in _strings(r.get("writes")):
            if coll in colls:
                g.edge(rid, colls[coll], "writes")
    for sid, s in secrets:
        for nid, it in integ.values():
            if isinstance(s.get("host"), str) and s["host"] in _strings(it.get("hosts")):
                g.edge(sid, nid, "uses-secret")


def _from_definition(g, d, rid, stores, scope, warn):
    """Each record type in definition.json is a store the routine keeps: written through the routine's store (or by the
    routine when it has none) and shown in the Desk. A missing file adds nothing; one that cannot be read is a warning."""
    path = os.path.join(d, "definition.json")
    if not os.path.isfile(path):
        return
    p = f"{scope}." if scope else ""
    where = f"{scope}/definition.json" if scope else "definition.json"
    try:
        types = definition.load(path).get("types")
    except definition.DefinitionError:
        types = None
    if not isinstance(types, dict):
        warn.append(f"blueprint: {where} was not read, so its record types are left out; run lint for the problem")
        return
    desk = f"output:{p}desk"
    for tname, tdef in types.items():
        tdef = tdef if isinstance(tdef, dict) else {}
        label = tdef.get("label") if isinstance(tdef.get("label"), str) else tname
        nid = g.node("store", tname, label, "definition.json", f"types.{tname}", detail={"record_type": tname}, nid=f"store:{p}{tname}")
        for st in stores:
            if st != nid:
                g.edge(st, nid, "stores")
        if not stores:
            g.edge(rid, nid, "writes")
        if desk in g.nodes:
            g.edge(nid, desk, "shows")


def _read_pack(d):
    path = os.path.join(d, "pack.json")
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "rb") as fh:
            return packmod.parse(fh.read(), what="pack.json")
    except (OSError, packmod.PackError) as exc:
        raise BlueprintError(f"cannot read {path}: {exc}")


def _routine(g, d, records, warn, scope=""):
    path = os.path.join(d, "routine.toml")
    try:
        cfg = schema.load(path)
    except schema.SchemaError as exc:
        raise BlueprintError(str(exc))
    rid, stores, gate_id = _from_routine(g, cfg, "routine.toml", scope)
    meta = _read_pack(d)
    if meta is not None:
        _from_pack(g, meta, "pack.json", rid, stores, gate_id, scope)
    _from_definition(g, d, rid, stores, scope, warn)
    return cfg["routine"]["name"], rid, cfg


_ARRAY_TABLES = ("requirement", "infra", "integration")


def _cfg_has_blueprint(cfg):
    if not isinstance(cfg, dict):
        return False
    if _dicts(cfg.get("requirement")) or _dicts(cfg.get("infra")) or isinstance(cfg.get("approval"), dict):
        return True
    if any(isinstance(cfg.get(t), dict) for t in _ARRAY_TABLES):
        return True  # a single table is ignored, but the folder is plainly trying to carry a Blueprint: lint says so
    return any(i.get("state") is not None or i.get("needs") is not None or i.get("relies_on") is not None
               for i in _dicts(cfg.get("integration")))


def has_blueprint(d):
    """True when the folder's routine.toml or app.toml carries Blueprint keys."""
    for fname in ("routine.toml", "app.toml"):
        try:
            with open(os.path.join(d, fname), "rb") as fh:
                if _cfg_has_blueprint(tomllib.load(fh)):
                    return True
        except (OSError, tomllib.TOMLDecodeError):
            continue
    return False


def _resolve(g, name, scope=""):
    """(node id or None, problem or None) for a served_by name: a full id, or a bare name that matches one part.
    scope is the owning routine's folder name in an app graph: its own parts are tried first, so an unscoped id in a
    routine.toml means the same part there as in the routine's own view."""
    if scope:
        kind, sep, rest = name.partition(":")
        if sep and f"{kind}:{scope}.{rest}" in g.nodes:
            return f"{kind}:{scope}.{rest}", None
        own = sorted(i for i, n in g.nodes.items() if n["name"] == name and i.partition(":")[2].startswith(scope + "."))
        if len(own) == 1:
            return own[0], None
    if name in g.nodes:
        return name, None
    ids = sorted(i for i, n in g.nodes.items() if n["name"] == name)
    if len(ids) == 1:
        return ids[0], None
    return None, ids


def _mark_origin(item, entry):
    """origin = "pack" is written by pack install on every row a pack supplied, and stays until the person confirms the
    row and deletes the line. The key is only added when set, so a graph without packs is unchanged; it is not hashed."""
    if entry.get("origin") == "pack":
        item["origin"] = "pack"


def _authored(g, files, records, warn):
    """Apply [[infra]], [[requirement]], [approval] and routine.toml [[integration]] from files, a list of (fname, cfg,
    scope) in order with app.toml last; scope is a routine folder name in an app graph, else "". A name declared in both
    routine.toml and app.toml uses the app.toml entry, unmerged. In an app graph only app.toml's [approval] counts: a
    routine's own approval covers that routine's view alone."""
    app_cfg = next((c for f, c, _ in files if f == "app.toml"), None)
    app_names = {t: {e.get(k) for e in _dicts(app_cfg.get(t))} for t, k in (("integration", "name"), ("infra", "name"), ("requirement", "id"))} if app_cfg else {}
    entries = []  # (table, fname, index, entry, scope)
    for fname, cfg, scope in files:
        for table in _ARRAY_TABLES:
            if isinstance(cfg.get(table), dict):
                where = f"{fname}: " if app_cfg is not None else ""
                warn.append(f"blueprint: {where}[{table}] is a single table and was ignored; write each as [[{table}]] (an array of tables)")
        for table, key in (("infra", "name"), ("requirement", "id"), ("integration", "name")):
            if table == "integration" and fname == "app.toml":
                continue  # built by _from_app
            for i, e in enumerate(_dicts(cfg.get(table))):
                if not isinstance(e.get(key), str):
                    continue
                if fname != "app.toml" and e[key] in app_names.get(table, ()):
                    warn.append(f"blueprint: '{e[key]}' is declared in both {fname} and app.toml; the app.toml entry is used")
                    continue
                entries.append((table, fname, i, e, scope))
    reqs = []
    for table, fname, i, e, scope in entries:
        if table == "integration":
            name = e["name"]
            matches = sorted(n for n, nd in g.nodes.items() if nd["kind"] in ("connector", "mcp", "http") and nd["name"] == name)
            if len(matches) == 1:
                nid = matches[0]
                if _strings(e.get("hosts")):
                    g.nodes[nid]["detail"]["hosts"] = _strings(e["hosts"])
            else:
                kind = _INTEGRATION_KINDS.get(e.get("kind"), "connector")
                nid = g.node(kind, name, name, fname, f"integration[{i}]",
                             detail={"integration_kind": e.get("kind"), "direction": e.get("direction"), "gate": e.get("gate"), "hosts": _strings(e.get("hosts"))})
            _set_state(g, nid, e, records, warn)
            _mark_origin(g.nodes[nid], e)
        elif table == "infra":
            nid = g.node("infra", e["name"], e.get("label", e["name"]), fname, f"infra[{i}]",
                         detail={"infra_kind": e.get("kind"), "what": e.get("what"), "deploys": e.get("deploys")})
            _set_state(g, nid, e, records, warn)
            _mark_origin(g.nodes[nid], e)
        else:
            reqs.append((e, fname, scope))
    for e, fname, scope in reqs:
        sb = e.get("served_by")
        names = [sb] if isinstance(sb, str) else _strings(sb)
        served, unresolved = [], []
        for name in names:
            nid, ids = _resolve(g, name, scope)
            if nid:
                served.append(nid)
                g.nodes[nid]["serves"].append(e["id"])
            else:
                unresolved.append(name)
        g_req = {"id": e["id"], "text": e.get("text") if isinstance(e.get("text"), str) else "",
                 "served_by": served, "unresolved": unresolved, "gap": not served}
        _mark_origin(g_req, e)
        g.requirements.append(g_req)
    for fname, cfg, _ in files:
        ap = cfg.get("approval")
        if app_cfg is not None and fname != "app.toml":
            continue
        if isinstance(ap, dict):
            g.approval = {"version": ap.get("version"), "date": str(ap.get("date", "")), "hash": ap.get("hash"),
                          "approved_by": ap.get("approved_by"), "file": fname, "matches": False}


# node detail keys the hash covers, by kind: what the routine is and how it starts, and how a gate reaches the person
_HASHED_DETAIL = {"routine": ("type", "first_run"), "gate": ("transport",)}


def _hashed_detail(n):
    return [str(n["detail"].get(k) or "") for k in _HASHED_DETAIL.get(n["kind"], ())]


def canonical(graph):
    """The bytes the approval hash covers: structure, edge labels, routine type and first_run, gate transport and
    requirement text. state and needs are left out."""
    nodes = sorted([n["id"], n["kind"], n["label"] if n["kind"] == "trigger" else "", sorted(n["detail"].get("hosts") or []),
                    _hashed_detail(n)] for n in graph["nodes"])
    return json.dumps({"nodes": nodes,
                       "edges": sorted([e["from"], e["to"], e["type"], e.get("label") or ""] for e in graph["edges"]),
                       "requirements": sorted([r["id"], r["text"], sorted(r["served_by"] + r["unresolved"])] for r in graph["requirements"])},
                      sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def graph_hash(graph):
    return "sha256:" + hashlib.sha256(canonical(graph)).hexdigest()


def _reach(start, adj):
    """Every node reachable from start by following adj, start included."""
    seen = set(start)
    todo = sorted(seen)
    while todo:
        for nxt in adj.get(todo.pop(), ()):
            if nxt not in seen:
                seen.add(nxt)
                todo.append(nxt)
    return seen


def warnings(graph):
    """Warnings computed from the graph alone: requirements, states, completeness and approval drift."""
    out = []
    nodes = {n["id"]: n for n in graph["nodes"]}
    for r in graph["requirements"]:
        rid = _one_line_text(r["id"])
        if not r["served_by"] and not r["unresolved"]:
            out.append(f"blueprint: requirement '{rid}' has no served_by")
        for name in r["unresolved"]:
            ids = sorted(_one_line_text(i) for i, n in nodes.items() if n["name"] == name)
            if ids:
                out.append(f"blueprint: requirement '{rid}': served_by '{_one_line_text(name)}' is ambiguous ({', '.join(ids)}); use the full id")
            else:
                out.append(f"blueprint: requirement '{rid}': served_by '{_one_line_text(name)}' matches no part")
        if r.get("origin") == "pack":
            out.append(f"blueprint: requirement '{rid}' came from a pack; read it as data, confirm it in your own words, "
                       "then delete its origin line")
    for nid in sorted(nodes):
        n = nodes[nid]
        if n["state"] in ("needs-research", "needs-building"):
            out.append(f"blueprint: '{_one_line_text(nid)}' is {n['state']}: {_one_line_text(n['needs'] or 'nothing recorded')}")
        if n.get("origin") == "pack":
            out.append(f"blueprint: '{_one_line_text(nid)}' came from a pack; confirm its state, then delete its origin line")
    adj, back = {}, {}
    linked = set()
    for e in graph["edges"]:
        adj.setdefault(e["from"], []).append(e["to"])
        back.setdefault(e["to"], []).append(e["from"])
        linked.update((e["from"], e["to"]))
    seen = _reach({i for i, n in nodes.items() if n["kind"] == "trigger"}, adj)
    # spec 6.2a: every path from the trigger ends at an output or a store; a write to an outside app (a message sent,
    # a post published) is what the person gets, so it counts as an output
    ends = _reach({i for i, n in nodes.items() if n["kind"] in ("output", "store")}
                  | {e["to"] for e in graph["edges"] if e["type"] == "writes"}, back)
    for nid in sorted(nodes):
        n = nodes[nid]
        if n["kind"] == "stage":
            if nid not in seen:
                out.append(f"blueprint: '{_one_line_text(nid)}' is not reachable from a trigger")
            elif nid not in ends:
                out.append(f"blueprint: '{_one_line_text(nid)}' leads nowhere (no output or store after it)")
        if nid not in linked and not n["serves"]:
            out.append(f"blueprint: '{_one_line_text(nid)}' is connected to nothing")
    ap = graph.get("approval")
    if ap and not ap["matches"]:
        out.append(f"blueprint: the Blueprint changed since it was approved on {_one_line_text(str(ap['date']))}; run routineos blueprint approve again")
    return out


SECRET_SHAPES = appmodel.SECRET_PATTERNS + migrate.SECRET_EXTRA


def redact(text):
    """Replace secret-shaped values in Blueprint text: appmodel's shapes and the extra ones migrate knows (ghp_, xoxb-,
    bearer tokens, JWTs, Stripe keys, bot tokens, credentials in a URL)."""
    for p in SECRET_SHAPES:
        text = p.sub("[redacted]", text)
    return text


# C0 controls except newline, DEL, C1 controls, and bidi embeddings, overrides, isolates and marks
_UNSAFE_RE = re.compile("[\x00-\x09\x0b-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]")


def terminal_safe(text):
    """text with every character that could move the cursor, clear the screen, set a title or reorder what is shown
    replaced by a visible \\xNN or \\uNNNN escape. Newlines are kept."""
    return _UNSAFE_RE.sub(lambda m: f"\\x{ord(m.group()):02x}" if ord(m.group()) < 0x100 else f"\\u{ord(m.group()):04x}", text)


def _strings_in(v):
    if isinstance(v, str):
        yield v
    elif isinstance(v, list):
        for x in v:
            yield from _strings_in(x)
    elif isinstance(v, dict):
        for x in v.values():
            yield from _strings_in(x)


def _secret_warnings(files):
    """One warning per Blueprint table entry that holds a secret-shaped value. It names the entry, never the value."""
    out = []
    for fname, cfg, scope in files:
        where = f"{scope}/{fname}" if scope else fname
        for table, key in (("requirement", "id"), ("integration", "name"), ("infra", "name")):
            for e in _dicts(cfg.get(table)):
                if any(p.search(s) for s in _strings_in(e) for p in SECRET_SHAPES):
                    out.append(f"blueprint: {where} [[{table}]] '{e.get(key)}' holds a secret-shaped value; "
                               "remove it from the file and rotate the secret")
    return out


def _finish(g, d_has, extra):
    graph = g.out()
    if not d_has:
        return graph
    graph["requirements"] = g.requirements
    graph["hash"] = graph_hash(graph)
    graph["approval"] = g.approval
    if g.approval:
        g.approval["matches"] = g.approval["hash"] == graph["hash"]
    out = []
    for w in extra + warnings(graph):
        if w not in out:
            out.append(w)
    graph["warnings"] = out
    return graph


def derive(d, records=None, routine_dirs=None):
    """The graph for a routine folder d, or for an app folder d when routine_dirs lists its routine folders."""
    g = _Graph()
    warn = []
    files = []
    if routine_dirs is None:
        _, _, cfg = _routine(g, d, records, warn)
        files.append(("routine.toml", cfg, ""))
    else:
        rids = {}
        for rd in routine_dirs:
            name, rid, cfg = _routine(g, rd, records, warn, scope=os.path.basename(os.path.normpath(rd)))
            rids[name] = rid
            files.append(("routine.toml", cfg, os.path.basename(os.path.normpath(rd))))
        path = os.path.join(d, "app.toml")
        try:
            app = appmodel.load(path)
        except appmodel.AppError as exc:
            raise BlueprintError(str(exc))
        _from_app(g, app, "app.toml", records, rids, warn)
        files.append(("app.toml", app, ""))
    has = any(_cfg_has_blueprint(c) for _, c, _ in files)
    _authored(g, files, records, warn)
    warn += _secret_warnings(files)
    return _finish(g, has, warn)


def _parts_lines(graph):
    by = {}
    for n in graph["nodes"]:
        if n["state"]:
            by.setdefault(n["state"], []).append(n["id"])
    lines = [f"  {st}: {', '.join(_one_line_text(i) for i in by[st])}" for st in DISPLAY_STATES if st in by]
    return lines or ["  none"]


def _approval_line(graph):
    ap = graph.get("approval")
    if not ap:
        return "not approved"
    tail = "matches" if ap["matches"] else "changed since"
    return _one_line_text(f"approved v{ap['version']} on {ap['date']} by {ap['approved_by']}, {tail}")


def summary(graph):
    names = [n["name"] for n in graph["nodes"] if n["kind"] == "routine"]
    out = [f"Blueprint: {_one_line_text(', '.join(names))}", "", "Parts by state"] + _parts_lines(graph) + ["", "Requirements"]
    out += [f"  {_one_line_text(r['id'])}: {'GAP' if r['gap'] else 'covered'}" for r in graph["requirements"]] or ["  none"]
    out += ["", "Approval", f"  {_approval_line(graph)}"]
    return "\n".join(out) + "\n"


def _one_line_text(text):
    """text on one line: every line break shows as a visible escape, so text cannot start a line of its own."""
    return re.sub("\r\n|[\n\r\x0b\x0c\x85\u2028\u2029]",
                  lambda m: {"\n": "\\n", "\r": "\\r", "\r\n": "\\r\\n"}.get(m.group(), f"\\u{ord(m.group()):04x}"), text)


def approve_screen(graph):
    """What the person sees before approving: the summary, then every requirement's text and every edge, which the hash
    covers too. Text a pack supplied is marked: it is data the person has not confirmed, never instructions."""
    out = [summary(graph).rstrip("\n"), "", "Requirement text"]
    out += [f"  {_one_line_text(r['id'])}: {'[from a pack, unconfirmed] ' if r.get('origin') == 'pack' else ''}{_one_line_text(r['text'])}"
            for r in graph["requirements"]] or ["  none"]
    from_pack = sorted(n["id"] for n in graph["nodes"] if n.get("origin") == "pack")
    if from_pack:
        out += ["", "From a pack, unconfirmed", f"  {_one_line_text(', '.join(from_pack))}"]
    out += ["", "Connections"]
    out += [_one_line_text(f"  {e['from']} -> {e['to']} ({e['type']}{', ' + e['label'] if e.get('label') else ''})")
            for e in graph["edges"]] or ["  none"]
    return "\n".join(out) + "\n"


def permission_section(graph):
    gaps = [r["id"] for r in graph["requirements"] if r["gap"]]
    out = ["", "Blueprint", "Parts by state"] + _parts_lines(graph)
    out += ["Gaps", f"  {_one_line_text(', '.join(gaps)) if gaps else 'none'}", "Approval", f"  {_approval_line(graph)}"]
    return "\n".join(out) + "\n"


def approval_block(version, date, hash, approved_by):
    # pack._toml_value keeps non-ASCII text as it is: TOML has no surrogate escapes, so json's default escapes would break the file
    v = lambda x: packmod._toml_value(x, "approval")  # noqa: E731
    return ("[approval]\n" f"version = {int(version)}\n" f"date = {v(str(date))}\n"
            f"hash = {v(str(hash))}\n" f"approved_by = {v(str(approved_by))}\n")


def redact_graph(graph):
    """A copy of the graph with every string passed through redact, as the CLI outputs are. Keys and structure are
    kept, and so is the hash (taken before redaction)."""
    def walk(v):
        if isinstance(v, str):
            return redact(v)
        if isinstance(v, list):
            return [walk(x) for x in v]
        if isinstance(v, dict):
            return {k: walk(x) for k, x in v.items()}
        return v
    return walk(graph)


_HEADER_RE = re.compile(r"""\[\s*(approval|"approval"|'approval')\s*\]\s*(#.*)?$""")
_NONSTANDARD = ("writes approval as an inline table, dotted keys or a sub-table; "
                "replace it with a plain [approval] table (or remove it) and run approve again")


def _top_level(lines, i):
    """True when line i starts at the top level of the document: everything before it parses, so it is not inside a
    multiline string or array."""
    try:
        tomllib.loads("".join(lines[:i]))
    except tomllib.TOMLDecodeError:
        return False
    return True


def write_approval(path, block):
    """Replace the [approval] table of path with block, or append it after one blank line. Every other byte is kept:
    comments inside the old table stay, and the file's own line ending is used for the new lines. The table is located
    by parsing, and the new text is parsed again before the file is replaced: it must hold the new approval and every
    other table unchanged. An approval written as an inline table, with dotted keys or as a sub-table, a file that does
    not parse, or a result that does not round-trip is refused (BlueprintError) with the file untouched."""
    name = os.path.basename(path)
    with open(path, "r", encoding="utf-8", newline="") as fh:
        text = fh.read()
    try:
        old_cfg = tomllib.loads(text)
    except tomllib.TOMLDecodeError as exc:
        raise BlueprintError(f"{name} is not valid TOML ({exc}); fix it and run approve again")
    m = re.search(r"\r?\n", text)
    eol = m.group(0) if m else "\n"
    block = block.replace("\r\n", "\n").replace("\n", eol)
    lines = text.splitlines(keepends=True)
    headers = [i for i, ln in enumerate(lines) if _HEADER_RE.match(ln.strip()) and _top_level(lines, i)]
    if "approval" in old_cfg and len(headers) != 1:
        raise BlueprintError(f"{name} {_NONSTANDARD}")
    if not headers:
        if text and not text.endswith("\n"):
            text += eol
        if text and not re.search(r"\n[ \t]*\r?\n\Z", text):
            text += eol
        new = text + block
    else:
        start = headers[0]
        end = next((i for i in range(start + 1, len(lines)) if lines[i].lstrip().startswith("[") and _top_level(lines, i)), len(lines))
        while end > start + 1 and not lines[end - 1].strip():
            end -= 1
        kept = [ln if ln.endswith(("\n", "\r")) else ln + eol for ln in lines[start + 1:end] if ln.strip().startswith("#")]
        new = "".join(lines[:start]) + block + "".join(kept) + "".join(lines[end:])
    try:
        new_cfg = tomllib.loads(new)
    except tomllib.TOMLDecodeError:
        raise BlueprintError(f"{name} {_NONSTANDARD}")
    want = tomllib.loads(block)["approval"]
    if new_cfg.pop("approval", None) != want or new_cfg != {k: v for k, v in old_cfg.items() if k != "approval"}:
        raise BlueprintError(f"{name} {_NONSTANDARD}")
    with open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write(new)
