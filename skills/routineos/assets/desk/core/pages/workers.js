// core/pages/workers.js: the Workers view (spec "Workers view"). One row per lane on the Desk's join card: the
// label, who serves it, last run and health, items waiting and items done. An unserved lane says how to get it
// served. The owner (meta/owner) can release a served lane and sees the open and cap settings. The pure helpers
// the Approvals page uses (canApproveGate, sourceLine) live in shared.js; this file re-exports them.
// Names come from store.profiles(ids) and appear only when the Desk has more than one writer; an id or an email
// is never shown.
export var UNSERVED_NOTE = "Nobody serves this lane yet. Share this Desk and ask them to say: join this Desk.";
export var WORKER_DOC_SUFFIXES_ = ["--health", "--budget", "--learning"];
export var DONE_OUTCOMES_ = ["drafted", "sent"];

// Missing params render as <name>, so a label never shows a raw placeholder.
export function fillLabel(label, params) {
  params = params && typeof params === "object" ? params : {};
  return String(label || "").replace(/\{([^{}]*)\}/g, function (m, name) {
    return Object.prototype.hasOwnProperty.call(params, name) && typeof params[name] === "string" ? params[name] : "<" + name + ">";
  });
}

export function rowsById_(docs) {
  var out = Object.create(null);
  (docs || []).forEach(function (d) { if (d && d.data && typeof d.data === "object") out[d.id] = d.data; });
  return out;
}

export function isWorkerMain_(id) {
  return typeof id === "string" && id.indexOf("--") > 0 && !WORKER_DOC_SUFFIXES_.some(function (s) {
    return id.slice(-s.length) === s;
  });
}

export function cardLane_(card, laneId) {
  return ((card && card.lanes) || []).filter(function (l) { return l && l.id === laneId; })[0] || null;
}

// Mirrors join_card.matches: the lane's match type, not dropped, display[field] equals the filled template
// (case-insensitive when a placeholder is an email param).
export function laneMatches_(lane, params, entity) {
  var m = lane && lane.match;
  if (!m || !entity || entity.type !== m.type || entity.status === "dropped") return false;
  var display = entity.display;
  if (!display || typeof display !== "object" || !(m.field in display) || display[m.field] === null || display[m.field] === undefined) return false;
  var want = String(m.equals).replace(/\{([^{}]*)\}/g, function (all, n) {
    return Object.prototype.hasOwnProperty.call(params, n) ? String(params[n]) : all;
  });
  var declared = lane.params || {};
  var email = (String(m.equals).match(/\{([^{}]*)\}/g) || []).some(function (p) {
    return (declared[p.slice(1, -1)] || {}).type === "email";
  });
  var got = String(display[m.field]);
  return email ? got.trim().toLowerCase() === want.trim().toLowerCase() : got === want;
}

// The worker no longer serves the lane, as desk_contract.released: it left, its joinedAt is missing or malformed, or
// the owner released it. A release naming a holder is final for that holder; one without compares times.
export var JOINED_AT_RE_ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
export function releasedOrLeft_(w, lk, decisions, ownerBy) {
  if (w.status === "left") return true;
  if (typeof w.joinedAt !== "string" || !JOINED_AT_RE_.test(w.joinedAt)) return true;
  var rel = (decisions || {})["release--" + lk];
  if (!(ownerBy && rel && rel.by === ownerBy)) return false;
  if ("holder" in rel) return rel.holder === w.by;
  return typeof rel.at === "string" && rel.at > w.joinedAt;
}

// people/<owner id>/decisions: the only place a release counts (the db rules let only the owner write it). null when
// the owner id is not a safe path segment, so no release is read at all.
export var PERSON_ID_RE_ = /^[A-Za-z0-9_-]{1,64}$/;
export function ownerDecisions_(ownerBy) {
  return typeof ownerBy === "string" && PERSON_ID_RE_.test(ownerBy) ? "people/" + ownerBy + "/decisions" : null;
}

export var OWNER_TAMPERED_NOTE = "This Desk's owner record does not match its owner, so owner-only controls and lane releases are off. The owner can republish the Desk to fix it.";

// One row per served lane key, plus one per card lane with no active worker. opts: {decisions, ownerBy}.
export function laneRows(card, workers, outcomes, pending, entities, opts) {
  opts = opts || {};
  var docs = rowsById_(workers);
  var decisions = rowsById_(opts.decisions);
  var served = [];
  Object.keys(docs).sort().forEach(function (lk) {
    var w = docs[lk];
    if (!isWorkerMain_(lk) || !w.params || typeof w.params !== "object") return;
    var lane = cardLane_(card, w.lane);
    if (!lane || releasedOrLeft_(w, lk, decisions, opts.ownerBy)) return;
    var handled = Object.create(null);
    var done = 0;
    (outcomes || []).forEach(function (o) {
      var d = o && o.data;
      if (!d || d.lane !== lk || typeof d.item !== "string" || o.id !== d.item + "--" + lk) return;
      handled[d.item] = true;
      if (DONE_OUTCOMES_.indexOf(d.status) !== -1) done++;
    });
    var waiting = (entities || []).filter(function (e) {
      return e && e.data && !handled[e.id] && laneMatches_(lane, w.params, e.data);
    }).length;
    var health = docs[lk + "--health"] || {};
    var gates = (pending || []).filter(function (g) { return g && g.data && g.data.lane === lk && (g.data.status || "pending") === "pending"; }).length;
    served.push({ laneId: lane.id, label: fillLabel(lane.label, w.params), laneKey: lk, served: true, by: typeof w.by === "string" ? w.by : null,
      lastRun: typeof health.runAt === "string" ? health.runAt : null, health: typeof health.outcome === "string" ? health.outcome : null,
      waiting: waiting, done: done, gates: gates });
  });
  var out = [];
  ((card && card.lanes) || []).forEach(function (lane) {
    var mine = served.filter(function (r) { return r.laneId === lane.id; });
    if (mine.length) out = out.concat(mine);
    else out.push({ laneId: lane.id, label: fillLabel(lane.label, {}), laneKey: null, served: false, by: null,
      lastRun: null, health: null, waiting: 0, done: 0, gates: 0 });
  });
  return out;
}

// The people who write to this Desk: the owner and every serving worker.
export function deskWriters(ownerBy, rows) {
  var set = {};
  if (ownerBy) set[ownerBy] = true;
  (rows || []).forEach(function (r) { if (r.served && r.by) set[r.by] = true; });
  return Object.keys(set).length;
}

export { GATE_WORKER_NOTE, canApproveGate, sourceLine } from "../shared.js";
