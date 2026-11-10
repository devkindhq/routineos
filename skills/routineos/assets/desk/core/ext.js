// core/ext.js: what an agent-written record section, panel or page may do (spec: Desk extensions).
// Pure and node-testable. A component gets ctx.actions (host verbs) and nothing else that writes: every verb checks
// canWrite and goes through actions.save, so the write allowlist applies. Not a sandbox.
import { canComment, canDecide, canWrite, decide, dropRecord, request, save, stamp, writeMessage } from "./actions.js";
import { commentPath, nextTs36, saveComment, watchComments } from "./comments.js";
import { COMPONENT_ATTRS, COMPONENT_TAGS, applyFilters, toRow } from "./pages/browse.js";
import { viewToFilterState } from "./pages/settings.js";
import { fullRead } from "./paging.js";

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
export var VERBS = ["decide", "comment", "saveField", "drop", "keep", "request"];

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

// What a component sees: reads, a watch whose disposer the host also keeps, and the verbs.
// track(disposer) lets the host call every watch's disposer on unmount.
// opts: {id, prefs, slot}. A component that did not declare prefs: true gets no pref or setPref.
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
