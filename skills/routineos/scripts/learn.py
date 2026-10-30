"""Learn: running tallies from each run and per-item proposals that clear deterministic thresholds.
Standard library only.

plan_learning is pure: it reads a docs snapshot and one run input and returns the next
`state/learning` document and the proposal messages to add to the run's Inbox. Code counts and
decides; the model may only rephrase a message's title and why. Fetched text only ever becomes a
plain value, checked by desk_contract.check_proposal before it leaves here.
"""
import copy
import re
from datetime import datetime

import definition
import desk_contract as dc
import join_card
import worker_kinds

MAX_DROP_IDS = 50
MAX_DROP_VALUES = 200
MAX_LIMIT_RUNS = 10
MAX_REFS = 10
DAY = 86400
REJECTED = ("reject", "dismiss")
UNCAPPED_KINDS = ("proposal", "approval")
WORD_RE = re.compile(r"[a-z0-9]{3,60}")
STOPWORDS = frozenset((
    "the and for with from that this are was were you your our their his her its not but all any can "
    "into out per via has have had will would should could about than then them they who what when "
    "where which while also more most some such only over under after before into onto off own same"
).split())


def _ts(text):
    try:
        return datetime.fromisoformat(str(text).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def words(text):
    """Distinct plain words of a text field, in order of first use."""
    out = []
    for w in WORD_RE.findall(str(text).casefold()):
        if w not in STOPWORDS and w not in out:
            out.append(w)
    return out


def _blank():
    return {"runs": 0, "lastRun": None, "items": {}, "drops": {}, "people": {}, "limits": {}, "skipped": []}


def _filters(p):
    """(type name, type def, setting, field) for every settingFilter of this producer."""
    out = []
    for tname, tdef in sorted(p.defn["types"].items()):
        for flt in tdef.get("settingFilters", []):
            if flt.get("producer") == p.pid and not definition.never_learnable(flt["setting"]):
                out.append((tname, tdef, flt["setting"], flt["field"]))
    return out


def _kept(p, eid):
    return (p.data(f"decisions/{eid}") or {}).get("decision") == "keep"


def _drop(state, setting, value, signal, eid):
    """Count a record once per value, however many runs see it again."""
    entry = state["drops"].setdefault(setting, {}).setdefault(str(value), {"signal": signal, "ids": []})
    if eid not in entry["ids"]:
        entry["ids"] = (entry["ids"] + [eid])[-MAX_DROP_IDS:]


def _listed_words(p, filters, tname, field, role):
    """Casefold words already in a list of this role bound to the same field of the same type."""
    out = set()
    for ftname, _, sname, ffield in filters:
        if ftname == tname and ffield == field and p.roles.get(sname) == role:
            for item in p.settings.get(sname) or []:
                if isinstance(item, str):
                    out.add(item.casefold())
                    out.update(words(item))
    return out


def _people(p, state, filters, tname, values, eid):
    """A record the settings kept: count each word of a text field bound to an exclude list, once per record,
    so _candidates can see which words the records people dropped share."""
    for ftname, tdef, sname, field in filters:
        if ftname != tname or p.roles.get(sname) != "exclude" or tdef["fields"].get(field, {}).get("type") != "text":
            continue
        value = values.get(field)
        if not isinstance(value, str):
            continue
        listed = _listed_words(p, filters, tname, field, "exclude") | _listed_words(p, filters, tname, field, "include")
        for w in words(value):
            if w not in listed:
                entry = state["people"].setdefault(sname, {}).setdefault(w, {"signal": "people_drop", "ids": []})
                if eid not in entry["ids"]:
                    entry["ids"] = (entry["ids"] + [eid])[-MAX_DROP_IDS:]


def _person_dropped(p, eid):
    return (p.data(f"decisions/{eid}") or {}).get("decision") == "drop"


def _count(p, state, inp, cfg):
    """Add one run's observations to the tallies."""
    filters = _filters(p)
    seen = {s: set() for _, _, s, _ in filters}
    aged = set()
    dropped_ids = set()
    for rec in inp.get("records", []):
        tname = rec.get("type")
        if tname not in p.defn["types"]:
            continue
        try:
            eid = p.resolve(tname, p.record_key(rec))[1]
        except dc.ContractError:
            continue
        values = rec.get("values", {})
        if p.drop_reason(tname, values):
            dropped_ids.add(eid)
        else:
            _people(p, state, filters, tname, values, eid)
        dropped = False
        for ftname, tdef, sname, field in filters:
            if ftname != tname:
                continue
            aged.add(sname)
            wanted = p.settings.get(sname) or []
            value = values.get(field)
            if not isinstance(wanted, list) or value in (None, "", []):
                continue
            ftype = tdef["fields"].get(field, {}).get("type")
            hits = [w for w in wanted if dc._matches([w], value, ftype)]
            seen[sname].update(str(h) for h in hits)
            if dropped:
                continue
            role = p.roles.get(sname)
            if role == "exclude" and hits:
                _drop(state, sname, hits[0], "override", eid)
                dropped = True
            elif role == "include" and wanted and not hits:
                if ftype == "text":
                    for w in words(value):
                        _drop(state, sname, w, "uncaptured_term", eid)
                else:
                    for v in (value if isinstance(value, list) else [value]):
                        if isinstance(v, str) and dc.VALUE_RE.match(v):
                            _drop(state, sname, v, "override", eid)
                dropped = True
    for sname in aged:
        items = p.settings.get(sname) or []
        if not isinstance(items, list):
            continue
        prior = state["items"].get(sname, {})
        state["items"][sname] = {str(i): 0 if str(i) in seen[sname] else prior.get(str(i), 0) + 1 for i in items}
    for sname, by_value in list(state["drops"].items()):
        wanted = [str(w).casefold() for w in (p.settings.get(sname) or []) if isinstance(w, str)]
        if p.roles.get(sname) == "exclude":
            by_value = {v: e for v, e in by_value.items() if v.casefold() in wanted}
        else:
            by_value = {v: e for v, e in by_value.items() if v.casefold() not in wanted}
        ranked = sorted(by_value.items(), key=lambda kv: (-sum(_kept(p, i) for i in kv[1]["ids"]), -len(kv[1]["ids"]), kv[0]))
        state["drops"][sname] = dict(ranked[:MAX_DROP_VALUES])
    state.setdefault("people", {})
    for sname, by_word in list(state["people"].items()):
        tf = [(t, f) for t, _, s2, f in filters if s2 == sname]
        listed = set()
        for t, f in tf:
            listed |= _listed_words(p, filters, t, f, "exclude") | _listed_words(p, filters, t, f, "include")
        ranked = sorted(((w, e) for w, e in by_word.items() if w not in listed),
                        key=lambda kv: (-sum(_person_dropped(p, i) for i in kv[1]["ids"]), -len(kv[1]["ids"]), kv[0]))
        state["people"][sname] = dict(ranked[:MAX_DROP_VALUES])
    offered = sum(1 for m in inp.get("inbox", []) if m.get("kind") not in UNCAPPED_KINDS and not _filtered(p, m, dropped_ids))
    for limit in cfg["limits"]:
        cap = p.settings.get(limit)
        if dc._whole(cap):
            hist = [e for e in state["limits"].get(limit, []) if isinstance(e, dict)]
            state["limits"][limit] = (hist + [{"cap": cap, "over": max(0, offered - cap)}])[-MAX_LIMIT_RUNS:]


def _filtered(p, msg, dropped_ids):
    """True for a match message the write contract filters: every record it refers to is dropped."""
    if msg.get("kind") != "match" or not msg.get("refs"):
        return False
    try:
        ids = [p.ref(r)["id"] for r in msg["refs"]]
    except (dc.ContractError, KeyError, TypeError):
        return False
    return all(i in dropped_ids or (p.data(f"entities/{i}") or {}).get("status") == "dropped" for i in ids)


def _candidates(p, state, cfg):
    """(strength, share, proposal, title, why) for every candidate that clears its threshold."""
    out = []
    sdefs = {s["name"]: s for s in p.producer.get("settings", [])}
    for sname, by_value in state["drops"].items():
        exclude = p.roles.get(sname) == "exclude"
        for value, entry in by_value.items():
            ids = entry["ids"]
            kept = [i for i in ids if _kept(p, i)]
            count, of = len(kept), len(ids)
            if count < cfg["minSample"] or count / of < cfg["minEffect"]:
                continue
            op = "remove" if exclude else "add"
            refs = sorted(set(kept))[:MAX_REFS]
            prop = {"setting": sname, "op": op, "value": value, "signal": entry["signal"],
                    "evidence": {"count": count, "of": of, "refs": refs}}
            if exclude:
                title, why = f"Remove {value} from {sname}", f"People kept {count} of {of} records that {value} in {sname} dropped."
            else:
                title = f"Add {value} to {sname}"
                why = f"People kept {count} of {of} records dropped for not matching {sname}; they carry {value}."
            out.append((count, count / of, prop, title, why))
    workers = _worker_sources(p)
    keys = [(s, v) for s, by_word in state.get("people", {}).items() for v in by_word]
    if workers:
        exclude = {s for t, _, s, f in _filters(p) if p.roles.get(s) == "exclude"}
        for _, _, people, _, _ in workers:
            for sname in sorted(people):
                if sname not in exclude or not isinstance(people[sname], dict):
                    continue
                listed = set()
                for t, _, s2, f in _filters(p):
                    if s2 == sname:
                        listed |= _listed_words(p, _filters(p), t, f, "exclude") | _listed_words(p, _filters(p), t, f, "include")
                keys += [(sname, v) for v in sorted(people[sname]) if v not in listed and (sname, v) not in keys]
    for sname, value in keys:
        entry = state.get("people", {}).get(sname, {}).get(value) or {"ids": []}
        ids = list(entry["ids"])
        gone = [i for i in ids if _person_dropped(p, i)]
        sources = [{"source": "owner", "by": dc.owner_of(p.docs), "count": len(gone)}]
        for lk, by, people, handled, joiner_gone in workers:
            by_word = people.get(sname)
            w_entry = by_word.get(value) if isinstance(by_word, dict) else None
            raw_ids = w_entry.get("ids") if isinstance(w_entry, dict) else None
            w_ids = [i for i in raw_ids if isinstance(i, str) and i in handled] if isinstance(raw_ids, list) else []
            w_gone = [i for i in w_ids if i in joiner_gone]
            ids += w_ids
            gone += w_gone
            sources.append({"source": lk, "by": by, "count": len(w_gone)})
        count, of = len(gone), len(ids)
        if not of or count < cfg["minSample"] or count / of < cfg["minEffect"]:
            continue
        prop = {"setting": sname, "op": "add", "value": value, "signal": "people_drop",
                "evidence": {"count": count, "of": of, "refs": sorted(set(gone))[:MAX_REFS]}}
        if workers:
            prop["sources"] = [src for src in sources if src["count"]]
        why = f"People dropped {count} of {of} records whose text carries {value}, which {sname} does not exclude yet."
        out.append((count, count / of, prop, f"Add {value} to {sname}", why))
    for sname, counters in state["items"].items():
        dead = [i for i, n in counters.items() if n >= cfg["deadAfterRuns"]]
        if p.roles.get(sname) == "include" and len(dead) >= len(counters):
            continue
        for item in dead:
            n = counters[item]
            prop = {"setting": sname, "op": "remove", "value": item, "signal": "dead_item", "evidence": {"runs": n}}
            out.append((n, 1.0, prop, f"Remove {item} from {sname}", f"{item} has matched nothing for {n} runs."))
    for limit, entries in state["limits"].items():
        cap, top = p.settings.get(limit), sdefs.get(limit, {}).get("max")
        hist = [e["over"] for e in entries if e["cap"] == cap]
        pressured = [o for o in hist if o > 0]
        if len(pressured) < cfg["minSample"] or len(pressured) / len(hist) < cfg["minEffect"]:
            continue
        new = cap + max(pressured) if top is None else min(top, cap + max(pressured))
        if new <= cap:
            continue
        prop = {"setting": limit, "op": "set", "value": new, "signal": "limit_pressure",
                "evidence": {"count": len(pressured), "of": len(hist), "runs": len(hist)}}
        why = f"{len(pressured)} of the last {len(hist)} runs offered more Inbox messages than {limit} ({cap})."
        out.append((len(pressured), len(pressured) / len(hist), prop, f"Set {limit} to {new}", why))
    return out


def _joiner_signals(docs, lk, by):
    """(handled, gone) item ids from the joiner's own decisions on this lane's gates, read only from
    people/<by>/decisions/. gone is what the joiner rejected. outcomes/ is never evidence: any Contributor
    can write it, whatever its `by` says."""
    handled, gone = set(), set()
    for path in sorted(docs):
        d = (docs[path] or {}).get("data") if isinstance(docs[path], dict) else None
        if not isinstance(d, dict):
            continue
        if path.startswith("pending/"):
            gid = path[len("pending/"):]
            found = dc.WORKER_GATE_ID_RE.match(gid)
            if not found or found.group("lane") != lk or d.get("lane") != lk or not isinstance(d.get("item"), str):
                continue
            decision = dc.accepted_decision(docs, gid, by)
            if decision and decision.get("decision") in ("approve", "reject") and decision.get("item") == d["item"]:
                handled.add(d["item"])
                if decision["decision"] == "reject":
                    gone.add(d["item"])
    return handled, gone


def _worker_sources(p):
    """[(laneKey, by, people tallies, handled, gone)] for every workers/*--learning on a lane that still runs.

    The worker-written tally is never read as evidence: it only marks that the lane learns. Evidence is
    rebuilt from trusted data: the joiner's own gate decisions (people/<by>/decisions/) name the handled items, each
    must be an entity the lane was offered (its match rule on the join card), and its words come from
    that entity's own display. A lane that is stopped (left, released, held by someone else), is not on
    the card, or whose documents are malformed feeds nothing."""
    out = []
    card = p.data("meta/join")
    if not isinstance(card, dict) or not isinstance(card.get("lanes"), list):
        return out
    filters = _filters(p)
    for path in sorted(p.docs):
        if not (path.startswith("workers/") and path.endswith("--learning")):
            continue
        lk = path[len("workers/"):-len("--learning")]
        w = p.data(f"workers/{lk}")
        if not worker_kinds.LANE_KEY_RE.match(lk) or not isinstance(w, dict) or not isinstance(p.data(path), dict):
            continue
        by, params = w.get("by"), w.get("params")
        if not isinstance(by, str) or not by or not isinstance(params, dict):
            continue
        if dc.lane_stop_reason(p.docs, lk, by):
            continue
        try:
            lane = join_card.lane_by_id(card, w.get("lane"))
            if not isinstance(lane, dict) or dc.lane_key(lane["id"], params) != lk:
                continue
            handled, gone = _joiner_signals(p.docs, lk, by)
            offered = {i for i in handled if join_card.matches(lane, params, p.data(f"entities/{i}"))}
        except (KeyError, TypeError, AttributeError, ValueError):
            continue
        state = {"people": {}}
        for eid in sorted(offered):
            ent = p.data(f"entities/{eid}")
            if isinstance(ent.get("display"), dict):
                _people(p, state, filters, ent.get("type"), ent["display"], eid)
        out.append((lk, by, state["people"], offered, gone & offered))
    return out


def plan_worker_learning(card, docs, lane_key, by, worker_input):
    """The workers/<laneKey>--learning document: the same shape as state/learning, tallied only from
    the joiner's own signals on this lane. None when the Desk has no definition or no producer learns.
    Raises dc.LaneStopped when this worker no longer serves the lane."""
    reason = dc.lane_stop_reason(docs, lane_key, by)
    if reason:
        raise dc.LaneStopped(reason)
    defn = (docs.get("meta/definition") or {}).get("data")
    if not isinstance(defn, dict):
        return None
    w, lane, params = dc._worker_lane(card, docs, lane_key)
    run_id = worker_input.get("runId")
    if not isinstance(run_id, str) or not dc.RUN_ID_RE.match(run_id):
        raise dc.ContractError(f"runId {run_id!r} must be lowercase letters and digits joined by single hyphens")
    prior = ((docs.get(f"workers/{lane_key}--learning") or {}).get("data") or {}).get("producers") or {}
    handled, _ = _joiner_signals(docs, lane_key, by)
    doc = {"schema": 1, "producers": {}}
    for producer in defn.get("producers", []):
        if not (producer.get("learning") or {}).get("enabled"):
            continue
        pid = producer["id"]
        p = dc._Plan(defn, docs, {"producer": pid, "runId": run_id, "startedAt": worker_input.get("startedAt")})
        state = _blank()
        before = prior.get(pid) if isinstance(prior.get(pid), dict) else {}
        state["runs"] = before.get("runs", 0) if dc._whole(before.get("runs", 0)) else 0
        state["lastRun"] = before.get("lastRun")
        if state["lastRun"] != run_id:
            state["runs"] += 1
            state["lastRun"] = run_id
        filters = _filters(p)
        for eid in sorted(handled):
            ent = p.data(f"entities/{eid}")
            if join_card.matches(lane, params, ent) and isinstance(ent.get("display"), dict):
                _people(p, state, filters, ent.get("type"), ent["display"], eid)
        for sname, by_word in list(state["people"].items()):
            ranked = sorted(by_word.items(), key=lambda kv: (-len(kv[1]["ids"]), kv[0]))
            state["people"][sname] = dict(ranked[:MAX_DROP_VALUES])
        doc["producers"][pid] = state
    return doc if doc["producers"] else None


def _blocked(p, cfg, now):
    """Keys people rejected within the cooldown, snoozed (until passes, or for good without one), or that
    wait undecided on an earlier run's card, however old. This run's own cards never block, so a retried
    write still accepts the proposals it raised."""
    cooldown = cfg["cooldownDays"] * DAY
    keys = set()
    for path, doc in p.docs.items():
        data = doc.get("data") or {}
        key = (data.get("proposal") or {}).get("key") if isinstance(data.get("proposal"), dict) else None
        if not path.startswith("inbox/") or data.get("producer") != p.pid or not key or data.get("run") == p.run_id:
            continue
        decision = p.data("decisions/" + path[len("inbox/"):]) or {}
        verdict, at = decision.get("decision"), _ts(decision.get("at"))
        if verdict in REJECTED and (at is None or now - at < cooldown):
            keys.add(key)
        elif verdict == "snooze" and (_ts(decision.get("until")) or now + 1) > now:
            keys.add(key)
        elif verdict is None:
            keys.add(key)
    return keys


def plan_learning(defn, docs, run_input):
    """(state/learning data, proposal messages); (None, []) when the routine does not learn."""
    p = dc._Plan(defn, docs, run_input)
    cfg = p.producer.get("learning")
    if not cfg or not cfg.get("enabled"):
        return None, []
    doc = copy.deepcopy(p.data("state/learning") or {"schema": 1, "producers": {}})
    state = doc["producers"].setdefault(p.pid, _blank())
    if state.get("lastRun") != p.run_id:
        _count(p, state, run_input, cfg)
        state["runs"] += 1
        state["lastRun"] = p.run_id
    state["skipped"] = []
    state.pop("proposed", None)
    if (p.data("settings/workspace") or {}).get("values", {}).get("learning") is False:
        return doc, []
    now = _ts(p.at)
    if now is None:
        raise dc.ContractError("run input needs startedAt or endedAt as an ISO time for learning")
    blocked = _blocked(p, cfg, now)
    messages = []
    ranked = sorted(_candidates(p, state, cfg), key=lambda c: (-c[0], -c[1], c[2]["setting"], str(c[2]["value"])))
    for _, _, prop, title, why in ranked:
        if len(messages) >= cfg["maxPerRun"]:
            break
        key = dc.proposal_key(prop["setting"], prop["op"], prop["value"])
        if not cfg["signals"].get(prop["signal"], False) or key in blocked:
            continue
        try:
            dc.check_proposal(prop, p.producer, p.settings)
        except dc.ContractError as exc:
            state["skipped"].append({"key": key, "reason": str(exc)})
            continue
        messages.append({"kind": "proposal", "title": title, "why": why, "proposal": prop})
    return doc, messages
