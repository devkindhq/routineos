// core/ext.js: what an agent-written record section, panel or page may do (spec: Desk extensions).
// Pure and node-testable. A component gets ctx.actions (host verbs) and nothing else that writes: every verb checks
// canWrite and goes through actions.save, so the write allowlist applies. Not a sandbox.
import { canComment, canDecide, canWrite, decide, dropRecord, request, save, stamp, writeMessage } from "./actions.js";
import { commentPath, nextTs36, saveComment, watchComments } from "./comments.js";
import { COMPONENT_ATTRS, COMPONENT_TAGS, applyFilters, toRow } from "./pages/browse.js";
import { viewToFilterState } from "./pages/settings.js";
import { fullRead } from "./paging.js";
import { readSpecRows } from "./pages/spec-read.js";
import { aggregateTile, evalQuery, tableRows } from "./pages/spec-query.js";

export var EXT_SLOTS = ["record-section", "panel", "page"];
export var PANEL_MAX = 50;
export var ID_RE = /^[A-Za-z0-9._:-]{1,200}$/;
export var VALUE_RE = /^[a-z0-9-]{1,40}$/;
export var RESERVED_VALUES = ["drop", "keep"];
export var WATCHABLE = ["entities", "decisions", "comments", "userstate"];
export var COMMENT_MAX = 4000;
export var FIELD_MAX = 2000;
export var NOTE_MAX = 2000;

// Interactive slots may also build these. No on* attribute, ever; handlers go through ui.button only.
// The SVG tags and attributes a code page may draw with. Nothing that loads, scripts, animates or links: no foreignObject,
// use, image, script, style, animate or set, no href, no style attribute, and no paint that names a url(). SVG is made
// with createElementNS and checked against its namespace, so an HTML element called "svg" is refused.
export var SVG_NS = "http://www.w3.org/2000/svg";
export var SVG_TAGS = ["svg", "g", "path", "line", "polyline", "rect", "circle", "text"];
export var SVG_ATTRS = ["viewbox", "width", "height", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "d", "points", "fill", "stroke",
  "stroke-width", "stroke-dasharray", "text-anchor", "transform", "role", "class", "title"];
export var SVG_ATTR_CASE = { viewbox: "viewBox" };

export function isSvgTag(tag) {
  return SVG_TAGS.indexOf(tag) !== -1;
}

export var EXT_TAGS = COMPONENT_TAGS.concat(["button", "input", "textarea", "label", "img", "h3", "h4", "table", "thead", "tbody", "tr", "th", "td"], SVG_TAGS);
export var EXT_ATTRS = COMPONENT_ATTRS.concat(["type", "placeholder", "rows", "maxlength", "disabled", "alt", "for", "name", "src"]);

export function extTag(tag) {
  return EXT_TAGS.indexOf(tag) !== -1;
}

// src only on img and only a safe image source; type only button or text; the rest as the field cell set plus the extras.
export function extAttr(name, tag, value, safeImage) {
  if (isSvgTag(tag)) {
    if (/^aria-[a-z0-9-]*[a-z0-9]$/.test(name)) return true;
    return SVG_ATTRS.indexOf(name) !== -1 && !/url\s*\(/i.test(String(value));
  }
  if (/^(aria|data)-[a-z0-9-]*[a-z0-9]$/.test(name)) return true;
  if (EXT_ATTRS.indexOf(name) === -1) return false;
  if (name === "src") return tag === "img" && safeImage(value);
  if (name === "type") return (tag === "button" || tag === "input") && (value === "button" || value === "text");
  return true;
}

// An extension's image carries its bytes (data:image/ or blob:). An https source would be a request to any host that
// a component can put read data into, so it is not offered.
export function extImageSrc(value) {
  return typeof value === "string" && /^(data:image\/|blob:)/i.test(value.trim());
}

export function validId(id) {
  return typeof id === "string" && ID_RE.test(id) && !/^\.+$/.test(id);
}

// A custom decision lives at decisions/<id>~x. validId excludes "~", so no record id a component can name ends the
// same way, and the path never lands on a built-in decisions/<id> doc.
export var DECISION_SUFFIX = "~x";

function refuse(msg) {
  return Promise.reject(new Error(msg));
}

// kind "comment" uses the comment gate, today the same as canWrite: Contributor and up.
function gate(ctx, id, decides, kind) {
  var w = kind === "comment" ? canComment(ctx) : canWrite(ctx);
  if (!w.ok) return refuse(w.reason);
  if (!validId(id)) return refuse("That is not a record id.");
  if (decides && !canDecide(ctx)) return refuse("Only the Desk owner can decide on a joined Desk.");
  return null;
}

// The only write path a component has. Each verb returns a Promise and rejects with the Desk's own wording.
export var VERBS = ["decide", "comment", "saveField", "drop", "keep", "request", "upsert"];

// The entity types the booted definition marks shared (issue #32), as {type: true}: the types
// whose entity docs a component may write through upsert. A definition with no shared types,
// or none at all (node tests), gives an empty list and upsert refuses everything.
export function sharedTypesOf(definition) {
  var out = {};
  var types = (definition || {}).types || {};
  Object.keys(types).forEach(function (t) { if (types[t] && types[t].shared === true) out[t] = true; });
  return out;
}

var UPSERT_ID_RE = /^[A-Za-z0-9_-]{1,120}$/;
export var UPSERT_FIELD_MAX = 2000;

// The re-read after a saved upsert (no version pin, db.d.ts): a doc whose stamps are not the
// writer's own was overwritten between the read and the write. Returns the warning text or null.
export function upsertStampConflict_(data, path, viewer, at) {
  if (!data || typeof data !== "object") return null;
  if (data.updatedBy === viewer && data.updatedAt === at) return null;
  return "Saved, but someone else changed this record just after you: " + path +
    " now says updatedBy " + String(data.updatedBy === undefined ? "?" : data.updatedBy) +
    ". Re-read the record before writing it again.";
}

// A field value a person or a code page may put on a shared record: a string (cut to length),
// a number or a boolean. Anything nested is refused: one small document per fact stays flat.
export function upsertFields(fields) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return null;
  var out = {};
  var keys = Object.keys(fields);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(k)) return null;
    var v = fields[k];
    if (typeof v === "string") v = v.slice(0, UPSERT_FIELD_MAX);
    else if (typeof v !== "number" && typeof v !== "boolean") return null;
    if (v !== v) return null; // NaN
    out[k] = v;
  }
  return out;
}

// allowed: the verbs the component's manifest declares. Only those exist on the object it receives.
// scope: {types} from the host. When given, the id must name an existing record, of one of those types when types is a
// list. Left out (node tests of the verbs alone), only the id's shape is checked.
export function makeActions(ctx, allowed, scope) {
  function text(v, max) {
    return String(v === undefined || v === null ? "" : v).slice(0, max);
  }
  function wrap(p) {
    return p.then(function () { return true; }, function (e) { throw new Error(writeMessage(e)); });
  }
  // Runs fn once the id passes the gate and, with a scope, names a record this component may touch.
  function inScope(id, decides, fn, kind) {
    var bad = gate(ctx, id, decides, kind);
    if (bad) return bad;
    if (!scope) return fn();
    return ctx.store.get("entities/" + id).then(function (d) {
      if (!d.exists) throw new Error("That record does not exist.");
      var types = scope.types;
      if (Array.isArray(types) && types.length && types.indexOf(d.data && d.data.type) === -1) {
        throw new Error("This component does not act on that kind of record.");
      }
      return fn();
    });
  }
  var all = {
    decide: function (id, value, note) {
      if (typeof value !== "string" || !VALUE_RE.test(value)) return gate(ctx, id, true) || refuse("A decision value is 1 to 40 characters of a-z, 0-9 and -.");
      if (RESERVED_VALUES.indexOf(value) !== -1) return gate(ctx, id, true) || refuse("Use drop or keep for that decision.");
      return inScope(id, true, function () {
        return wrap(save(ctx.store, ctx.viewer, "decisions/" + id + DECISION_SUFFIX,
          Object.assign({ decision: value, note: text(note, NOTE_MAX), entity: id }, stamp(ctx))));
      });
    },
    comment: function (id, body) {
      var t = text(body, COMMENT_MAX).trim();
      return inScope(id, false, function () {
        if (!t) return refuse("Write a comment first.");
        return wrap(saveComment(ctx.store, ctx.viewer, commentPath(ctx.viewer, id, nextTs36()),
          { at: new Date().toISOString(), text: t }));
      }, "comment");
    },
    saveField: function (id, field, value) {
      if (typeof field !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(field)) return gate(ctx, id) || refuse("That is not a field name.");
      return inScope(id, false, function () {
        return wrap(ctx.store.get("userstate/" + id).then(function (cur) {
          var data = Object.assign({}, cur.exists ? cur.data : {});
          data.fields = Object.assign({}, data.fields || {});
          data.fields[field] = text(value, FIELD_MAX);
          return save(ctx.store, ctx.viewer, "userstate/" + id, data);
        }));
      });
    },
    drop: function (id, reason) {
      return inScope(id, true, function () { return wrap(dropRecord(ctx, id, text(reason, NOTE_MAX))); });
    },
    request: function (kind, payload) {
      return wrap(request(ctx, kind, payload));
    },
    keep: function (id) {
      return inScope(id, true, function () { return wrap(decide(ctx, id, "keep")); });
    },
    // The shared-record write (issue #32). Only a type the booted definition marks shared, and
    // only that type's own fields object: bySource, sightings, status and key stay the producers'.
    upsert: function (type, id, fields) {
      var w = canWrite(ctx);
      if (!w.ok) return refuse(w.reason);
      var shared = sharedTypesOf(ctx.definition);
      if (shared[type] !== true) {
        return refuse("That is not a shared record type; a component cannot write it.");
      }
      // scope.types is honoured like every other verb: a section or panel named types acts only on
      // those, even shared ones. A page (no types list) may act on any shared type.
      if (scope && Array.isArray(scope.types) && scope.types.length && scope.types.indexOf(type) === -1) {
        return refuse("This component does not act on that kind of record.");
      }
      if (typeof id !== "string" || !UPSERT_ID_RE.test(id)) return refuse("That is not a record id.");
      var clean = upsertFields(fields);
      if (clean === null) return refuse("Fields must be plain values (text, number, true or false).");
      var path = "entities/" + type + "--" + id;
      var now = new Date().toISOString();
      return wrap(ctx.store.get(path).then(function (cur) {
        // A fresh doc is minimal: type, key, fields and stamps. No bySource, sightings or sources -
        // the page never fabricates producer machinery (R3); a later run fills those in.
        var doc = cur.exists ? Object.assign({}, cur.data) : { type: type, key: id, fields: {}, firstSeen: now };
        doc.fields = Object.assign({}, doc.fields || {}, clean);
        doc.display = Object.assign({}, doc.display || {}, clean);
        doc.updatedBy = ctx.viewer || null;
        doc.updatedAt = now;
        return save(ctx.store, ctx.viewer, path, doc, shared);
      }).then(function () {
        // The db offers no partial update and the page write carries no version pin (db.d.ts:
        // last-writer-wins), so the read-modify-write above can lose a concurrent write to the same
        // doc. The re-read cannot bring a lost write back, but a doc whose stamps are not our
        // own says another writer landed just after us; that is worth a visible warning. Keep one
        // small document per fact and the race narrows to nothing.
        return ctx.store.get(path).then(function (back) {
          var msg = upsertStampConflict_(back.exists ? back.data : null, path, ctx.viewer || null, now);
          if (msg && globalThis.console && typeof globalThis.console.warn === "function") {
            try { globalThis.console.warn(msg); } catch (e) { /* a warned write stays saved */ }
          }
          return true;
        });
      }));
    },
  };
  var out = {};
  (Array.isArray(allowed) ? allowed : []).forEach(function (v) {
    if (VERBS.indexOf(v) !== -1) out[v] = all[v];
  });
  return out;
}

// Records of a saved-view shape ({type, filters, sort, window}) as [{id, data}]. A page slot gets every record the
// read returned and `capped` says whether the read stopped at its cap; a panel or record section keeps PANEL_MAX.
export function listView(store, view, all) {
  if (!view || !validId(view.type)) return Promise.resolve([]);
  return fullRead(store, "entities", { where: [["type", "==", view.type]] }).then(function (docs) {
    var byId = Object.create(null);
    var rows = docs.map(function (d) { byId[d.id] = d; return toRow(d, {}); });
    var fs = Object.assign(viewToFilterState(view), { now: new Date().toISOString() });
    var kept = applyFilters(rows, fs);
    var out = (all ? kept : kept.slice(0, PANEL_MAX)).map(function (r) { return { id: r.id, data: byId[r.id].data }; });
    out.capped = docs.capped === true || (!all && kept.length > PANEL_MAX);
    return out;
  });
}

export var PLACEMENTS = ["top", "after-summary", "after-fields"];
export var PREF_KEY_RE = /^[a-z0-9-]{1,40}$/;
export var PREF_MAX = 200;

export function placementOf(e) {
  return e && PLACEMENTS.indexOf(e.placement) !== -1 ? e.placement : "after-summary";
}

function prefStorage() {
  try { return globalThis.localStorage || null; } catch (e) { return null; }
}

// A viewer's own setting for one component, kept in this browser under routineos-ext:<id>:<key>. Never a db write.
// Every storage access is guarded: blocked storage reads as the fallback and a write is dropped. live is false in the
// read-only demo, where nothing is read or kept.
export function makePrefs(componentId, live) {
  function name(key) { return "routineos-ext:" + componentId + ":" + key; }
  return {
    pref: function (key, fallback) {
      if (!live || typeof key !== "string" || !PREF_KEY_RE.test(key)) return fallback;
      try {
        var s = prefStorage();
        var v = s ? s.getItem(name(key)) : null;
        return typeof v === "string" ? v : fallback;
      } catch (e) { return fallback; }
    },
    setPref: function (key, value) {
      if (typeof key !== "string" || !PREF_KEY_RE.test(key)) throw new Error("A setting key is 1 to 40 characters of a-z, 0-9 and -.");
      if (typeof value !== "string") throw new Error("A setting value is text.");
      if (value.length > PREF_MAX) throw new Error("A setting value is at most " + PREF_MAX + " characters.");
      if (!live) return;
      try { var s = prefStorage(); if (s) s.setItem(name(key), value); } catch (e) { /* blocked: the setting lasts this visit only */ }
    },
  };
}

// A spec block query run for a raw page (spec 17): the rows of query.type read as a spec page reads them, then evaluated
// as a spec block with that query gets them. With an aggregate the rows are evalQuery points (a tile or chart); without
// one they are tableRows. value is the aggregateTile value for a tile query (aggregate, no groupBy), else null.
export function runQuery(store, query) {
  if (!query || typeof query !== "object" || typeof query.type !== "string" || !query.type) {
    return Promise.reject(new Error("A query needs a type."));
  }
  return readSpecRows(store, { type: query.type }).then(function (out) {
    var at = { now: Date.now(), range: null, filter: null };
    if (!query.aggregate || typeof query.aggregate !== "object") return { rows: tableRows(out.rows, query, at), value: null };
    return {
      rows: evalQuery(out.rows, query, at).points,
      value: query.groupBy ? null : aggregateTile(out.rows, query, at).value,
    };
  });
}

// What a component sees: reads, a watch whose disposer the host also keeps, and the verbs.
// track(disposer) lets the host call every watch's disposer on unmount.
// opts: {id, prefs, slot, raw}. raw adds ctx.query. A component that did not declare prefs: true gets no pref or setPref.
export function extCtx(base, track, verbs, scope, opts) {
  var store = base.store;
  var out = {
    store: { get: function (p) { return store.get(p); }, list: function (c, q) { return store.list(c, q); } },
    viewer: base.viewer || null,
    canWrite: canWrite(base).ok,
    canComment: canComment(base).ok,
    read: function (id) {
      if (!validId(id)) return Promise.resolve(null);
      return store.get("entities/" + id).then(function (d) { return d.exists ? d.data : null; });
    },
    list: function (view) { return listView(store, view, !!(opts && opts.slot === "page")); },
    watch: function (collection, cb) {
      if (WATCHABLE.indexOf(collection) === -1 || typeof cb !== "function") throw new Error("Cannot watch " + collection);
      function safe(docs) {
        try { cb(docs); } catch (e) { /* a failing callback must not break the store */ }
      }
      // Comments sit under each person (people/<id>/comments); watchComments merges them, the author read from the path.
      var off = collection === "comments" ? watchComments(base, safe) : store.subscribe(collection, safe, {});
      var done = false;
      var dispose = function () { if (!done) { done = true; off(); } };
      track(dispose);
      return dispose;
    },
    actions: makeActions(base, verbs, scope),
  };
  // ctx.query is for raw pages only; a factory component's ctx is unchanged (spec X3).
  if (opts && opts.raw === true) out.query = function (query) { return runQuery(store, query); };
  if (opts && opts.prefs === true && validId(opts.id)) Object.assign(out, makePrefs(opts.id, !store.readOnly));
  return out;
}

// What each extension declared, copied and frozen once when the Desk loads. The host reads verbs and types from this
// copy, never from the live registry, so a later change to the global extension registry grants nothing. Not containment:
// code that runs before the copy is taken, or that replaces the copy's module, is outside what this can stop.
var DECLARED = Object.create(null);

export function snapshotExtensions(reg) {
  var snap = Object.create(null);
  Object.keys(reg || {}).forEach(function (id) {
    var e = reg[id];
    if (!e || typeof e !== "object") return;
    var copy = { slot: e.slot };
    if (Array.isArray(e.types)) copy.types = Object.freeze(e.types.filter(function (t) { return typeof t === "string"; }));
    if (e.view && typeof e.view.type === "string") copy.view = Object.freeze({ type: e.view.type });
    if (PLACEMENTS.indexOf(e.placement) !== -1) copy.placement = e.placement;
    if (e.prefs === true) copy.prefs = true;
    if (e.raw === true) copy.raw = true;
    copy.verbs = Object.freeze((Array.isArray(e.verbs) ? e.verbs : []).filter(function (v) { return VERBS.indexOf(v) !== -1; }));
    snap[id] = Object.freeze(copy);
  });
  DECLARED = Object.freeze(snap);
  return DECLARED;
}

export function declaredExtension(id) {
  return Object.prototype.hasOwnProperty.call(DECLARED, id) ? DECLARED[id] : null;
}

// The extensions a bundle registered, as [{id, slot, ...}] sorted by id; reg is the extension registry the bundle filled in.
export function extensionList(reg) {
  if (!reg) return [];
  return Object.keys(reg).sort().map(function (id) { return Object.assign({ id: id }, reg[id]); });
}

export function forSlot(reg, slot) {
  return extensionList(reg).filter(function (e) { return e.slot === slot; });
}

export function sectionsFor(reg, type) {
  return forSlot(reg, "record-section").filter(function (e) { return Array.isArray(e.types) && e.types.indexOf(type) !== -1; });
}

export function findPage(reg, name) {
  return forSlot(reg, "page").filter(function (e) { return e.id === name; })[0] || null;
}

export function navPages(reg) {
  return forSlot(reg, "page").filter(function (e) { return e.nav === true; });
}
