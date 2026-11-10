// core/requests.js: every request the routine is waiting on a person for, by kind, in one list (spec 5.3).
// A producer gate is Waiting until decisions/<id> exists, Queued until a run of its producer starts after the
// decision, then Done; a run's processed report (contract 7a) says whether it was applied. A worker gate's decision
// lives at people/<viewer>/decisions/<id> and is never Queued. Proposals, proposed views and columns are Done the
// moment they are decided. Record decisions (decisions/<entityId>) are not requests and are never read here.
import { human } from "./dates.js";

export var REQUEST_GROUP = { gate: "gates", "worker-gate": "gates", "proposal-l1": "proposals", "proposal-l23": "proposals",
  view: "views", column: "views" };
export var NO_REPORT_NOTE = "The routine did not report on this request.";
export var PR_NOTE = "Changes the routine's code through a pull request";
export var NEXT_RUN_NOTE = "Saved. Applies from the next run.";
export var GATE_NOTE = "Recorded here. A later run acting on it is not piloted.";

export function reqWhen_(iso, now) {
  return typeof human === "function" ? human(iso, now, { style: "sentence" }) : String(iso || "");
}

export function reqTime_(iso) {
  var t = Date.parse(iso || "");
  return isNaN(t) ? null : t;
}

// The summary-phase run docs of producer p: run ids are <producer>-<date>.
export function runsOf(runs, p) {
  return (runs || []).filter(function (r) { return p && r.id.indexOf(p + "-") === 0 && r.data; });
}

// The newest run of producer p started after the decision time at (ms) that lists request id in processed, as
// {run, entry}, or null. A run that started before the decision cannot have acted on it.
export function processedIn_(runs, p, id, at) {
  var found = null;
  runsOf(runs, p).forEach(function (r) {
    var t = reqTime_(r.data.startedAt);
    if (at === null || t === null || t <= at) return;
    (Array.isArray(r.data.processed) ? r.data.processed : []).forEach(function (e) {
      if (e && e.request === id && (!found || (r.data.startedAt || "") > (found.run.data.startedAt || ""))) found = { run: r, entry: e };
    });
  });
  return found;
}

// The first run of producer p that started after time at (ms), or null.
export function runAfter_(runs, p, at) {
  var first = null;
  runsOf(runs, p).forEach(function (r) {
    var t = reqTime_(r.data.startedAt);
    if (t !== null && at !== null && t > at && (!first || t < reqTime_(first.data.startedAt))) first = r;
  });
  return first;
}

export function reportOutcome_(found) {
  var e = found.entry, runId = found.run.id;
  if (e.outcome === "applied") return { key: "applied", text: "Applied in run " + runId, runId: runId, result: e.result || "" };
  return { key: "not_applied", text: "Not applied in run " + runId + (e.reason ? ": " + e.reason : ""), runId: runId };
}

// A snooze holds until its until passes; one without until holds for good, as the routine's rejection memory reads it.
export function snoozedNow(dec, now) {
  return !!dec && dec.decision === "snooze" && (!dec.until || Date.parse(dec.until) > now);
}

export function proposalOutcome_(dec, now) {
  if (dec.decision === "accept") return { key: "accept", text: "Applied to settings " + reqWhen_(dec.at, now) };
  if (dec.decision === "snooze") return { key: "snooze", text: dec.until ? "Snoozed until " + reqWhen_(dec.until, now) : "Snoozed" };
  return { key: dec.decision, text: { dismiss: "Dismissed", reject: "Rejected" }[dec.decision] || "Decided " + reqWhen_(dec.at, now) };
}

// src: {pending, inbox, views, columns, decisions, personDecisions, runs, workersByKey?}, each a list of {id, data}.
// personDecisions are the viewer's own people/<viewer>/decisions/. now in ms.
export function deriveRequests(src, viewer, now) {
  src = src || {};
  if (now === undefined) now = Date.now();
  // Keyed by document id, so no prototype: an id like "constructor" must not find a built-in.
  var shared = Object.create(null), mine = Object.create(null), out = [], folded = Object.create(null);
  (src.decisions || []).forEach(function (d) { shared[d.id] = d.data; });
  (src.personDecisions || []).forEach(function (d) { mine[d.id] = d.data; });
  var runs = src.runs || [];
  (src.inbox || []).forEach(function (m) {
    if (m.data && m.data.kind === "approval" && m.data.gate) folded[m.data.gate] = m;
  });

  (src.pending || []).forEach(function (g) {
    var gate = g.data || {}, msg = folded[g.id], md = (msg && msg.data) || {};
    var lane = gate.lane, producer = gate.producer || md.producer || "";
    var created = gate.createdAt || md.createdAt || "";
    var hours = Number(gate.timeoutHours);
    var r = {
      id: g.id, kind: lane ? "worker-gate" : "gate", group: "gates", state: "waiting", producer: producer,
      title: md.title || gate.title || (gate.draft && gate.draft.subject) || "Approval", why: md.why || gate.why || "",
      refs: md.refs || gate.refs || [], createdAt: created, gate: gate, message: msg ? msg.id : null,
      decisionPath: lane ? "people/" + viewer + "/decisions/" + g.id : "decisions/" + g.id, canUndo: false,
    };
    // A deadline only for a sane count of hours (up to a year); anything else shows none rather than Invalid Date.
    if (isFinite(hours) && hours > 0 && hours <= 8760 && reqTime_(created) !== null) r.timeoutAt = new Date(reqTime_(created) + hours * 3600000).toISOString();
    var dec = null;
    if (lane) {
      var w = (src.workersByKey || null), m = mine[g.id];
      if (m && viewer && m.by === viewer && (!w || (w[lane] && w[lane].by === viewer))) dec = m;
    } else dec = shared[g.id] || null;
    if (!dec) {
      var status = gate.status || "pending";
      if (status !== "pending") {
        r.state = "done";
        r.outcome = { key: status, text: status === "expired" ? "Timed out" : "Closed: " + status };
      } else if (r.timeoutAt && reqTime_(r.timeoutAt) <= now) {
        r.state = "done";
        r.outcome = { key: "expired", text: "Timed out " + reqWhen_(r.timeoutAt, now) };
      }
      out.push(r);
      return;
    }
    r.decision = dec;
    r.state = "done";
    if (lane) {
      r.outcome = { key: "decided", text: "Decided " + reqWhen_(dec.at, now) };
      out.push(r);
      return;
    }
    var found = processedIn_(runs, producer, g.id, reqTime_(dec.at));
    var later = runAfter_(runs, producer, reqTime_(dec.at));
    if (found) r.outcome = reportOutcome_(found);
    else if (later) r.outcome = { key: "unreported", text: "Decided " + reqWhen_(dec.at, now) + ". " + NO_REPORT_NOTE, runId: later.id };
    else { r.state = "queued"; r.canUndo = true; }
    out.push(r);
  });

  (src.inbox || []).forEach(function (m) {
    var d = m.data || {};
    if (d.kind !== "proposal") return;
    var p = d.proposal && typeof d.proposal === "object" ? d.proposal : {};
    var level = p.level || "L1";
    var r = {
      id: m.id, kind: level === "L1" ? "proposal-l1" : "proposal-l23", group: "proposals", state: "waiting",
      producer: d.producer || "", title: d.title || "Proposal", why: d.why || "", refs: d.refs || [],
      createdAt: d.createdAt || "", level: level, proposal: p, message: m.id,
      decisionPath: "decisions/" + m.id, canUndo: false,
    };
    if (level !== "L1") r.note = PR_NOTE;
    var dec = shared[m.id] || null;
    if (dec && !(dec.decision === "snooze" && !snoozedNow(dec, now))) {
      r.decision = dec;
      r.state = "done";
      r.outcome = proposalOutcome_(dec, now);
      var found = dec.decision === "accept" ? processedIn_(runs, r.producer, m.id, reqTime_(dec.at)) : null;
      if (found) r.outcome = reportOutcome_(found);
    }
    out.push(r);
  });

  [["views", "view"], ["columns", "column"]].forEach(function (pair) {
    (src[pair[0]] || []).forEach(function (v) {
      var d = v.data || {};
      var agent = d.madeBy === "agent" || (d.producer && d.madeBy !== "human");
      if (!agent || (d.state !== "proposed" && !(d.state === "kept" && d.updatedBy))) return;
      var path = "decisions/" + pair[0] + "--" + v.id;
      var r = {
        id: pair[0] + "--" + v.id, docId: v.id, kind: pair[1], group: "views", state: "waiting", producer: d.producer || "",
        title: (pair[1] === "view" ? "Proposed view: " : "Proposed column: ") + (d.name || v.id), why: d.why || "",
        refs: [], createdAt: d.createdAt || "", doc: d, decisionPath: path, canUndo: false,
      };
      var dec = shared[pair[0] + "--" + v.id] || null;
      if (d.state === "kept") {
        r.state = "done";
        r.decision = { decision: "keep", at: d.updatedAt, by: d.updatedBy };
        r.outcome = { key: "keep", text: "Kept" };
      } else if (dec) {
        r.state = "done";
        r.decision = dec;
        r.outcome = { key: dec.decision, text: dec.decision === "archive" ? "Archived" : "Decided " + reqWhen_(dec.at, now) };
      }
      out.push(r);
    });
  });

  var timeoutOf = function (r) { var t = reqTime_(r.timeoutAt); return t === null ? Infinity : t; };
  var decidedAt = function (r) { return (r.decision && r.decision.at) || r.createdAt || ""; };
  out.sort(function (a, b) {
    var rank = { waiting: 0, queued: 1, done: 2 };
    if (a.state !== b.state) return rank[a.state] - rank[b.state];
    if (a.state === "waiting") {
      return timeoutOf(a) - timeoutOf(b) || (a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : (a.createdAt < b.createdAt ? 1 : -1));
    }
    var x = decidedAt(a), y = decidedAt(b);
    return x === y ? (a.id < b.id ? -1 : 1) : (x < y ? 1 : -1);
  });
  return out;
}

// One line for a gate: how it travels, when it times out, how it ended.
export function gateLine(gate) {
  if (!gate) return "";
  var line = "Gate by " + (gate.transport || "an unknown transport");
  if (gate.outcome) return line + ", " + (gate.status || "closed") + ": " + gate.outcome + ".";
  return line + (gate.timeoutHours ? ", times out after " + gate.timeoutHours + " hours." : ".");
}

export function suggestionLevel(p) {
  return p && typeof p === "object" && p.level ? p.level : "L1";
}

export function levelLabel(p) {
  var level = suggestionLevel(p);
  if (level === "L1") return "L1 setting";
  return level + " " + (p.target || (level === "L2" ? "definition" : "workflow")) + ", opens a PR";
}

export function itemLine(p) {
  p = p && typeof p === "object" ? p : {};
  if (suggestionLevel(p) !== "L1") return String(p.change || "");
  if (p.op === "add") return "Add " + p.value + " to " + p.setting;
  if (p.op === "remove") return "Remove " + p.value + " from " + p.setting;
  if (p.op === "set") return "Set " + p.setting + " to " + p.value;
  var from = "from" in p ? p.from : p.current, to = "to" in p ? p.to : p.suggested;
  if (Array.isArray(from) && Array.isArray(to)) {
    var add = to.filter(function (x) { return from.indexOf(x) === -1; }), drop = from.filter(function (x) { return to.indexOf(x) === -1; });
    if (add.length && !drop.length) return "Add " + add.join(", ") + " to " + p.setting;
    if (drop.length && !add.length) return "Remove " + drop.join(", ") + " from " + p.setting;
    if (add.length) return "Add " + add.join(", ") + " and remove " + drop.join(", ") + " in " + p.setting;
  }
  var plain = function (v) { return v !== null && typeof v === "object" ? JSON.stringify(v) : String(v); };
  return "Set " + p.setting + " to " + plain(to) + (from !== undefined && (from === null || typeof from !== "object") ? " (was " + plain(from) + ")" : "");
}

// count of `of` is kept records; with runs it is runs under pressure; runs alone is a dead item's quiet streak.
export function evidenceLine(e) {
  if (!e || typeof e !== "object") return "";
  var refs = (e.refs || []).length;
  if (e.count !== undefined && e.of !== undefined && e.runs !== undefined) return e.count + " of the last " + e.runs + " runs";
  if (e.count !== undefined && e.of !== undefined) return "Kept " + e.count + " of " + e.of + (refs ? ", " + refs + " records linked" : "");
  if (e.runs !== undefined) return "No match for " + e.runs + " runs";
  return "";
}

// Undo is safe only while no run of the producer has started since the decision or reported on it.
export function undoable(request, runs) {
  if (!request || request.kind !== "gate" || !request.decision) return { ok: true };
  var found = processedIn_(runs, request.producer, request.id, reqTime_(request.decision.at));
  if (found) return { ok: false, runId: found.run.id };
  var later = runAfter_(runs, request.producer, reqTime_(request.decision.at));
  return later ? { ok: false, runId: later.id } : { ok: true };
}

export function requestsIn(list, state, group) {
  return (list || []).filter(function (r) { return r.state === state && (!group || group === "all" || r.group === group); });
}
