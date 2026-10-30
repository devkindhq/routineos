"""Desk write contract: plan a run's writes against a docs snapshot. Standard library only.

plan_run is pure: it reads a snapshot {path: {"version", "data"}} and returns ordered phases of
ArtifactData batch writes. Applying every phase in order, or re-planning after a crash and applying
the rest, leaves the same documents behind.
"""
import copy
import hashlib
import json
import re
import unicodedata

import definition
import join_card
import worker_kinds

MAX_SLUG = 120
MAX_SIGHTINGS = 30
MAX_DOC_BYTES = 256 * 1024
MAX_BATCH_OPS = 50
MAX_BATCH_BYTES = 900 * 1024
MAX_DROPPED_LISTED = 50
KEPT_NOTE = "kept by person"
DROPPED_NOTE = "dropped by person"
MAX_PERSON_REASON = 200
REASON_STRIP = ("Cc", "Cf", "Cs", "Zl", "Zp")
MAX_CHANGED_LISTED = 20
HUMAN_PREFIXES = ("settings/", "userstate/", "decisions/", "merges/", "settingsHistory/", "data/users/", "people/")
CREATE_ONLY_PREFIXES = ("views/", "columns/")
PRIVATE_PREFIXES = ("userstate/", "data/users/")
INBOX_KEYS = ("kind", "title", "why", "actions", "proposal", "gate")
GATE_KEYS = ("transport", "timeoutHours", "correlation", "draft", "recipients")
ADDRESS_RE = re.compile(r"@|https?://|^\+?[0-9][0-9 ()-]{6,}$")
CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")
# A producer gate id: its run id, then --g<n>. Group 1 is the run id. A worker gate id also matches
# (its run id group then spans the lane key), and is told apart by WORKER_GATE_ID_RE below.
GATE_ID_RE = re.compile(r"^([a-z0-9][a-z0-9-]*)--g[1-9][0-9]*$")
WORKER_GATE_ID_RE = re.compile(
    r"^(?P<run>[a-z0-9]+(?:-[a-z0-9]+)*)--(?P<lane>[a-z][a-z0-9]*(?:-[a-z0-9]+)*--[a-z0-9]+(?:-[a-z0-9]+)*)"
    r"--g[1-9][0-9]*$")
RUN_ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
PERSON_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
# The Desk's db access rules (db.d.ts, contract 0.2.93), declared when the Desk is published. meta/ is written
# only by the artifact's own owner, so meta/owner cannot be planted by anyone else. people/<id>/ is written only
# by the person whose user id is <id> (nobody else, the owner included), so the path, not a `by` field anyone
# could type, says who made a decision there. Worker lane decisions (verified, release, gate approvals) live there.
DESK_DB_RULES = [
    {"path": "meta", "read": "view", "write": "owner"},
    {"path": "people", "read": "view", "write": "self"},
    {"path": "people/{self}", "read": "view", "write": "interact"},
]
REF_RE = re.compile(r"^[A-Za-z0-9_-]{1,200}$")
WORKER_PREFIXES = ("workers/", "outcomes/")
WORKER_DOC_SUFFIXES = ("", "--health", "--budget", "--learning")
OUTCOME_STATUSES = ("drafted", "sent", "skipped", "failed")
OUTCOME_NEXT = {"drafted": ("sent", "failed"), "failed": ("drafted", "sent", "skipped")}
MAX_OUTCOME_REASON = 200
ITEM_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
DOMAIN_RE = re.compile(r"^[a-z0-9-]+(\.[a-z0-9-]+)+$")


class ContractError(Exception):
    """Input the contract cannot write safely."""


class HumanPathError(ContractError):
    """A planned write touches a path only people may change."""


class LanePathError(ContractError):
    """A worker batch tried to write outside its own lane."""


class LaneStopped(Exception):
    """The worker no longer serves this lane; .reason says why."""

    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


class VersionMismatch(Exception):
    def __init__(self, path, current):
        self.path, self.current = path, current
        super().__init__(f"version mismatch on {path} (current version {current})")


def _copy(obj):
    return copy.deepcopy(obj)


def _bytes(obj):
    return len(json.dumps(obj, sort_keys=True, separators=(",", ":")).encode("utf-8"))


def _slug(text):
    s = re.sub(r"[^a-z0-9]+", "-", str(text).lower()).strip("-")
    if len(s) > MAX_SLUG:
        digest = hashlib.sha1(str(text).encode("utf-8")).hexdigest()[:8]
        s = s[:MAX_SLUG - 9].rstrip("-") + "-" + digest
    return s


def entity_id(type_name, key):
    return f"{type_name}--{_slug(key)}"


def owner_of(docs):
    """The Desk owner's user id from meta/owner, or None when the Desk has not recorded one."""
    by = (((docs or {}).get("meta/owner") or {}).get("data") or {}).get("by")
    return by if isinstance(by, str) and by else None


def lane_key(lane_id, params):
    """A lane id, a readable slug of its params and 12 hex of their SHA-256.

    The slug alone is not one-to-one (`a.b` and `a-b` slug alike), so the hash keeps two param sets
    apart; the slug is cut to 60 characters so outcome and gate ids stay inside path limits.
    """
    slug = _slug("-".join(str(params[k]) for k in sorted(params)))[:60].strip("-") or "all"
    digest = hashlib.sha256(json.dumps(params, sort_keys=True).encode("utf-8")).hexdigest()[:12]
    return f"{lane_id}--{slug}-{digest}"


def normalise_key(rule, raw):
    if rule == "domain":
        s = str(raw).strip().lower()
        s = re.sub(r"^[a-z][a-z0-9+.-]*://", "", s)
        s = re.split(r"[/?#]", s, maxsplit=1)[0]
        s = s.rpartition("@")[2].partition(":")[0].rstrip(".")
        s = s[4:] if s.startswith("www.") else s
        if DOMAIN_RE.match(s):
            return s
        return normalise_key("name", raw)
    if rule == "name":
        return " ".join(re.sub(r"[^\w\s]", "", str(raw).lower()).split())
    if isinstance(rule, str) and rule.startswith("field:"):
        return str(raw)
    raise ValueError(f"unknown identity rule '{rule}'")


def combine_fields(by_source, sightings):
    """Display values: latest sighting per field wins, bySource (sorted producers) fills the rest."""
    out = {}
    for producer in sorted(by_source):
        for field, value in by_source[producer].items():
            out.setdefault(field, value)
    for s in sorted(sightings, key=lambda s: (s.get("at", ""), s.get("run", ""))):
        out.update(s.get("values", {}))
    return out


def person_reason(given):
    """A person's drop reason as stored on the entity: control, format (bidi, zero-width), surrogate and
    line or paragraph separator characters removed, trimmed, at most 200 chars."""
    if not isinstance(given, str):
        return DROPPED_NOTE
    text = "".join(ch for ch in given if unicodedata.category(ch) not in REASON_STRIP).strip()[:MAX_PERSON_REASON].strip()
    return text or DROPPED_NOTE


def merge_picks(docs, eid, fields):
    """Field values people picked from records merged into eid (merges/<from> {into, fields}), declared fields only."""
    out = {}
    for path in sorted(p for p in docs if p.startswith("merges/")):
        m = docs[path].get("data") or {}
        if m.get("into") == eid and isinstance(m.get("fields"), dict):
            out.update({k: v for k, v in m["fields"].items() if k in fields})
    return out


def _worker_path_ok(op, lk):
    if op.get("op") != "set":
        return False
    coll, doc_id = op.get("collection"), op.get("doc_id")
    if not isinstance(doc_id, str):
        return False
    if coll == "workers":
        return doc_id in {lk + s for s in WORKER_DOC_SUFFIXES}
    if coll == "outcomes":
        parts = doc_id.split("--")
        return len(parts) == 4 and all(parts) and f"{parts[2]}--{parts[3]}" == lk
    if coll == "pending":
        found = WORKER_GATE_ID_RE.match(doc_id)
        return bool(found) and found.group("lane") == lk
    return False


def guard(ops, worker=None):
    """Refuse writes outside the caller's side of the contract.

    Producer mode (worker None): people's paths, changes to views and columns, a lane's worker paths
    and meta/owner are refused. Worker mode: only a `set` on this lane's own workers/, outcomes/ and
    pending/ documents passes.
    """
    if worker is not None:
        if not isinstance(worker, str) or not worker_kinds.LANE_KEY_RE.match(worker):
            raise LanePathError(f"refusing to write: {worker!r} is not a lane key")
        for op in ops:
            if not _worker_path_ok(op, worker):
                path = f"{op.get('collection')}/{op.get('doc_id')}"
                raise LanePathError(f"refusing to write {path}: the worker for lane {worker} may write only "
                                    f"its own workers/, outcomes/ and pending/ documents")
        return
    for op in ops:
        path = f"{op['collection']}/{op['doc_id']}"
        if path.startswith(WORKER_PREFIXES):
            raise ContractError(f"refusing to write {path}: only a lane's worker writes this path")
        if path == "meta/owner":
            raise ContractError("refusing to write meta/owner: only the Desk page writes it")
        if path.startswith(HUMAN_PREFIXES):
            raise HumanPathError(f"refusing to write {path}: people own this path")
        if path.startswith(CREATE_ONLY_PREFIXES) and (op["op"] == "delete" or op.get("if_version") is not None):
            raise HumanPathError(f"refusing to change {path}: agents may only create views and columns")


def _matches(wanted, value, ftype):
    values = value if isinstance(value, list) else [value]
    for v in values:
        for w in wanted:
            if ftype == "text" and isinstance(v, str):
                if str(w).casefold() in v.casefold():
                    return True
            elif isinstance(v, str) and isinstance(w, str):
                if v.casefold() == w.casefold():
                    return True
            elif v == w:
                return True
    return False


PROPOSAL_SHAPE = '{"setting": "<key>", "from": <current value>, "to": <suggested value>}'
# Any of these makes a proposal per-item: write stores it only when this run's learn step raised it.
LEARNED_ONLY = ("op", "value", "key", "level", "target", "change", "signal", "evidence", "sources")


PROPOSAL_KEYS = ("setting", "from", "to", "level", "op", "value", "signal", "evidence", "key", "target", "change",
                 "sources")
SOURCE_KEYS = {"source", "by", "count"}
MAX_SOURCES = 50
LEVELS = ("L1", "L2", "L3")
OPS = ("add", "remove", "set")
TARGETS = {"L2": ("definition",), "L3": ("workflow", "prompt")}
EVIDENCE_KEYS = ("count", "of", "runs", "refs")
VALUE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 .&+#/'_-]{0,59}$")
MAX_CHANGE = 400
MAX_EVIDENCE_REFS = 10


def proposal_key(setting, op, value):
    """The id rejection memory keeps for one per-item proposal. A set is keyed by setting alone, so a
    rejected "set to 8" also blocks "set to 9"."""
    if op == "set":
        return f"{setting}:set"
    return f"{setting}:{op}:{str(value).casefold()}"


def _plain(value):
    return isinstance(value, str) and bool(VALUE_RE.match(value))


def _whole(v):
    return isinstance(v, int) and not isinstance(v, bool)


def _check_signal(signal, producer):
    pid = producer["id"]
    if signal not in definition.SIGNALS:
        raise ContractError(f"unknown signal {signal!r}; use one of {', '.join(definition.SIGNALS)}")
    learning = producer.get("learning")
    if not learning or not learning.get("enabled"):
        raise ContractError(f"signal {signal} refused: learning is off for {pid}")
    if not learning.get("signals", {}).get(signal, True):
        raise ContractError(f"signal {signal} is off for {pid}")


def _check_evidence(ev):
    shape = "proposal evidence must be {count, of, runs, refs} with whole numbers and at most 10 text refs"
    if not isinstance(ev, dict) or any(k not in EVIDENCE_KEYS for k in ev):
        raise ContractError(shape)
    if any(k in ev and not (_whole(ev[k]) and ev[k] >= 0) for k in ("count", "of", "runs")):
        raise ContractError(shape)
    refs = ev.get("refs", [])
    if not isinstance(refs, list) or len(refs) > MAX_EVIDENCE_REFS or not all(isinstance(r, str) for r in refs):
        raise ContractError(shape)


def _check_sources(sources):
    shape = ('proposal sources must be a list of {source: "owner" or a lane key, by: a user id or null, '
             'count: a whole number of at least 1}')
    if not isinstance(sources, list) or not sources or len(sources) > MAX_SOURCES:
        raise ContractError(shape)
    for src in sources:
        if not isinstance(src, dict) or set(src) != SOURCE_KEYS:
            raise ContractError(shape)
        if src["source"] != "owner" and not (isinstance(src["source"], str) and worker_kinds.LANE_KEY_RE.match(src["source"])):
            raise ContractError(shape)
        by = src["by"]
        if by is not None and (not isinstance(by, str) or not by or len(by) > 200 or CONTROL_RE.search(by)):
            raise ContractError(shape)
        if not _whole(src["count"]) or src["count"] < 1:
            raise ContractError(shape)


def _item_change(prop, sdef, current):
    """(from, to) for one per-item L1 change against the run's settings value."""
    setting, op, value = sdef["name"], prop["op"], prop.get("value")
    stype = sdef.get("type")
    plain = f"proposal value {value!r} must be a plain value (letters, digits, spaces and . & + # / ' _ -, at most 60 characters)"
    if op in ("add", "remove"):
        if stype != "list":
            raise ContractError(f"{op} needs a list setting; {setting} is a {stype}")
        if not _plain(value):
            raise ContractError(plain)
        items = list(current or [])
        present = any(str(x).casefold() == value.casefold() for x in items)
        if op == "add":
            if present:
                raise ContractError(f"{value} is already in {setting}")
            return items, items + [value]
        if not present:
            raise ContractError(f"{value} is not in {setting}")
        return items, [x for x in items if str(x).casefold() != value.casefold()]
    if stype == "list":
        raise ContractError(f"set needs a single-value setting; use add or remove for {setting}")
    if stype == "number":
        if not _whole(value):
            raise ContractError(f"{setting} takes a whole number, not {value!r}")
        lo, hi = sdef.get("min"), sdef.get("max")
        if (lo is not None and value < lo) or (hi is not None and value > hi):
            raise ContractError(f"{value} is out of range for {setting}: it takes {lo} to {hi}")
    elif not _plain(value):
        raise ContractError(plain)
    elif stype == "choice" and value not in sdef.get("choices", []):
        raise ContractError(f"{value} is not a choice of {setting}")
    return current, value


def check_proposal(prop, producer, settings):
    """The proposal as stored, or ContractError. {setting, from, to} passes unchanged; per-item and
    L2/L3 proposals are schema-checked and L1 items get from, to and key computed here."""
    unknown = [k for k in prop if k not in PROPOSAL_KEYS]
    if unknown:
        raise ContractError(f"unknown proposal field {unknown[0]!r}; a proposal carries {', '.join(PROPOSAL_KEYS)}")
    level = prop.get("level", "L1")
    if level not in LEVELS:
        raise ContractError(f"proposal level must be L1, L2 or L3, not {level!r}")
    setting = prop.get("setting")
    if setting is not None and definition.never_learnable(setting):
        raise ContractError(f"{setting} is never learnable; no proposal may change it")
    if "signal" in prop:
        _check_signal(prop["signal"], producer)
    if "evidence" in prop:
        _check_evidence(prop["evidence"])
    if "sources" in prop:
        _check_sources(prop["sources"])
    out = _copy(prop)
    if level != "L1":
        if "op" in prop or "to" in prop:
            raise ContractError(f"an {level} proposal never carries op or to; it opens a PR and writes no setting")
        allowed = TARGETS[level]
        if prop.get("target") not in allowed:
            raise ContractError(f"{level} target must be {' or '.join(allowed)}")
        change = prop.get("change")
        if not isinstance(change, str) or not change.strip() or len(change) > MAX_CHANGE:
            raise ContractError(f"proposal change must be text of at most {MAX_CHANGE} characters")
        digest = hashlib.sha1(change.strip().casefold().encode("utf-8")).hexdigest()[:12]
        out.update(level=level, key=proposal_key(prop["target"], level.lower(), digest))
        return out
    if "op" not in prop:
        return out
    if prop["op"] not in OPS:
        raise ContractError(f"proposal op must be add, remove or set, not {prop['op']!r}")
    if "from" in prop or "to" in prop:
        raise ContractError("a per-item proposal carries op and value; the contract computes from and to")
    sdef = {s["name"]: s for s in producer.get("settings", [])}.get(setting)
    if sdef is None:
        raise ContractError(f"{setting} is not a setting of {producer['id']}")
    before, after = _item_change(prop, sdef, _copy(settings.get(setting)))
    out.update({"level": "L1", "from": before, "to": after, "key": proposal_key(setting, prop["op"], prop["value"])})
    return out


def _check_proposal(msg, producer, settings):
    """A proposal message must carry proposal {setting, from, to} or a per-item proposal; the Desk
    writes `to` on Accept. Returns the proposal as stored."""
    if msg.get("kind") != "proposal":
        return None
    prop = msg.get("proposal")
    per_item = isinstance(prop, dict) and ("op" in prop or prop.get("level", "L1") != "L1")
    whole = isinstance(prop, dict) and isinstance(prop.get("setting"), str) and prop["setting"] and "from" in prop and "to" in prop
    if per_item or whole:
        return check_proposal(prop, producer, settings)
    hint = ""
    if isinstance(prop, dict) and ("current" in prop or "suggested" in prop):
        hint = "; use the fields from and to, not current and suggested"
    raise ContractError(f"proposal message {msg.get('title')!r} must carry proposal {PROPOSAL_SHAPE}{hint}")


class _Plan:
    def __init__(self, defn, docs, inp):
        self.defn, self.inp = defn, inp
        self.docs = {p: _copy(d) for p, d in docs.items() if not p.startswith(PRIVATE_PREFIXES)}
        self.versions = {p: d["version"] for p, d in self.docs.items()}
        self.pid = inp["producer"]
        self.run_id = inp["runId"]
        self.at = inp.get("startedAt") or inp.get("endedAt")
        producers = {p["id"]: p for p in defn.get("producers", [])}
        if self.pid not in producers:
            raise ContractError(f"producer '{self.pid}' is not in the compiled definition")
        self.producer = producers[self.pid]
        self.run_path = f"runs/{self.run_id}"
        prior = self.data(self.run_path) or {}
        self.settings = prior.get("settingsUsed") or self._settings()
        self.policy = prior.get("mergePolicy") or self._policy()
        self.roles = {s["name"]: s.get("role") for s in self.producer.get("settings", [])}
        self.raw_docs = docs
        self._learned = None

    def data(self, path):
        doc = self.docs.get(path)
        return doc["data"] if doc else None

    def _settings(self):
        values = {s["name"]: _copy(s.get("default")) for s in self.producer.get("settings", [])}
        values.update(_copy((self.data(f"settings/{self.pid}") or {}).get("values", {})))
        return values

    def _policy(self):
        chosen = (self.data("settings/workspace") or {}).get("values", {}).get("mergePolicy", {})
        return {t: chosen.get(t, tdef.get("merge", "merge")) for t, tdef in sorted(self.defn["types"].items())}

    def op(self, path, data):
        """A set op for path, or None when the stored data already equals data."""
        if self.data(path) == data:
            return None
        if _bytes(data) > MAX_DOC_BYTES:
            raise ContractError(f"{path} would be {_bytes(data)} bytes, over the 256 KiB document limit")
        coll, _, doc_id = path.rpartition("/")
        entry = {"op": "set", "collection": coll, "doc_id": doc_id, "data": data}
        if path in self.versions:
            entry["if_version"] = self.versions[path]
        self.versions[path] = self.versions.get(path, 0) + 1
        self.docs[path] = {"version": self.versions[path], "data": data}
        return entry

    def type_def(self, tname):
        tdef = self.defn["types"].get(tname)
        if tdef is None:
            raise ContractError(f"type '{tname}' is not in the compiled definition")
        return tdef

    def resolve(self, tname, raw_key):
        """(normalised key, entity id, redirected) after merge policy and hand merges."""
        key = normalise_key(self.type_def(tname)["identity"], raw_key)
        if key == "":
            raise ContractError(f"{tname} key {raw_key!r} is empty once normalised")
        if self.policy.get(tname) == "separate":
            eid = entity_id(tname, f"{self.pid}--{key}")
        else:
            eid = entity_id(tname, key)
        seen = [eid]
        while True:
            into = (self.data(f"merges/{eid}") or {}).get("into")
            if not into:
                return key, eid, len(seen) > 1
            if into in seen:
                raise ContractError(f"hand merge cycle: {' -> '.join(seen + [into])}")
            seen.append(into)
            eid = into

    def record_key(self, rec):
        rule = self.type_def(rec.get("type"))["identity"]
        values = rec.get("values", {})
        if rule.startswith("field:"):
            raw = values.get(rule[6:])
        elif rule == "domain":
            raw = rec.get("key") or values.get("domain") or values.get("name")
        else:
            raw = rec.get("key")
        if raw in (None, ""):
            raise ContractError(f"{rec.get('type')} record has no identity value for {rule}")
        return raw

    def drop_reason(self, tname, values):
        tdef = self.type_def(tname)
        for flt in tdef.get("settingFilters", []):
            if flt.get("producer") != self.pid:
                continue
            sname, field = flt["setting"], flt["field"]
            wanted = self.settings.get(sname) or []
            value = values.get(field)
            if value in (None, "", []):
                continue
            ftype = tdef["fields"].get(field, {}).get("type")
            role = self.roles.get(sname)
            if role == "exclude" and wanted and _matches(wanted, value, ftype):
                return f"excluded by {sname}"
            if role == "include" and wanted and not _matches(wanted, value, ftype):
                return f"not in {sname}"
        return None

    def known_columns(self):
        cols = {p[len("columns/"):] for p in self.docs if p.startswith("columns/")}
        return cols | {c.get("id") for c in self.inp.get("columns", []) if c.get("id")}

    def entity(self, rec, outcomes, ops):
        tname = rec.get("type")
        key, eid, redirected = self.resolve(tname, self.record_key(rec))
        path = f"entities/{eid}"
        if eid in outcomes:
            return
        old = self.data(path)
        if old and not redirected and old.get("key") != key:
            raise ContractError(f"{path} already holds key '{old.get('key')}', not '{key}' (slug collision)")
        prior = [s for s in (old or {}).get("sightings", []) if s.get("run") == self.run_id]
        if prior:
            outcomes[eid] = (prior[-1].get("outcome"), prior[-1].get("dropReason"))
            return
        values = _copy(rec.get("values", {}))
        reason = self.drop_reason(tname, values)
        decision = self.data(f"decisions/{eid}") or {}
        kept = bool(reason) and decision.get("decision") == "keep"
        if kept:
            reason = None
        # A person's drop wins over the routine's filters while the decision stands (Desk v2).
        # The sighting and the run summary carry only the fixed note; the free text lives on the entity alone.
        person_drop = decision.get("decision") == "drop"
        if person_drop:
            reason = DROPPED_NOTE
        status = "dropped" if reason else "active"
        doc = _copy(old) if old else {
            "type": tname, "key": key, "bySource": {}, "firstSeen": self.at, "seenCount": 0,
            "sources": [], "links": [], "sightings": [], "agentFields": {}, "schema": 1,
        }
        if not old:
            outcome = "new"
        elif doc["bySource"].get(self.pid) != values or doc.get("status") != status:
            outcome = "updated"
        else:
            outcome = "unchanged"
        doc["bySource"][self.pid] = values
        doc["lastSeen"] = self.at
        doc["seenCount"] = doc.get("seenCount", 0) + 1
        doc["sources"] = sorted(set(doc.get("sources", [])) | {self.pid})
        links = doc.get("links", [])
        for link in rec.get("links", []):
            lkey, lid, _ = self.resolve(link["type"], link["key"])
            if lid not in [l["id"] for l in links]:
                links.append({"type": link["type"], "key": lkey, "id": lid})
        doc["links"] = links
        sighting = {
            "run": self.run_id, "at": self.at, "producer": self.pid, "values": values,
            "outcome": outcome, "dropReason": reason,
        }
        if kept:
            sighting["note"] = KEPT_NOTE
        if person_drop:
            sighting["note"] = DROPPED_NOTE
        doc["sightings"] = (doc.get("sightings", []) + [sighting])[-MAX_SIGHTINGS:]
        doc["display"] = combine_fields(doc["bySource"], doc["sightings"])
        doc["display"].update(merge_picks(self.docs, eid, self.type_def(tname).get("fields", {})))
        doc["status"] = status
        doc["dropReason"] = person_reason(decision.get("reason")) if person_drop else reason
        cols = self.known_columns()
        fields = dict(doc.get("agentFields", {}), **rec.get("agentFields", {}))
        doc["agentFields"] = {k: v for k, v in fields.items() if k in cols}
        doc["lastRun"] = self.run_id
        if _bytes(doc) > MAX_DOC_BYTES:
            raise ContractError(f"entity {eid} would be {_bytes(doc)} bytes, over the 256 KiB document limit")
        outcomes[eid] = (outcome, reason)
        ops.append(self.op(path, doc))

    def ref(self, ref):
        key, eid, _ = self.resolve(ref["type"], ref["key"])
        return {"type": ref["type"], "key": key, "id": eid}

    def learned(self):
        """The proposals this run's learn step raises, recomputed here so a per-item proposal is one code
        counted against thresholds and rejection memory, not one the model wrote."""
        if self._learned is None:
            import learn  # learn imports this module
            self._learned = [m["proposal"] for m in learn.plan_learning(self.defn, self.raw_docs, self.inp)[1]]
        return self._learned

    def check_inbox_proposal(self, msg):
        prop = _check_proposal(msg, self.producer, self.settings)
        if prop is None:
            return None
        if (self.data("settings/workspace") or {}).get("values", {}).get("learning") is False:
            raise ContractError(f"proposal message {msg.get('title')!r} refused: learning is off for this workspace")
        raw = msg["proposal"]
        if any(k in raw for k in LEARNED_ONLY) and raw not in self.learned():
            raise ContractError(f"proposal message {msg.get('title')!r} is a per-item proposal but is not one this "
                                "run's learn step raised; append proposals.json from routineos.py learn unchanged")
        return prop

    def inbox(self, ops):
        written = suppressed = filtered = 0
        messages = self.inp.get("inbox", [])
        if not self.producer.get("inbox"):
            return 0, len(messages), 0
        cap = self.settings.get("max_inbox_per_run")
        for msg in messages:
            prop = self.check_inbox_proposal(msg)
            refs = [self.ref(r) for r in msg.get("refs", [])]
            states = [(self.data(f"entities/{r['id']}") or {}).get("status") for r in refs]
            if msg.get("kind") == "match" and refs and all(s == "dropped" for s in states):
                filtered += 1
                continue
            if cap is not None and written >= cap:
                suppressed += 1
                continue
            written += 1
            doc = {k: _copy(msg[k]) for k in INBOX_KEYS if k in msg}
            if prop is not None:
                doc["proposal"] = prop
            doc.update(refs=refs, run=self.run_id, producer=self.pid, createdAt=self.at, schema=1)
            ops.append(self.op(f"inbox/{self.run_id}--{written}", doc))
        return written, suppressed, filtered

    def gates(self, ops):
        for gate in self.inp.get("gates", []):
            gid = gate.get("id")
            found = GATE_ID_RE.match(gid) if isinstance(gid, str) else None
            if not found or found.group(1) != self.run_id:
                raise ContractError(f"gate id {gid!r} must be '{self.run_id}--g<n>' (this run id, then --g and a number)")
            path = f"pending/{gid}"
            if f"decisions/{gid}" in self.docs:
                continue
            if path in self.docs and (self.data(path) or {}).get("run") != self.run_id:
                continue
            _check_gate_extras(gid, gate)
            doc = {k: _copy(gate[k]) for k in GATE_KEYS if k in gate}
            doc.update(status="pending", run=self.run_id, producer=self.pid, createdAt=self.at, schema=1)
            ops.append(self.op(path, doc))

    def proposals(self, ops):
        for coll, items in (("views", self.inp.get("views", [])), ("columns", self.inp.get("columns", []))):
            for item in items:
                iid = item.get("id")
                if not isinstance(iid, str) or not ITEM_ID_RE.match(iid):
                    raise ContractError(f"{coll[:-1]} id {iid!r} must be lowercase letters, digits, hyphens and underscores")
                if coll == "views" and "icon" in item and item["icon"] not in definition.NAV_ICONS:
                    raise ContractError(definition.lint_icon(f"view {iid!r}", item["icon"])[0])
                path = f"{coll}/{iid}"
                if path in self.docs:
                    continue
                ops.append(self.op(path, dict(_copy(item), madeBy="agent", state="proposed", producer=self.pid)))


def _check_gate_extras(gid, gate):
    """A gate's optional draft {subject, body} and recipients [{role}]: roles only, never an address."""
    if "draft" in gate:
        d = gate["draft"]
        if not isinstance(d, dict) or set(d) != {"subject", "body"} or not all(isinstance(d[k], str) for k in d):
            raise ContractError(f"gate {gid}: draft must be exactly {{subject, body}} with text values")
    if "recipients" in gate:
        rs = gate["recipients"]
        if not isinstance(rs, list):
            raise ContractError(f"gate {gid}: recipients must be a list of {{role}}")
        for r in rs:
            if not isinstance(r, dict) or set(r) != {"role"}:
                raise ContractError(f"gate {gid}: each recipient must be exactly {{role}}; addresses are never stored")
            role = r["role"]
            if not isinstance(role, str) or not role.strip() or ADDRESS_RE.search(role.strip()):
                raise ContractError(f"gate {gid}: recipient role {role!r} must be a role name, not an address")


def _chunks(name, ops):
    ops = [o for o in ops if o is not None]
    out, cur, size = [], [], 0
    for o in ops:
        b = _bytes(o)
        if cur and (len(cur) >= MAX_BATCH_OPS or size + b > MAX_BATCH_BYTES):
            out.append({"name": name, "ops": cur})
            cur, size = [], 0
        cur.append(o)
        size += b
    out.append({"name": name, "ops": cur})
    return out


def plan_run(defn, docs, run_input):
    """Ordered phases [{name, ops}] for one run: started, entities..., summary, inbox, done."""
    p = _Plan(defn, docs, run_input)
    if (p.data(p.run_path) or {}).get("phase") == "done":
        return [{"name": n, "ops": []} for n in ("started", "entities", "summary", "inbox", "done")]
    inp = run_input
    base = {
        "runId": p.run_id, "producer": p.pid, "startedAt": inp.get("startedAt"),
        "definitionVersion": defn.get("version"), "settingsUsed": p.settings, "mergePolicy": p.policy,
        "schema": 1,
    }
    phases = _chunks("started", [p.op(p.run_path, dict(base, phase="started"))])

    outcomes, entity_ops = {}, []
    for rec in inp.get("records", []):
        p.entity(rec, outcomes, entity_ops)
    phases += _chunks("entities", entity_ops)

    inbox_ops = []
    p.gates(inbox_ops)
    written, suppressed, filtered = p.inbox(inbox_ops)
    counts = {"new": 0, "updated": 0, "unchanged": 0, "dropped": 0}
    by_reason, dropped, changed = {}, [], []
    for eid, (outcome, reason) in outcomes.items():
        counts[outcome] += 1
        if outcome == "updated":
            changed.append(eid)
        if reason:
            counts["dropped"] += 1
            by_reason[reason] = by_reason.get(reason, 0) + 1
            dropped.append({"id": eid, "reason": reason})
    parsed, claimed = inp.get("parsed", 0), inp.get("claimed", 0)
    summary = dict(
        base, phase="summary", endedAt=inp.get("endedAt"),
        status="partial" if parsed < claimed else inp.get("status", "ok"),
        parsed=parsed, claimed=claimed, sessionUrl=inp.get("sessionUrl"), parentRun=inp.get("parentRun"),
        counts=counts, droppedByReason=by_reason, dropped=dropped[:MAX_DROPPED_LISTED],
        changed=changed[:MAX_CHANGED_LISTED], inboxWritten=written, inboxSuppressed=suppressed,
        inboxFiltered=filtered,
    )
    summary_ops = [p.op(p.run_path, summary)]
    p.proposals(summary_ops)
    phases += _chunks("summary", summary_ops)
    phases += _chunks("inbox", inbox_ops)
    phases += _chunks("done", [p.op(p.run_path, dict(summary, phase="done"))])
    return phases


def plan_seed(defn, workspace, docs):
    """Phases for the one-time setup: meta/workspace, meta/definition, meta/join, then default settings.

    The join card goes to meta/join, never into meta/definition. A Desk whose definition no longer
    carries a join block gets its stored card closed, never deleted. meta/owner is never written here.

    People own settings/, so a settings doc that already exists is never written again.
    """
    docs = docs or {}
    ops = []

    def put(path, data):
        coll, _, doc_id = path.rpartition("/")
        entry = {"op": "set", "collection": coll, "doc_id": doc_id, "data": data}
        if path in docs:
            entry["if_version"] = docs[path]["version"]
        ops.append(entry)

    ws: dict = dict(createdBy="routineos new", **_copy(workspace))
    ws["createdAt"] = ((docs.get("meta/workspace") or {}).get("data") or {}).get("createdAt") or ws.get("createdAt")
    ws.update(producers=[p["id"] for p in defn.get("producers", [])], schema=1)
    put("meta/workspace", ws)
    put("meta/definition", {k: _copy(v) for k, v in defn.items() if k != "join"})
    stored_join = (docs.get("meta/join") or {}).get("data") or {}
    if "join" in defn:
        card = _copy(defn["join"])
        if "url" not in card and stored_join.get("url"):
            card["url"] = stored_join["url"]
        put("meta/join", card)
    elif "meta/join" in docs and stored_join.get("open") is True:
        put("meta/join", dict(_copy(stored_join), open=False))
    stamp = {"updatedAt": ws["createdAt"], "updatedBy": "seed"}
    for producer in defn.get("producers", []):
        path = f"settings/{producer['id']}"
        if path not in docs:
            values = {s["name"]: _copy(s.get("default")) for s in producer.get("settings", [])}
            put(path, dict(values=values, **stamp))
    if "settings/workspace" not in docs:
        policy = {t: tdef.get("merge", "merge") for t, tdef in sorted(defn.get("types", {}).items())}
        put("settings/workspace", dict(values={"notifications": "inbox", "quietHours": {"from": "", "to": ""},
                                               "mergePolicy": policy}, **stamp))
    for path, data in ((f"{o['collection']}/{o['doc_id']}", o["data"]) for o in ops):
        if _bytes(data) > MAX_DOC_BYTES:
            raise ContractError(f"{path} would be {_bytes(data)} bytes, over the 256 KiB document limit")
    return _chunks("seed", ops)


class FakeStore:
    """In-memory stand-in for the artifact db with ArtifactData version pins."""

    def __init__(self):
        self.docs = {}

    def get(self, path):
        doc = self.docs.get(path)
        if doc is None:
            return f"not found: {path}"
        return {"path": path, "version": doc["version"], "data": _copy(doc["data"])}

    def _check(self, path, if_version, versions):
        current = versions.get(path)
        if current is None:
            if if_version is not None:
                raise VersionMismatch(path, None)
        elif if_version != current:
            raise VersionMismatch(path, current)

    def set(self, path, data, if_version=None):
        self.apply([{"op": "set", "collection": path.rpartition("/")[0],
                     "doc_id": path.rpartition("/")[2], "data": data, "if_version": if_version}])

    def delete(self, path, if_version=None):
        self.apply([{"op": "delete", "collection": path.rpartition("/")[0],
                     "doc_id": path.rpartition("/")[2], "if_version": if_version}])

    def apply(self, ops):
        """All writes land or none do; every pin is checked before anything changes."""
        versions = {p: d["version"] for p, d in self.docs.items()}
        for op in ops:
            path = f"{op['collection']}/{op['doc_id']}"
            self._check(path, op.get("if_version"), versions)
            versions[path] = None if op["op"] == "delete" else (versions.get(path) or 0) + 1
        for op in ops:
            path = f"{op['collection']}/{op['doc_id']}"
            if op["op"] == "delete":
                self.docs.pop(path, None)
                continue
            data = _copy(op["data"])
            if op["op"] == "update" and path in self.docs:
                data = dict(self.docs[path]["data"], **data)
            self.docs[path] = {"version": self.docs.get(path, {}).get("version", 0) + 1, "data": data}

    def snapshot(self):
        return _copy(self.docs)


def apply_run(store, defn, run_input, retries=1):
    """Plan and apply a run; on a version mismatch re-read, re-plan and retry up to `retries` times."""
    attempts = 0
    while True:
        attempts += 1
        phases = plan_run(defn, store.snapshot(), run_input)
        try:
            for ph in phases:
                guard(ph["ops"])
                if ph["ops"]:
                    store.apply(ph["ops"])
            return {"ok": True, "attempts": attempts}
        except VersionMismatch as exc:
            if attempts > retries:
                return {"ok": False, "attempts": attempts, "error": str(exc), "path": exc.path}


def _data(docs, path):
    d = (docs or {}).get(path)
    return d.get("data") if isinstance(d, dict) and isinstance(d.get("data"), dict) else None


def person_path(uid, doc_id):
    """people/<uid>/decisions/<doc_id>, where only the person uid can write (DESK_DB_RULES)."""
    return f"people/{uid}/decisions/{doc_id}"


def person_decision(docs, uid, doc_id):
    """The decision person uid wrote at people/<uid>/decisions/<doc_id>, or None. Anything at
    decisions/<doc_id>, whatever its `by` says, is never read here: any writer can type a `by`."""
    if not isinstance(uid, str) or not PERSON_ID_RE.match(uid):
        return None
    d = _data(docs, person_path(uid, doc_id))
    if d is None or d.get("by") != uid:
        return None
    return d


def accepted_decision(docs, gid, by):
    """The joiner's own decision on gate gid, read only from the joiner's people/ path."""
    return person_decision(docs, by, gid)


JOINED_AT_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$")


def released(docs, lk, w):
    """Whether the Desk owner's release covers worker doc w on lane lk.

    workers/<lk> is writable by any Contributor, so its joinedAt is never trusted to outlive a release: a release
    naming a `holder` is final for that holder until the owner removes it (re-admit), whatever joinedAt says. Only a
    release without a holder compares times. A missing or malformed joinedAt counts as released."""
    joined = w.get("joinedAt")
    if not isinstance(joined, str) or not JOINED_AT_RE.match(joined):
        return True
    rel = person_decision(docs, owner_of(docs), f"release--{lk}")
    if not rel:
        return False
    if "holder" in rel:
        return rel["holder"] == w.get("by")
    return isinstance(rel.get("at"), str) and rel["at"] > joined


def lane_stop_reason(docs, lk, by):
    """Why the worker `by` must not run lane `lk` now, or None when it may."""
    w = _data(docs, f"workers/{lk}")
    if w is None:
        return "no worker document"
    if w.get("status") == "left":
        return "left"
    if w.get("by") != by:
        return "served by someone else"
    if released(docs, lk, w):
        return "released"
    return None


def _worker_lane(card, docs, lk):
    w = _data(docs, f"workers/{lk}")
    lane = join_card.lane_by_id(card, w.get("lane"))
    if lane is None:
        raise ContractError(f"lane {w.get('lane')!r} of workers/{lk} is not on this Desk's join card")
    params = w.get("params")
    if not isinstance(params, dict) or lane_key(lane["id"], params) != lk:
        raise ContractError(f"workers/{lk}: its lane and params do not give this lane key")
    return w, lane, params


def _matching_entity(docs, lane, params, item):
    if not isinstance(item, str) or item.count("--") != 1 or not all(item.split("--")):
        raise ContractError(f"item {item!r} must be an entity id <type>--<slug>")
    ent = _data(docs, f"entities/{item}")
    if ent is None or not join_card.matches(lane, params, ent):
        raise ContractError(f"item {item} is not an active entity on this lane")
    return ent


def plan_worker_run(card, docs, worker_input):
    """Phases [{name, ops}] for one worker run: outcomes, gates, health. Raises LaneStopped."""
    inp = worker_input
    lk, by, run_id = inp.get("laneKey"), inp.get("by"), inp.get("runId")
    if not isinstance(lk, str) or not worker_kinds.LANE_KEY_RE.match(lk):
        raise ContractError(f"laneKey {lk!r} is not a lane key")
    if not isinstance(run_id, str) or not RUN_ID_RE.match(run_id):
        raise ContractError(f"runId {run_id!r} must be lowercase letters and digits joined by single hyphens")
    reason = lane_stop_reason(docs, lk, by)
    if reason:
        raise LaneStopped(reason)
    _, lane, params = _worker_lane(card, docs, lk)
    verified = person_decision(docs, by, f"verified--{lk}") is not None
    report_only = f"report-only until {person_path(by, 'verified--' + lk)} exists"
    started, ended = inp.get("startedAt"), inp.get("endedAt")
    versions = {p: d["version"] for p, d in docs.items()}

    def op(path, data):
        coll, _, doc_id = path.rpartition("/")
        entry = {"op": "set", "collection": coll, "doc_id": doc_id, "data": data}
        if path in versions:
            entry["if_version"] = versions[path]
        if _bytes(data) > MAX_DOC_BYTES:
            raise ContractError(f"{path} would be {_bytes(data)} bytes, over the 256 KiB document limit")
        return entry

    outcome_ops, current = [], {}
    for o in inp.get("outcomes", []):
        if not isinstance(o, dict) or not set(o) <= {"item", "status", "reason", "ref"}:
            raise ContractError("each outcome must be {item, status, reason?, ref?}")
        item, status = o.get("item"), o.get("status")
        if status not in OUTCOME_STATUSES:
            raise ContractError(f"outcome status {status!r} must be one of {', '.join(OUTCOME_STATUSES)}")
        _matching_entity(docs, lane, params, item)
        why, ref = o.get("reason"), o.get("ref")
        if why is not None and (not isinstance(why, str) or len(why) > MAX_OUTCOME_REASON
                                or ADDRESS_RE.search(why) or CONTROL_RE.search(why)):
            raise ContractError(f"outcome reason for {item} must be text of at most {MAX_OUTCOME_REASON} "
                                f"characters with no address or link")
        if ref is not None and (not isinstance(ref, str) or not REF_RE.match(ref)):
            raise ContractError(f"outcome ref for {item} must match {REF_RE.pattern}")
        if status in ("drafted", "sent") and not verified:
            raise ContractError(report_only)
        if status == "sent":
            if lane.get("gate") != "send":
                raise ContractError(f"lane {lane['id']} has gate {lane.get('gate')!r}; only a send gate records sent")
            if not _approved_gate(docs, lk, item, by):
                raise ContractError(f"item {item} has no gate on lane {lk} approved by its joiner")
        path = f"outcomes/{item}--{lk}"
        old = current.get(path, (_data(docs, path) or {}).get("status"))
        if old == status or (old is not None and status not in OUTCOME_NEXT.get(old, ())):
            continue
        current[path] = status
        outcome_ops.append(op(path, {"item": item, "lane": lk, "status": status, "reason": why,
                                     "at": ended, "by": by, "ref": ref}))

    gate_ops = []
    for n, gate in enumerate(inp.get("gates", []), 1):
        if not verified:
            raise ContractError(report_only)
        if lane.get("gate") != "send":
            raise ContractError(f"lane {lane['id']} has gate {lane.get('gate')!r}; it opens no gates")
        gid = gate.get("id") if isinstance(gate, dict) else None
        found = WORKER_GATE_ID_RE.match(gid) if isinstance(gid, str) else None
        if not found or found.group("run") != run_id or found.group("lane") != lk:
            raise ContractError(f"gate id {gid!r} must be '{run_id}--{lk}--g<n>'")
        item = gate.get("item")
        _matching_entity(docs, lane, params, item)
        path = f"pending/{gid}"
        if person_path(by, gid) in docs:
            continue
        if path in docs and (_data(docs, path) or {}).get("run") != run_id:
            continue
        _check_gate_extras(gid, gate)
        gdoc = {k: _copy(gate[k]) for k in GATE_KEYS if k in gate}
        gdoc.update(status="pending", run=run_id, lane=lk, item=item, createdAt=started or ended, schema=1)
        if _data(docs, path) != gdoc:
            gate_ops.append(op(path, gdoc))

    tail = []
    if "budget" in inp:
        _check_budget(inp["budget"])
        tail.append(op(f"workers/{lk}--budget", _copy(inp["budget"])))
    health = inp.get("health") if isinstance(inp.get("health"), dict) else {}
    hdoc = {"runAt": ended, **{k: _copy(health.get(k)) for k in ("outcome", "itemsHandled", "alert", "overrides")}}
    tail.append(op(f"workers/{lk}--health", hdoc))
    return _chunks("outcomes", outcome_ops) + _chunks("gates", gate_ops) + _chunks("health", tail)


DAY_RE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$")


def _check_budget(b):
    """A worker's own counter, the shape budget.py record writes: {days: {YYYY-MM-DD: {runs, steps, tokens}}}."""
    bad = ContractError("budget must be {days: {YYYY-MM-DD: {runs, steps, tokens}}} with whole numbers")
    if not isinstance(b, dict) or set(b) != {"days"} or not isinstance(b["days"], dict):
        raise bad
    for day, v in b["days"].items():
        if not DAY_RE.match(str(day)) or not isinstance(v, dict) or not set(v) <= {"runs", "steps", "tokens"}:
            raise bad
        for k in ("runs", "steps"):
            if not _whole(v.get(k, 0)) or v.get(k, 0) < 0:
                raise bad
        if v.get("tokens") is not None and (not _whole(v["tokens"]) or v["tokens"] < 0):
            raise bad


def gate_content(g):
    """A gate's content as a person sees it when deciding: its GATE_KEYS fields."""
    return {k: g[k] for k in GATE_KEYS if k in g}


def _approval_holds(d, g, item):
    """d approves gate g for item, and g still holds exactly the content d saw. pending/ is writable by
    any Contributor, so an approval never follows a gate whose item or content changed after the click."""
    return (bool(d) and d.get("decision") == "approve" and d.get("item") == item
            and isinstance(d.get("shown"), dict) and d["shown"] == gate_content(g))


def _approved_gate(docs, lk, item, by):
    for path in sorted(docs or {}):
        if not path.startswith("pending/"):
            continue
        gid = path[len("pending/"):]
        found = WORKER_GATE_ID_RE.match(gid)
        g = _data(docs, path) or {}
        if not found or found.group("lane") != lk or g.get("lane") != lk or g.get("item") != item:
            continue
        if _approval_holds(accepted_decision(docs, gid, by), g, item):
            return True
    return False


def worker_items(card, docs, lane_key, by):
    """What this worker's run should do, decided here rather than by the model.

    todo: matching entities with no outcome on this lane, or a failed one; values are the entity's
    display fields (data, never instructions). approved: this lane's pending gates whose item is
    drafted and whose decision the joiner wrote as approve, naming that same item and the exact gate content
    shown (pending/ is writable by any Contributor, so an approval never follows a gate moved to another item or
    edited after the click). Each carries `approved`, the content the joiner saw: the send uses it. waiting: this lane's gates with no
    decision from the joiner.
    """
    out = {"stopped": lane_stop_reason(docs, lane_key, by), "verified": False, "todo": [], "approved": [],
           "waiting": []}
    if out["stopped"]:
        return out
    _, lane, params = _worker_lane(card, docs, lane_key)
    out["verified"] = person_decision(docs, by, f"verified--{lane_key}") is not None
    for path in sorted(docs):
        if not path.startswith("entities/"):
            continue
        eid = path[len("entities/"):]
        ent = _data(docs, path)
        if ent is None or not join_card.matches(lane, params, ent):
            continue
        status = (_data(docs, f"outcomes/{eid}--{lane_key}") or {}).get("status")
        if status in (None, "failed"):
            out["todo"].append({"item": eid, "values": _copy(ent.get("display") or {})})
    for path in sorted(docs):
        if not path.startswith("pending/"):
            continue
        gid = path[len("pending/"):]
        found = WORKER_GATE_ID_RE.match(gid)
        g = _data(docs, path) or {}
        if not found or found.group("lane") != lane_key or g.get("lane") != lane_key:
            continue
        item = g.get("item")
        d = accepted_decision(docs, gid, by)
        if d is None:
            out["waiting"].append(gid)
        elif _approval_holds(d, g, item) and \
                (_data(docs, f"outcomes/{item}--{lane_key}") or {}).get("status") == "drafted":
            out["approved"].append({"gate": gid, "item": item, "approved": _copy(d["shown"])})
    return out
