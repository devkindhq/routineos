/* src/actions.js: every page write goes through here. A document is written by producers or by
   people, never both (spec s7), so the page may only write the people-owned collections below.
   Page writes are last-writer-wins: no version pin (db.d.ts, contract 0.2.92). */

var PEOPLE_COLLECTIONS = ["settings", "userstate", "decisions", "merges", "views", "columns", "settingsHistory"];
var VIEWER_STATE_KINDS = ["read", "done", "ack", "snooze", "pin"];
var READ_ONLY_NOTE = "Demo data, read only";
var SIGN_IN_NOTE = "Sign in to make changes";
var QUOTA_NOTE = "The Desk is full (25,000 records). Ask the routine owner to clear old records.";

function PathError(path) {
  this.name = "PathError";
  this.message = "The page does not write " + path;
}
PathError.prototype = Object.create(Error.prototype);
PathError.prototype.constructor = PathError;

// Per-viewer state lives at data/users/<viewer>/state/{read,done,ack,snooze,pin}/<id> (six segments, a doc).
function viewerPath(viewer, kind, id) {
  return "data/users/" + viewer + "/state/" + kind + "/" + id;
}

function writable(path, viewer) {
  var seg = String(path).split("/");
  if (seg.some(function (s) { return !s; })) return false;
  if (seg.length === 2) return PEOPLE_COLLECTIONS.indexOf(seg[0]) !== -1;
  if (seg.length === 4 && seg[0] === "people") return !!viewer && seg[1] === String(viewer) && seg[2] === "decisions";
  return !!viewer && seg.length === 6 && seg[0] === "data" && seg[1] === "users" && seg[2] === String(viewer) &&
    seg[3] === "state" && VIEWER_STATE_KINDS.indexOf(seg[4]) !== -1;
}

function save(store, viewer, path, doc) {
  if (!writable(path, viewer)) return Promise.reject(new PathError(path));
  return store.set(path, doc);
}

function remove(store, viewer, path) {
  if (!writable(path, viewer)) return Promise.reject(new PathError(path));
  return store.del(path);
}

// Whether this visit may write at all. No viewer id means no attributable write, so nothing is written.
function canWrite(ctx) {
  if (ctx.store && ctx.store.readOnly) return { ok: false, reason: READ_ONLY_NOTE };
  if (!ctx.viewer) return { ok: false, reason: SIGN_IN_NOTE };
  return { ok: true, reason: "" };
}

function isQuota(e) {
  return !!e && (e.code === "quota_exceeded" || /quota_exceeded/.test(String(e.message || "")));
}

function writeMessage(e) {
  if (e && e.name === "ReadOnlyError") return READ_ONLY_NOTE;
  if (e && e.partial) return e.message;
  if (isQuota(e)) return QUOTA_NOTE;
  return "Not saved: " + ((e && e.message) || "the write was refused");
}

// A button that runs one write. While it runs the button is disabled; the outcome is stated in
// `status` (an element the caller places). On the read-only store, or with no viewer id, every action is
// disabled and its title says why.
function actionButton(ctx, label, run, opts) {
  opts = opts || {};
  var allowed = canWrite(ctx);
  var b = button(label, null, {
    primary: opts.primary,
    disabled: !allowed.ok || opts.disabled,
    title: !allowed.ok ? allowed.reason : opts.title,
    icon: opts.icon,
    iconOnly: opts.iconOnly,
    pressed: opts.pressed,
  });
  b.addEventListener("click", function (e) {
    if (e && e.stopPropagation) e.stopPropagation();
    b.disabled = true;
    if (opts.status) opts.status.textContent = "Saving";
    Promise.resolve().then(run).then(function () {
      if (opts.status) opts.status.textContent = opts.done || "Saved.";
      b.disabled = false;
    }, function (e) {
      if (opts.status) opts.status.textContent = writeMessage(e);
      b.disabled = false;
    });
  });
  return b;
}

// The star toggle: an icon button, outline when off and filled when on. The name says what a press does
// ("Star <name>" or "Unstar <name>") and aria-pressed carries the current state.
function starToggle(ctx, name, starred, run, opts) {
  opts = opts || {};
  return actionButton(ctx, (starred ? "Unstar " : "Star ") + name, run, {
    icon: starred ? "star-filled" : "star", iconOnly: true, pressed: !!starred, status: opts.status, done: opts.done,
  });
}

function stamp(ctx) {
  return { at: new Date().toISOString(), by: ctx.viewer || null };
}

var NO_VIEWER_NOTE = "Read and done are not available for this visit.";

// specs: {name: {collection, q}}. cb gets {name: docs} once every collection has answered, then on each change.
function watchAll(ctx, specs, cb, onError) {
  var names = Object.keys(specs);
  var got = {};
  var waiting = names.length;
  var stops = names.map(function (name) {
    var first = true;
    var q = Object.assign({}, specs[name].q || {}, { onError: onError || function () {} });
    return ctx.store.subscribe(specs[name].collection, function (docs) {
      got[name] = docs;
      if (first) { first = false; waiting--; }
      if (waiting === 0) cb(got);
    }, q);
  });
  return function () { stops.forEach(function (stop) { stop(); }); };
}

// Adds the viewer's read/done/ack collections to a watch; nothing is added without a viewer id.
function withViewerState(ctx, specs, kinds) {
  if (ctx.viewer) kinds.forEach(function (k) { specs[k] = { collection: "data/users/" + ctx.viewer + "/state/" + k }; });
  return specs;
}

function idSet(docs) {
  return docs ? new Set(docs.map(function (d) { return d.id; })) : null;
}

// No prototype: a doc id like "__proto__" or "constructor" is a plain key (db.d.ts allows both).
function byId(docs) {
  var out = Object.create(null);
  (docs || []).forEach(function (d) { out[d.id] = d.data; });
  return out;
}

// A person's reason read straight from decisions/, capped like the contract's MAX_PERSON_REASON (code points).
var PERSON_REASON_MAX = 200;
function shownReason(reason) {
  return Array.from(String(reason)).slice(0, PERSON_REASON_MAX).join("");
}

function markViewer(ctx, kind, id, on) {
  var path = viewerPath(ctx.viewer, kind, id);
  return on ? save(ctx.store, ctx.viewer, path, stamp(ctx)) : remove(ctx.store, ctx.viewer, path);
}

// Snooze an inbox item for this viewer until an ISO time (spec "Inbox"). {until, at, by}.
function snoozeItem(ctx, id, until) {
  if (!until) return Promise.reject(new Error("pick when to bring it back."));
  return save(ctx.store, ctx.viewer, viewerPath(ctx.viewer, "snooze", id), Object.assign({ until: until }, stamp(ctx)));
}

function producerSetting(definition, producer, setting) {
  var p = ((definition && definition.producers) || []).filter(function (x) { return x.id === producer; })[0];
  return p && (p.settings || []).filter(function (x) { return x.name === setting; })[0];
}

function producerDefault(definition, producer, setting) {
  var s = producerSetting(definition, producer, setting);
  return s ? s.default : undefined;
}

// Re-reads settings/<producer> right before writing; last write wins, no conflict screen.
function writeSetting(ctx, producer, setting, change) {
  var path = "settings/" + producer;
  return ctx.store.get(path).then(function (cur) {
    var data = Object.assign({}, cur.exists ? cur.data : {});
    var values = Object.assign({}, data.values || {});
    var before = setting in values ? values[setting] : producerDefault(ctx.definition, producer, setting);
    values[setting] = change(before);
    data.values = values;
    data.updatedAt = new Date().toISOString();
    data.updatedBy = ctx.viewer || null;
    return save(ctx.store, ctx.viewer, path, data);
  });
}

var HISTORY_CAP = 50;

// Entries past the cap, newest kept: the ids to delete.
function historyToPrune(entries, cap) {
  var sorted = (entries || []).slice().sort(function (a, b) {
    var x = a.data.at || "", y = b.data.at || "";
    return x === y ? (a.id < b.id ? 1 : -1) : (x < y ? 1 : -1);
  });
  return sorted.slice(cap).map(function (e) { return e.id; });
}

// The values to write to undo one history entry: its before values for the keys it changed.
function revertChange(entry) {
  var out = {};
  Object.keys(entry.after || {}).forEach(function (k) {
    var b = (entry.before || {})[k];
    out[k] = b === undefined ? null : b;
  });
  return out;
}

// Settings page: re-reads the settings doc right before writing and replaces only the keys given.
// Last write wins, no conflict screen. Then records settingsHistory/<producer>--<time digits>
// {producer, before, after, at, by} and prunes that producer's history to HISTORY_CAP.
function writeSettings(ctx, path, changes) {
  var producer = String(path).split("/").pop();
  var before = {};
  return ctx.store.get(path).then(function (cur) {
    var data = Object.assign({}, cur.exists ? cur.data : {});
    var values = data.values || {};
    Object.keys(changes).forEach(function (k) {
      var b = k in values ? values[k] : producerDefault(ctx.definition, producer, k);
      before[k] = b === undefined ? null : b;
    });
    data.values = Object.assign({}, values, changes);
    data.updatedAt = new Date().toISOString();
    data.updatedBy = ctx.viewer || null;
    return save(ctx.store, ctx.viewer, path, data);
  }).then(function () {
    var s = stamp(ctx);
    var entry = { producer: producer, before: before, after: Object.assign({}, changes), at: s.at, by: s.by };
    return save(ctx.store, ctx.viewer, "settingsHistory/" + producer + "--" + s.at.replace(/\D/g, ""), entry).then(function () {
      return ctx.store.list("settingsHistory", { where: [["producer", "==", producer]] });
    }).then(function (rows) {
      return historyToPrune(rows, HISTORY_CAP).reduce(function (p, id) {
        return p.then(function () { return remove(ctx.store, ctx.viewer, "settingsHistory/" + id); });
      }, Promise.resolve());
    }).catch(function (e) {
      var err = new Error("Saved. The change was not added to the settings history: " + (isQuota(e) ? QUOTA_NOTE : (e && e.message) || "the write was refused"));
      err.partial = true;
      throw err;
    });
  });
}

function addExclusion(ctx, producer, setting, value) {
  return writeSetting(ctx, producer, setting, function (list) {
    list = Array.isArray(list) ? list.slice() : [];
    var lower = String(value).toLowerCase();
    if (!list.some(function (v) { return String(v).toLowerCase() === lower; })) list.push(value);
    return list;
  });
}

// extra carries a learned proposal's key (and a snooze's until), the ids the routine's rejection memory reads.
function decide(ctx, id, decision, extra) {
  return save(ctx.store, ctx.viewer, "decisions/" + id, Object.assign({ decision: decision }, extra || {}, stamp(ctx)));
}

// people/<viewer>/decisions/<id>: a decision the Desk's db rules (DESK_DB_RULES) let only that person write, so the
// path itself says who decided. Lane decisions a worker run honours (verified, release, its gate approvals) live here.
function personPath(viewer, id) {
  return "people/" + viewer + "/decisions/" + id;
}

function decidePerson(ctx, id, decision, extra) {
  return save(ctx.store, ctx.viewer, personPath(ctx.viewer, id), Object.assign({ decision: decision }, extra || {}, stamp(ctx)));
}

// Desk v2 drop: a person's drop with a reason. The producer marks the record dropped on its next run.
function dropRecord(ctx, id, reason) {
  var r = String(reason || "").trim();
  if (!r) return Promise.reject(new Error("give a reason for the drop."));
  return decide(ctx, id, "drop", { reason: r });
}

// Restore: a person's own drop is undone (the routine's filters still apply on the next run); a record the
// routine dropped is kept, which feeds the override learn signal.
function restoreRecord(ctx, id, decision) {
  if (decision && decision.decision === "drop") return remove(ctx.store, ctx.viewer, "decisions/" + id);
  return decide(ctx, id, "keep");
}

var BAD_PROPOSAL_NOTE = "this proposal names no setting or no new value";
var PR_PROPOSAL_NOTE = "this change opens a PR; Accept writes no setting";
var EMPTY_INCLUDE_NOTE = "this would leave an include list empty, so it would match nothing";
var SNOOZE_DAYS = 7;

// One per-item change applied to the value as it is now: add once, remove by casefold, set replaces.
function applyOp(current, p) {
  if (p.op === "set") return p.value;
  var list = Array.isArray(current) ? current.slice() : [];
  var lower = String(p.value).toLowerCase();
  var has = function (v) { return String(v).toLowerCase() === lower; };
  if (p.op === "remove") return list.filter(function (v) { return !has(v); });
  if (!list.some(has)) list.push(p.value);
  return list;
}

function proposalLevel(p) {
  return p && typeof p === "object" && p.level ? p.level : "L1";
}

function keyExtra(msg) {
  var p = msg.data.proposal;
  return p && typeof p === "object" && typeof p.key === "string" ? { key: p.key } : {};
}

function rejectProposal(ctx, msg) {
  return decide(ctx, msg.id, "reject", keyExtra(msg));
}

function snoozeProposal(ctx, msg, now) {
  var until = new Date((now === undefined ? Date.now() : now) + SNOOZE_DAYS * 86400000).toISOString();
  return decide(ctx, msg.id, "snooze", Object.assign(keyExtra(msg), { until: until }));
}

// A proposal is {setting, from, to}. Messages stored before the write contract checked the shape may carry
// {current, suggested} instead; those are read as from and to.
function normalizeProposal(p) {
  p = p && typeof p === "object" ? p : {};
  return { setting: p.setting, from: "from" in p ? p.from : p.current, to: "to" in p ? p.to : p.suggested };
}

// Accept writes the proposed value first, then the decision; dismiss writes only the decision.
// A proposal without a setting or a new value writes nothing and records no decision. A per-item proposal
// (with op) applies its item to the current value, so edits made since the run are kept. L2 and L3 write nothing,
// and no Accept may leave an include list empty.
function acceptProposal(ctx, msg) {
  var raw = msg.data.proposal;
  if (proposalLevel(raw) !== "L1") return Promise.reject(new Error(PR_PROPOSAL_NOTE));
  var item = raw && typeof raw === "object" && raw.op ? raw : null;
  var p = normalizeProposal(raw);
  if (typeof p.setting !== "string" || !p.setting || (!item && p.to === undefined)) return Promise.reject(new Error(BAD_PROPOSAL_NOTE));
  var include = (producerSetting(ctx.definition, msg.data.producer, p.setting) || {}).role === "include";
  var change = function (cur) {
    var next = item ? applyOp(cur, item) : p.to;
    if (include && Array.isArray(next) && !next.length) throw new Error(EMPTY_INCLUDE_NOTE);
    return next;
  };
  return writeSetting(ctx, msg.data.producer, p.setting, change).then(function () {
    return decide(ctx, msg.id, "accept", keyExtra(msg));
  });
}

// meta/owner {by, at}: who owns this Desk. The Desk is published with a db rule that lets only the artifact's
// owner write meta/ (DESK_DB_RULES), and the page writes it only when user.isOwner() is true, so no other viewer
// can create or replace it. Page writes carry no version pin, so create-only is a read, a write, then a read back.
// A stored record that disagrees with isOwner() in either direction (the owner sees someone else's id, or a
// non-owner sees their own) is tampered: ctx.ownerTampered is set and no owner is accepted.
var OWNER_PATH = "meta/owner";

function ensureOwner(ctx) {
  var store = ctx.store;
  if (!ctx.viewer || !store || typeof store.isOwner !== "function") return Promise.resolve(ctx.owner || null);
  var viewer = String(ctx.viewer);
  function tampered() { ctx.owner = null; ctx.ownerTampered = true; return null; }
  return store.isOwner().then(function (yes) {
    var known = ctx.owner;
    if (yes !== true) {
      if (known && known.by === viewer) return tampered();
      return known || store.get(OWNER_PATH).then(function (cur) {
        if (cur.exists && cur.data && cur.data.by === viewer) return tampered();
        return cur.exists ? cur.data : null;
      });
    }
    if (known) return known.by === viewer ? known : tampered();
    return store.get(OWNER_PATH).then(function (cur) {
      if (cur.exists) return cur.data && cur.data.by === viewer ? cur.data : tampered();
      if (store.readOnly) return null;
      return store.set(OWNER_PATH, { by: viewer, at: new Date().toISOString() }).then(function () {
        return store.get(OWNER_PATH);
      }).then(function (back) {
        if (!back.exists) return null;
        return back.data && back.data.by === viewer ? back.data : tampered();
      });
    });
  }).then(function (owner) {
    if (ctx.ownerTampered) return null;
    if (owner && typeof owner === "object" && typeof owner.by === "string") ctx.owner = owner;
    return ctx.owner || null;
  }, function () { return ctx.ownerTampered ? null : ctx.owner || null; });
}

// No meta/owner means nobody is the owner on the page: owner-only controls stay hidden for everyone.
function isDeskOwner(ctx) {
  return !!(ctx && ctx.owner && ctx.viewer && ctx.owner.by === ctx.viewer);
}

var RELEASE_KEY_RE = /^[a-z][a-z0-9-]*--[a-z0-9-]+$/;
var RELEASE_ASK = "Release this lane? Its worker's next run stops, and someone else can join it.";

var RELEASE_HOLDER_RE = /^[A-Za-z0-9_-]{1,64}$/;

// Owner only, after a confirm: people/<owner id>/decisions/release--<laneKey> {decision: "release", holder, at, by}.
// ask(question) is the in-page confirm (the Desk uses no blocking dialogs); anything but true resolves false and writes
// nothing. The worker's run honours it only under meta/owner.by's own people path, which the db rules let nobody else
// write. holder is the Desk id of the worker released: the release is final for that holder, whatever joinedAt in
// workers/ (writable by any Contributor) says, until the owner removes it.
function releaseLane(ctx, laneKey, ask, holder) {
  if (!isDeskOwner(ctx)) return Promise.reject(new Error("only the Desk owner can release a lane."));
  if (typeof laneKey !== "string" || !RELEASE_KEY_RE.test(laneKey)) return Promise.reject(new Error("this lane key is not valid."));
  if (typeof holder !== "string" || !RELEASE_HOLDER_RE.test(holder)) return Promise.reject(new Error("this lane names no worker to release."));
  if (typeof ask !== "function" || ask(RELEASE_ASK) !== true) return Promise.resolve(false);
  return decidePerson(ctx, "release--" + laneKey, "release", { holder: holder }).then(function () { return true; });
}

function decisionWord(dec) {
  return { accept: "Accepted", dismiss: "Dismissed", reject: "Rejected", snooze: "Snoozed" }[dec.decision] || "Decided";
}

if (typeof module === "object" && module.exports) {
  module.exports = {
    writable: writable, save: save, remove: remove, PathError: PathError, viewerPath: viewerPath,
    NO_VIEWER_NOTE: NO_VIEWER_NOTE, READ_ONLY_NOTE: READ_ONLY_NOTE, actionButton: actionButton, starToggle: starToggle,
    normalizeProposal: normalizeProposal, acceptProposal: acceptProposal, writeMessage: writeMessage, decide: decide, stamp: stamp,
    applyOp: applyOp, proposalLevel: proposalLevel, rejectProposal: rejectProposal, snoozeProposal: snoozeProposal,
    decisionWord: decisionWord, PR_PROPOSAL_NOTE: PR_PROPOSAL_NOTE,
    dropRecord: dropRecord, restoreRecord: restoreRecord, snoozeItem: snoozeItem, markViewer: markViewer,
    canWrite: canWrite, isQuota: isQuota, SIGN_IN_NOTE: SIGN_IN_NOTE, QUOTA_NOTE: QUOTA_NOTE,
    PEOPLE_COLLECTIONS: PEOPLE_COLLECTIONS, writeSettings: writeSettings, HISTORY_CAP: HISTORY_CAP,
    historyToPrune: historyToPrune, revertChange: revertChange, byId: byId, shownReason: shownReason,
    ensureOwner: ensureOwner, isDeskOwner: isDeskOwner, releaseLane: releaseLane, OWNER_PATH: OWNER_PATH, RELEASE_ASK: RELEASE_ASK,
    personPath: personPath, decidePerson: decidePerson,
  };
}
