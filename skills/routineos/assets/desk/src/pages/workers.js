/* src/pages/workers.js: the Workers view (spec "Workers view"). One row per lane on the Desk's join card: the
   label, who serves it, last run and health, items waiting and items done. An unserved lane says how to get it
   served. The owner (meta/owner) can release a served lane and sees the open and cap settings. Also the pure
   helpers the Approvals and Suggestions pages use: canApproveGate and sourceLine.
   Names come from store.profiles(ids) and appear only when the Desk has more than one writer; an id or an email
   is never shown. */

var UNSERVED_NOTE = "Nobody serves this lane yet. Share this Desk and ask them to say: join this Desk.";
var GATE_WORKER_NOTE = "Only the person who serves this lane can approve it.";
var WORKER_DOC_SUFFIXES_ = ["--health", "--budget", "--learning"];
var DONE_OUTCOMES_ = ["drafted", "sent"];
var LANE_ID_TEXT_RE_ = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

// Missing params render as <name>, so a label never shows a raw placeholder.
function fillLabel(label, params) {
  params = params && typeof params === "object" ? params : {};
  return String(label || "").replace(/\{([^{}]*)\}/g, function (m, name) {
    return Object.prototype.hasOwnProperty.call(params, name) && typeof params[name] === "string" ? params[name] : "<" + name + ">";
  });
}

function rowsById_(docs) {
  var out = Object.create(null);
  (docs || []).forEach(function (d) { if (d && d.data && typeof d.data === "object") out[d.id] = d.data; });
  return out;
}

function isWorkerMain_(id) {
  return typeof id === "string" && id.indexOf("--") > 0 && !WORKER_DOC_SUFFIXES_.some(function (s) {
    return id.slice(-s.length) === s;
  });
}

function cardLane_(card, laneId) {
  return ((card && card.lanes) || []).filter(function (l) { return l && l.id === laneId; })[0] || null;
}

// Mirrors join_card.matches: the lane's match type, not dropped, display[field] equals the filled template
// (case-insensitive when a placeholder is an email param).
function laneMatches_(lane, params, entity) {
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
var JOINED_AT_RE_ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
function releasedOrLeft_(w, lk, decisions, ownerBy) {
  if (w.status === "left") return true;
  if (typeof w.joinedAt !== "string" || !JOINED_AT_RE_.test(w.joinedAt)) return true;
  var rel = (decisions || {})["release--" + lk];
  if (!(ownerBy && rel && rel.by === ownerBy)) return false;
  if ("holder" in rel) return rel.holder === w.by;
  return typeof rel.at === "string" && rel.at > w.joinedAt;
}

// people/<owner id>/decisions: the only place a release counts (the db rules let only the owner write it). null when
// the owner id is not a safe path segment, so no release is read at all.
var PERSON_ID_RE_ = /^[A-Za-z0-9_-]{1,64}$/;
function ownerDecisions_(ownerBy) {
  return typeof ownerBy === "string" && PERSON_ID_RE_.test(ownerBy) ? "people/" + ownerBy + "/decisions" : null;
}

var OWNER_TAMPERED_NOTE = "This Desk's owner record does not match its owner, so owner-only controls and lane releases are off. The owner can republish the Desk to fix it.";

// One row per served lane key, plus one per card lane with no active worker. opts: {decisions, ownerBy}.
function laneRows(card, workers, outcomes, pending, entities, opts) {
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

// Gates without a lane keep today's behavior. A worker gate is approved only by the worker serving that lane.
function canApproveGate(gate, workersByKey, viewer) {
  if (!gate || !gate.lane) return { ok: true, reason: "" };
  var w = workersByKey && Object.prototype.hasOwnProperty.call(workersByKey, gate.lane) ? workersByKey[gate.lane] : null;
  var ok = !!viewer && !!w && w.status !== "left" && w.by === viewer;
  return { ok: ok, reason: ok ? "" : GATE_WORKER_NOTE };
}

// A display name for a person: "you" for the viewer, the profile name, else "someone". Never an id or an email.
function personName_(profiles, id, viewer) {
  if (id && id === viewer) return "you";
  var p = profiles && id && Object.prototype.hasOwnProperty.call(profiles, id) ? profiles[id] : null;
  var name = p && typeof p.name === "string" ? p.name.trim() : "";
  return name && name.indexOf("@") === -1 && !/[\x00-\x1f\x7f]/.test(name) ? name : "someone";
}

function laneIdOf_(laneKey) {
  var id = String(laneKey).split("--")[0];
  return LANE_ID_TEXT_RE_.test(id) ? id : "a";
}

function joinWords_(parts) {
  if (parts.length < 2) return parts.join("");
  return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
}

// "From 7 decisions by you and 5 by Alex Rivera (sender lane)". Names only when more than one person wrote.
function sourceLine(sources, profiles, ownerBy, viewer) {
  if (!Array.isArray(sources)) return "";
  var good = sources.filter(function (s) {
    return s && typeof s === "object" && typeof s.source === "string" && typeof s.count === "number" && s.count > 0 && s.count % 1 === 0;
  });
  if (!good.length) return "";
  var people = {};
  if (ownerBy) people[ownerBy] = true;
  good.forEach(function (s) { if (typeof s.by === "string" && s.by) people[s.by] = true; });
  var named = Object.keys(people).length > 1;
  return "From " + joinWords_(good.map(function (s, i) {
    return s.count + (i === 0 ? (s.count === 1 ? " decision" : " decisions") : "") +
      (named ? " by " + personName_(profiles, s.by, viewer) : "") +
      (s.source === "owner" ? "" : " (" + laneIdOf_(s.source) + " lane)");
  }));
}

// The people who write to this Desk: the owner and every serving worker.
function deskWriters(ownerBy, rows) {
  var set = {};
  if (ownerBy) set[ownerBy] = true;
  (rows || []).forEach(function (r) { if (r.served && r.by) set[r.by] = true; });
  return Object.keys(set).length;
}

function copyLink_(url, status) {
  var clip = globalThis.navigator && globalThis.navigator.clipboard;
  if (!clip || typeof clip.writeText !== "function") { status.textContent = "Copy is not available here. The link: " + url; return; }
  clip.writeText(url).then(function () { status.textContent = "Link copied."; }, function () { status.textContent = "Not copied. The link: " + url; });
}

// The viewer's own Desk id (user.id()), never anyone else's: a routine cannot learn it, so join, leave and the
// worker take it as --by from here.
function yourIdLine_(ctx) {
  if (!ctx.viewer) return null;
  var id = String(ctx.viewer);
  var status = el("span", { class: "status", role: "status" });
  return el("p", { class: "muted" }, "Your Desk id: " + id + " (give it when you join or leave). ",
    button("Copy id", function () {
      var clip = globalThis.navigator && globalThis.navigator.clipboard;
      if (!clip || typeof clip.writeText !== "function") { status.textContent = "Copy is not available here."; return; }
      clip.writeText(id).then(function () { status.textContent = "Id copied."; }, function () { status.textContent = "Not copied."; });
    }), status);
}

// view: {profiles, writers}. A name shows only with more than one writer.
function laneRow(ctx, row, view) {
  view = view || {};
  var status = el("span", { class: "status", role: "status" });
  var url = ctx.join && typeof ctx.join.url === "string" && /^https:\/\//.test(ctx.join.url) ? ctx.join.url : null;
  if (!row.served) {
    return el("li", { class: "item", "data-lane": row.laneId },
      el("div", { class: "item-head" }, badge("Unserved", "warn"), " ", row.label),
      el("p", { class: "muted" }, UNSERVED_NOTE),
      url ? el("div", { class: "actions" }, button("Copy link", function () { copyLink_(url, status); }), status) : null);
  }
  var who = (view.writers || 0) > 1 && row.by ? personName_(view.profiles, row.by, ctx.viewer) : "";
  var tone = row.health === "ok" ? "ok" : row.health ? "warn" : null;
  return el("li", { class: "item", "data-lane": row.laneId },
    el("div", { class: "item-head" }, badge(row.health || "No run yet", tone), " ", row.label),
    el("p", { class: "muted" }, who ? "Served by " + who + ". " : "", row.lastRun ? "Last run " + when(row.lastRun) + ". " : "No run yet. ",
      row.waiting + " waiting, " + row.done + " done" + (row.gates ? ", " + row.gates + " to approve" : "") + "."),
    isDeskOwner(ctx) ? el("details", null, el("summary", null, "Release"), el("p", null, RELEASE_ASK),
      el("div", { class: "actions" }, actionButton(ctx, "Release this lane", function () {
        return releaseLane(ctx, row.laneKey, function () { return true; }, row.by).then(function (ok) { if (!ok) throw new Error("the lane was not released"); });
      }, { status: status, done: "Released. The worker's next run stops." }), status)) : null);
}

// Owner only: the open and cap settings, and how to change them (the Desk does not edit definition.json).
function ownerSettings_(card) {
  var cap = card.cap || {};
  var scope = cap.scope === "desk" ? "for the whole Desk" : "per account";
  return el("section", null, el("h2", null, "Join settings"),
    el("ul", { class: "rows" },
      el("li", null, "Open to join: " + (card.open ? "yes" : "no")),
      el("li", null, "Daily cap: " + (cap.maxRunsPerDay || 1) + " runs a day " + scope)),
    el("p", { class: "muted" }, "To open or close the Desk, ask in a session to run join-settings. To change the cap, ask for a change to the Desk definition."));
}

function renderWorkers(outlet, ctx) {
  var box = el("div", { class: "page" }, el("h1", null, "Workers"), stateView("loading", { label: "workers" }));
  append(outlet, box);
  var card = ctx.join;
  if (!card || !Array.isArray(card.lanes)) {
    clear(box);
    append(box, [el("h1", null, "Workers"), el("p", { class: "muted" }, "This Desk is not set up for others to join.")]);
    return null;
  }
  var live = true, entities = null, got = null, profiles = {}, asked = {};
  function fail() {
    if (!live) return;
    clear(box);
    append(box, [el("h1", null, "Workers"), stateView("read-error", { collection: "workers", onRetry: ctx.retry })]);
  }
  function draw() {
    if (!live || !got || !entities) return;
    var ownerBy = ctx.owner && ctx.owner.by;
    var rows = laneRows(card, got.workers, got.outcomes, got.pending, entities, { decisions: got.released, ownerBy: ownerBy });
    var writers = deskWriters(ownerBy, rows);
    clear(box);
    append(box, [el("h1", null, "Workers"),
      el("p", { class: "muted" }, "Each lane is served by one person's own routine. Their gates wait for them in Approvals."),
      yourIdLine_(ctx),
      ctx.ownerTampered ? el("p", { class: "muted", role: "status" }, OWNER_TAMPERED_NOTE) : null,
      el("ul", { class: "items" }, rows.map(function (r) { return laneRow(ctx, r, { profiles: profiles, writers: writers }); })),
      isDeskOwner(ctx) ? ownerSettings_(card) : null]);
    var ids = rows.map(function (r) { return r.by; }).filter(function (id) { return id && !asked[id]; });
    if (writers > 1 && ids.length && ctx.store.profiles) {
      ids.forEach(function (id) { asked[id] = true; });
      ctx.store.profiles(ids).then(function (p) { Object.assign(profiles, p || {}); draw(); }, function () {});
    }
  }
  var types = card.lanes.map(function (l) { return l && l.match && l.match.type; })
    .filter(function (t, i, a) { return typeof t === "string" && a.indexOf(t) === i; });
  Promise.all(types.map(function (t) { return fullRead(ctx.store, "entities", { where: [["type", "==", t]] }); })).then(function (lists) {
    entities = [].concat.apply([], lists);
    draw();
  }, fail);
  var specs = { workers: { collection: "workers" }, outcomes: { collection: "outcomes" }, pending: { collection: "pending" } };
  var released = ownerDecisions_(ctx.owner && ctx.owner.by);
  if (released) specs.released = { collection: released };
  var stop = watchAll(ctx, specs, function (g) { got = g; draw(); }, fail);
  return function () { live = false; stop(); };
}

if (typeof module === "object" && module.exports) {
  module.exports = { UNSERVED_NOTE: UNSERVED_NOTE, GATE_WORKER_NOTE: GATE_WORKER_NOTE, fillLabel: fillLabel, laneRows: laneRows,
    canApproveGate: canApproveGate, sourceLine: sourceLine, deskWriters: deskWriters, laneRow: laneRow, renderWorkers: renderWorkers,
    ownerDecisions_: ownerDecisions_, yourIdLine_: yourIdLine_, OWNER_TAMPERED_NOTE: OWNER_TAMPERED_NOTE };
}
