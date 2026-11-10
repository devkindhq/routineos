// core/actions.js: every page write goes through here. A document is written by producers or by
// people, never both (spec s7), so the page may only write the people-owned collections below.
// Page writes are last-writer-wins: no version pin (db.d.ts, contract 0.2.92).
import { hashPin, rememberLockPass, validPin } from "./lock.js";
import { REQUEST_KINDS, REQUEST_NOTE_MAX, listedRoutines, newRequestId, waitingRequests } from "./queue.js";

export var PEOPLE_COLLECTIONS = ["settings", "userstate", "decisions", "merges", "views", "columns", "settingsHistory", "requests"];
export var VIEWER_STATE_KINDS = ["read", "done", "ack", "snooze", "pin", "cols", "route"];
export var READ_ONLY_NOTE = "Demo data, read only";
export var SIGN_IN_NOTE = "Sign in to make changes";
export var ACCESS_NOTE = "Saving needs Contributor access or above";
export var QUOTA_NOTE = "The Desk is full (25,000 records). Ask the routine owner to clear old records.";

export function PathError(path) {
  this.name = "PathError";
  this.message = "The page does not write " + path;
}
PathError.prototype = Object.create(Error.prototype);
PathError.prototype.constructor = PathError;

// Per-viewer state lives at data/users/<viewer>/state/{read,done,ack,snooze,pin,cols,route}/<id> (six segments, a doc).
export function viewerPath(viewer, kind, id) {
  return "data/users/" + viewer + "/state/" + kind + "/" + id;
}

export function writable(path, viewer) {
  var seg = String(path).split("/");
  if (seg.some(function (s) { return !s; })) return false;
  // Comments are written only under people/<viewer>/comments (core/comments.js), the one path where the path proves
  // the author. The flat comments/ collection of an earlier Desk is read, never written.
  if (seg.length === 2 && seg[0] === "people") return !!viewer && seg[1] === String(viewer); // the marker doc that makes an author listable
  if (seg.length === 2) return PEOPLE_COLLECTIONS.indexOf(seg[0]) !== -1;
  if (seg.length === 4 && seg[0] === "people") return !!viewer && seg[1] === String(viewer) && (seg[2] === "decisions" || seg[2] === "comments");
  return !!viewer && seg.length === 6 && seg[0] === "data" && seg[1] === "users" && seg[2] === String(viewer) &&
    seg[3] === "state" && VIEWER_STATE_KINDS.indexOf(seg[4]) !== -1;
}

export function save(store, viewer, path, doc) {
  if (!writable(path, viewer)) return Promise.reject(new PathError(path));
  return store.set(path, doc);
}

export function remove(store, viewer, path) {
  if (!writable(path, viewer)) return Promise.reject(new PathError(path));
  return store.del(path);
}

// Whether this visit may write shared data. No viewer id means no attributable write, so nothing is written. The
// platform's answer (ctx.canWriteShared, from store.canWriteShared) refuses only when it is exactly false: null or
// undefined (not told) leaves the control enabled and a refused write decides. code "access" marks that refusal, the one
// the controls show disabled with the reason rather than hide.
export function canWrite(ctx) {
  if (ctx.store && ctx.store.readOnly) return { ok: false, reason: READ_ONLY_NOTE };
  if (!ctx.viewer) return { ok: false, reason: SIGN_IN_NOTE };
  if (ctx.canWriteShared === false) return { ok: false, reason: ACCESS_NOTE, code: "access" };
  return { ok: true, reason: "" };
}

// Desk comments are written to the shared database, which a Commenter or Viewer cannot write (the platform refuses a
// write rule below interact), so commenting follows the same gate as every other write: Contributor and up.
export function canComment(ctx) {
  return canWrite(ctx);
}

// The platform comment composer for a viewer the shared db refuses (Commenter or Viewer). Non-null only when the store
// is writable, the platform says exactly false to data.write, and the store's composer() (the platform comments namespace) resolves a namespace with
// openComposer; otherwise null and the Desk keeps its own comment box. Composer only: the Desk cannot list the threads.
export function canNativeComment(ctx) {
  if (!ctx || !ctx.store || ctx.store.readOnly || ctx.canWriteShared !== false || typeof ctx.store.composer !== "function") return Promise.resolve(null);
  return Promise.resolve(ctx.store.composer()).then(function (ns) {
    return ns && typeof ns.openComposer === "function" ? { open: function (el) { return ns.openComposer({ element: el }); } } : null;
  }, function () { return null; });
}

// The reason to show on a disabled control when this visit is refused shared writes by access level, else "".
export function accessReason(ctx) {
  var w = canWrite(ctx);
  return w.code === "access" ? w.reason : "";
}

// Asks a routine for something at its next run: writes requests/<id> as pending. Only an allow-listed kind for a
// routine the Desk lists is written; a viewer who cannot write is refused the same way as any other write.
var inFlight_ = new WeakMap();

export function request(ctx, kind, payload) {
  var w = canWrite(ctx);
  if (!w.ok) return Promise.reject(new Error(w.reason));
  if (REQUEST_KINDS.indexOf(kind) === -1) return Promise.reject(new Error("That is not a request the Desk can queue."));
  var p = payload && typeof payload === "object" ? payload : {};
  if (typeof p.routine !== "string" || listedRoutines(ctx.definition).indexOf(p.routine) === -1) {
    return Promise.reject(new Error("That routine is not on this Desk."));
  }
  var store = ctx.store;
  // Two asks started together (a double click) in this page share one read-then-write.
  var pending = inFlight_.get(store);
  if (!pending) { pending = {}; inFlight_.set(store, pending); }
  var slot = kind + "\u0000" + p.routine;
  if (pending[slot]) return pending[slot];
  var run = queue_(ctx, kind, p, store);
  pending[slot] = run;
  var clear = function () { delete pending[slot]; };
  run.then(clear, clear);
  return run;
}

function queue_(ctx, kind, p, store) {
  function write() {
    var id = newRequestId();
    var doc = { kind: kind, routine: p.routine, createdAt: new Date().toISOString(), by: ctx.viewer, status: "pending",
      note: String(p.note === undefined || p.note === null ? "" : p.note).slice(0, REQUEST_NOTE_MAX) };
    return save(store, ctx.viewer, "requests/" + id, doc).then(function () { return { id: id }; });
  }
  // One waiting request per kind and routine is enough: the routine reads every pending one at the start of a run.
  // A request a run already reported on is not waiting. A failed read cannot show a duplicate, so the write goes on.
  if (typeof store.list !== "function") return write();
  return Promise.all([store.list("requests", { where: [["routine", "==", p.routine]] }),
    store.list("runs", { where: [["producer", "==", p.routine]] })]).then(function (r) {
    var same = waitingRequests(r[0], r[1]).filter(function (d) { return d.data.kind === kind; });
    return same.length ? { id: same[0].id, existing: true } : write();
  }, write);
}

export function isQuota(e) {
  return !!e && (e.code === "quota_exceeded" || /quota_exceeded/.test(String(e.message || "")));
}

export function writeMessage(e) {
  if (e && e.name === "ReadOnlyError") return READ_ONLY_NOTE;
  if (e && e.partial) return e.message;
  if (isQuota(e)) return QUOTA_NOTE;
  return "Not saved: " + ((e && e.message) || "the write was refused");
}

export function stamp(ctx) {
  return { at: new Date().toISOString(), by: ctx.viewer || null };
}

export var NO_VIEWER_NOTE = "Read and done are not available for this visit.";

// specs: {name: {collection, q}}. cb gets {name: docs} once every collection has answered, then on each change.
export function watchAll(ctx, specs, cb, onError) {
  var names = Object.keys(specs);
  var got = {};
  var waiting = names.length;
  var stops = names.map(function (name) {
    var first = true;
    var q = Object.assign({}, specs[name].q || {}, { onError: onError || function () {} });
    function answer(docs) {
      got[name] = docs;
      if (first) { first = false; waiting--; }
      if (waiting === 0) cb(got);
    }
    // A spec with watch(cb, onError) reads from more than one place (comments); it returns its own stop.
    if (specs[name].watch) return specs[name].watch(answer, onError);
    return ctx.store.subscribe(specs[name].collection, answer, q);
  });
  return function () { stops.forEach(function (stop) { stop(); }); };
}

// Adds the viewer's read/done/ack collections to a watch; nothing is added without a viewer id.
export function withViewerState(ctx, specs, kinds) {
  if (ctx.viewer) kinds.forEach(function (k) { specs[k] = { collection: "data/users/" + ctx.viewer + "/state/" + k }; });
  return specs;
}

export function idSet(docs) {
  return docs ? new Set(docs.map(function (d) { return d.id; })) : null;
}

// No prototype: a doc id like "__proto__" or "constructor" is a plain key (db.d.ts allows both).
export function byId(docs) {
  var out = Object.create(null);
  (docs || []).forEach(function (d) { out[d.id] = d.data; });
  return out;
}

// A person's reason read straight from decisions/, capped like the contract's MAX_PERSON_REASON (code points).
export var PERSON_REASON_MAX = 200;
export function shownReason(reason) {
  return Array.from(String(reason)).slice(0, PERSON_REASON_MAX).join("");
}

export function markViewer(ctx, kind, id, on) {
  var path = viewerPath(ctx.viewer, kind, id);
  return on ? save(ctx.store, ctx.viewer, path, stamp(ctx)) : remove(ctx.store, ctx.viewer, path);
}

// Snooze an inbox item for this viewer until an ISO time (spec "Inbox"). {until, at, by}.
export function snoozeItem(ctx, id, until) {
  if (!until) return Promise.reject(new Error("pick when to bring it back."));
  return save(ctx.store, ctx.viewer, viewerPath(ctx.viewer, "snooze", id), Object.assign({ until: until }, stamp(ctx)));
}

export function producerSetting(definition, producer, setting) {
  var p = ((definition && definition.producers) || []).filter(function (x) { return x.id === producer; })[0];
  return p && (p.settings || []).filter(function (x) { return x.name === setting; })[0];
}

export function producerDefault(definition, producer, setting) {
  var s = producerSetting(definition, producer, setting);
  return s ? s.default : undefined;
}

// Re-reads settings/<producer> right before writing; last write wins, no conflict screen.
export function writeSetting(ctx, producer, setting, change) {
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

export var HISTORY_CAP = 50;

// Entries past the cap, newest kept: the ids to delete.
export function historyToPrune(entries, cap) {
  var sorted = (entries || []).slice().sort(function (a, b) {
    var x = a.data.at || "", y = b.data.at || "";
    return x === y ? (a.id < b.id ? 1 : -1) : (x < y ? 1 : -1);
  });
  return sorted.slice(cap).map(function (e) { return e.id; });
}

// The values to write to undo one history entry: its before values for the keys it changed.
export function revertChange(entry) {
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
export function writeSettings(ctx, path, changes) {
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

// extra carries a learned proposal's key (and a snooze's until), the ids the routine's rejection memory reads.
export function decide(ctx, id, decision, extra) {
  return save(ctx.store, ctx.viewer, "decisions/" + id, Object.assign({ decision: decision }, extra || {}, stamp(ctx)));
}

// people/<viewer>/decisions/<id>: a decision the Desk's db rules (DESK_DB_RULES) let only that person write, so the
// path itself says who decided. Lane decisions a worker run honours (verified, release, its gate approvals) live here.
export function personPath(viewer, id) {
  return "people/" + viewer + "/decisions/" + id;
}

export function decidePerson(ctx, id, decision, extra) {
  return save(ctx.store, ctx.viewer, personPath(ctx.viewer, id), Object.assign({ decision: decision }, extra || {}, stamp(ctx)));
}

// Desk v2 drop: a person's drop with a reason. The producer marks the record dropped on its next run.
export function dropRecord(ctx, id, reason) {
  var r = String(reason || "").trim();
  if (!r) return Promise.reject(new Error("give a reason for the drop."));
  return decide(ctx, id, "drop", { reason: r });
}

// Restore: a person's own drop is undone (the routine's filters still apply on the next run); a record the
// routine dropped is kept, which feeds the override learn signal.
export function restoreRecord(ctx, id, decision) {
  if (decision && decision.decision === "drop") return remove(ctx.store, ctx.viewer, "decisions/" + id);
  return decide(ctx, id, "keep");
}

export var BAD_PROPOSAL_NOTE = "this proposal names no setting or no new value";
export var PR_PROPOSAL_NOTE = "this change opens a PR; Accept writes no setting";
export var EMPTY_INCLUDE_NOTE = "this would leave an include list empty, so it would match nothing";
export var SNOOZE_DAYS = 7;

// One per-item change applied to the value as it is now: add once, remove by casefold, set replaces.
export function applyOp(current, p) {
  if (p.op === "set") return p.value;
  var list = Array.isArray(current) ? current.slice() : [];
  var lower = String(p.value).toLowerCase();
  var has = function (v) { return String(v).toLowerCase() === lower; };
  if (p.op === "remove") return list.filter(function (v) { return !has(v); });
  if (!list.some(has)) list.push(p.value);
  return list;
}

export function proposalLevel(p) {
  return p && typeof p === "object" && p.level ? p.level : "L1";
}

export function keyExtra(msg) {
  var p = msg.data.proposal;
  return p && typeof p === "object" && typeof p.key === "string" ? { key: p.key } : {};
}

export function rejectProposal(ctx, msg) {
  return decide(ctx, msg.id, "reject", keyExtra(msg));
}

export function snoozeProposal(ctx, msg, now) {
  var until = new Date((now === undefined ? Date.now() : now) + SNOOZE_DAYS * 86400000).toISOString();
  return decide(ctx, msg.id, "snooze", Object.assign(keyExtra(msg), { until: until }));
}

// A proposal is {setting, from, to}. Messages stored before the write contract checked the shape may carry
// {current, suggested} instead; those are read as from and to.
export function normalizeProposal(p) {
  p = p && typeof p === "object" ? p : {};
  return { setting: p.setting, from: "from" in p ? p.from : p.current, to: "to" in p ? p.to : p.suggested };
}

// Accept writes the proposed value first, then the decision; dismiss writes only the decision.
// A proposal without a setting or a new value writes nothing and records no decision. A per-item proposal
// (with op) applies its item to the current value, so edits made since the run are kept. L2 and L3 write nothing,
// and no Accept may leave an include list empty.
export function acceptProposal(ctx, msg) {
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
  var prior = { producer: msg.data.producer, setting: p.setting, had: false, before: undefined };
  return ctx.store.get("settings/" + prior.producer).then(function (cur) {
    var v = (cur.exists && cur.data && cur.data.values) || {};
    if (prior.setting in v) { prior.had = true; prior.before = v[prior.setting]; }
    return writeSetting(ctx, msg.data.producer, p.setting, change);
  }).then(function () {
    return decide(ctx, msg.id, "accept", keyExtra(msg));
  }).then(function () { return prior; });
}

// Undo an Accept (UX review 2): the setting goes back to what acceptProposal saw (unset again if it was unset),
// then the decision is removed so the suggestion is waiting again.
export function undoAccept(ctx, id, prior) {
  var path = "settings/" + prior.producer;
  return ctx.store.get(path).then(function (cur) {
    var data = Object.assign({}, cur.exists ? cur.data : {}), values = Object.assign({}, data.values || {});
    if (prior.had) values[prior.setting] = prior.before; else delete values[prior.setting];
    data.values = values;
    data.updatedAt = new Date().toISOString();
    data.updatedBy = ctx.viewer || null;
    return save(ctx.store, ctx.viewer, path, data);
  }).then(function () { return remove(ctx.store, ctx.viewer, "decisions/" + id); });
}

// meta/owner {by, at}: who owns this Desk. The Desk is published with a db rule that lets only the artifact's
// owner write meta/ (DESK_DB_RULES), and the page writes it only when user.isOwner() is true, so no other viewer
// can create or replace it. Page writes carry no version pin, so create-only is a read, a write, then a read back.
// A stored record that disagrees with isOwner() in either direction (the owner sees someone else's id, or a
// non-owner sees their own) is tampered: ctx.ownerTampered is set and no owner is accepted.
export var OWNER_PATH = "meta/owner";

export function ensureOwner(ctx) {
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
export function isDeskOwner(ctx) {
  return !!(ctx && ctx.owner && ctx.viewer && ctx.owner.by === ctx.viewer);
}

// Whether this visit may record decisions: it can write, and on a joined Desk only the owner decides.
export function canDecide(ctx) {
  return canWrite(ctx).ok && (!ctx.join || isDeskOwner(ctx));
}

// meta/lock, the privacy PIN (spec 5.15, 7e; write-contract.md): owner only, PBKDF2-SHA-256 over a fresh 16 byte salt
// at 310000 iterations. A set passes this tab, so the owner who sets it is not locked out. Resolves the stored doc.
export var LOCK_PATH = "meta/lock";
export var LOCK_ITERATIONS = 310000;

export function lockSaltHex_() {
  var b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return Array.prototype.map.call(b, function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join("");
}

export function setLockPin(ctx, pin) {
  if (!isDeskOwner(ctx)) return Promise.reject(new Error("only the Desk owner can set the PIN."));
  if (!validPin(pin)) return Promise.reject(new Error("a PIN is six digits."));
  var salt = lockSaltHex_();
  return hashPin(pin, salt, LOCK_ITERATIONS).then(function (hash) {
    var doc = { salt: salt, hash: hash, iterations: LOCK_ITERATIONS, algo: "PBKDF2-SHA-256",
      setAt: new Date().toISOString(), setBy: String(ctx.viewer) };
    return ctx.store.set(LOCK_PATH, doc).then(function () {
      rememberLockPass(salt);
      return doc;
    });
  });
}

export function removeLockPin(ctx) {
  if (!isDeskOwner(ctx)) return Promise.reject(new Error("only the Desk owner can remove the PIN."));
  return ctx.store.del(LOCK_PATH);
}

export var RELEASE_KEY_RE = /^[a-z][a-z0-9-]*--[a-z0-9-]+$/;
export var RELEASE_ASK = "Release this lane? Its worker's next run stops, and someone else can join it.";

export var RELEASE_HOLDER_RE = /^[A-Za-z0-9_-]{1,64}$/;

// Owner only, after a confirm: people/<owner id>/decisions/release--<laneKey> {decision: "release", holder, at, by}.
// ask(question) is the in-page confirm (the Desk uses no blocking dialogs); anything but true resolves false and writes
// nothing. The worker's run honours it only under meta/owner.by's own people path, which the db rules let nobody else
// write. holder is the Desk id of the worker released: the release is final for that holder, whatever joinedAt in
// workers/ (writable by any Contributor) says, until the owner removes it.
export function releaseLane(ctx, laneKey, ask, holder) {
  if (!isDeskOwner(ctx)) return Promise.reject(new Error("only the Desk owner can release a lane."));
  if (typeof laneKey !== "string" || !RELEASE_KEY_RE.test(laneKey)) return Promise.reject(new Error("this lane key is not valid."));
  if (typeof holder !== "string" || !RELEASE_HOLDER_RE.test(holder)) return Promise.reject(new Error("this lane names no worker to release."));
  if (typeof ask !== "function" || ask(RELEASE_ASK) !== true) return Promise.resolve(false);
  return decidePerson(ctx, "release--" + laneKey, "release", { holder: holder }).then(function () { return true; });
}

export function decisionWord(dec) {
  return { accept: "Accepted", dismiss: "Dismissed", reject: "Rejected", snooze: "Snoozed" }[dec.decision] || "Decided";
}
