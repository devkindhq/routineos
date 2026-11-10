// core/pages/browse.js: one list per entity type (spec s8 item 3). One subscription per type,
// filtered client side; filter state lives in the hash query so back and shared links work.
import { shownReason } from "../actions.js";
import { viewToFilterState } from "./settings.js";
import { deskModules } from "../palette.js";
import { commentView } from "../record.js";

export var BROWSE_STEP = 100;
export var BROWSE_WINDOWS = ["all", "week", "month", "last-month"];
export var BROWSE_META = { lastSeen: "Last seen", firstSeen: "First seen", seenCount: "Times seen", status: "Status", dropReason: "Drop reason" };
// Columns the preview table has beyond a type's own fields; each reads a property of the flattened row.
export var EXTRA_COLS = { notes: "Notes", capturedAt: "Captured", commentCount: "Comments", decision: "Decision", owner: "Owner" };
export var BROWSE_DEFAULT_SORT = { field: "lastSeen", dir: "desc" };

export var HEALTH_TONES = ["red", "yellow", "green"];

// The Decision column text: the store's decision doc says keep or drop (the field is `decision`, or `kind`).
export function decisionLabel(d) {
  var k = d && (d.decision || d.kind);
  return k === "keep" ? "Kept" : k === "drop" ? "Dropped" : "Pending";
}

export function browseText(v) {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.map(browseText).join(", ");
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// One entity doc plus the viewer-shared userstate, flattened for filtering. Search text is built once here.
export function toRow(doc, us) {
  var d = doc.data || {};
  us = us || {};
  var f = Object.assign({}, d.display || {});
  var a = Object.assign({}, d.agentFields || {});
  var words = [doc.id, d.key || ""];
  Object.keys(f).forEach(function (k) { words.push(browseText(f[k])); });
  Object.keys(a).forEach(function (k) { words.push(browseText(a[k])); });
  var row = {
    id: doc.id, key: d.key, status: d.status || "active", dropReason: d.dropReason || "",
    sources: d.sources || [], firstSeen: d.firstSeen, lastSeen: d.lastSeen, seenCount: d.seenCount,
    f: f, a: a, star: !!us.star, tags: us.tags || [], note: us.note || "",
    text: words.join(" ").toLowerCase(),
  };
  if (d.capture && Array.isArray(d.capture.notes)) row.notes = d.capture.notes.length;
  if (d.capture && d.capture.capturedAt) row.capturedAt = d.capture.capturedAt;
  return row;
}

export function rowValue(row, key) {
  if (row.f && Object.prototype.hasOwnProperty.call(row.f, key)) return row.f[key];
  if (row.a && Object.prototype.hasOwnProperty.call(row.a, key)) return row.a[key];
  return Object.prototype.hasOwnProperty.call(BROWSE_META, key) || Object.prototype.hasOwnProperty.call(EXTRA_COLS, key) ? row[key] : undefined;
}

export function missing(v) {
  return v === undefined || v === null || v === "";
}

export function compareCells(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  var x = browseText(a), y = browseText(b);
  return x === y ? 0 : (x < y ? -1 : 1);
}

export function monthOf(ms) {
  return new Date(ms).toISOString().slice(0, 7);
}

export function inWindow(lastSeen, win, nowMs) {
  if (!win || win === "all") return true;
  var t = Date.parse(lastSeen);
  if (isNaN(t)) return false;
  if (win === "week") return t >= nowMs - 7 * 864e5 && t <= nowMs;
  var now = new Date(nowMs);
  if (win === "month") return monthOf(t) === monthOf(nowMs);
  if (win === "last-month") return monthOf(t) === monthOf(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return true;
}

// Pure: returns a new array, never touches `rows`. fs fields all optional; `now` is an ISO string.
export function applyFilters(rows, fs) {
  fs = fs || {};
  var terms = String(fs.q || "").toLowerCase().split(/\s+/).filter(Boolean);
  var nowMs = fs.now ? Date.parse(fs.now) : Date.now();
  var fields = fs.fields || {};
  var fieldKeys = Object.keys(fields).filter(function (k) { return fields[k] !== ""; });
  // A view module's fixed scope: a row needs any one of its tags and any one of its sources.
  var scopeTag = (fs.scope && fs.scope.tag) || [], scopeSource = (fs.scope && fs.scope.source) || [];
  var out = rows.filter(function (r) {
    for (var i = 0; i < terms.length; i++) if (r.text.indexOf(terms[i]) === -1) return false;
    if (fs.status && fs.status !== "all" && r.status !== fs.status) return false;
    if (fs.starred && !r.star) return false;
    if (fs.tag && r.tags.indexOf(fs.tag) === -1) return false;
    if (fs.source && r.sources.indexOf(fs.source) === -1) return false;
    if (fs.reason && r.dropReason !== fs.reason) return false;
    if (fs.health && fs.healthRule && healthOf(fs.healthRule, r) !== fs.health) return false;
    if (scopeTag.length && !scopeTag.some(function (x) { return r.tags.indexOf(x) !== -1; })) return false;
    if (scopeSource.length && !scopeSource.some(function (x) { return r.sources.indexOf(x) !== -1; })) return false;
    if (!inWindow(r.lastSeen, fs.window, nowMs)) return false;
    for (var j = 0; j < fieldKeys.length; j++) {
      var v = rowValue(r, fieldKeys[j]);
      var want = fields[fieldKeys[j]];
      var hit = Array.isArray(v) ? v.some(function (x) { return String(x) === want; }) : !missing(v) && String(v) === want;
      if (!hit) return false;
    }
    return true;
  });
  var sort = fs.sort || BROWSE_DEFAULT_SORT;
  var dir = sort.dir === "asc" ? 1 : -1;
  return out.sort(function (x, y) {
    var a = rowValue(x, sort.field), b = rowValue(y, sort.field);
    var ma = missing(a), mb = missing(b);
    if (ma || mb) return ma && mb ? (x.id < y.id ? -1 : 1) : (ma ? 1 : -1);
    return dir * compareCells(a, b) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
  });
}

// A row's tone under a desk.health rule ({field, red, yellow, green}): "red", "yellow", "green" or null.
export function healthOf(rule, r) {
  var v = rowValue(r, rule.field), x = missing(v) ? null : String(v);
  return x === null ? null : HEALTH_TONES.filter(function (h) { return (rule[h] || []).map(String).indexOf(x) !== -1; })[0] || null;
}

// How many of rows are not green under a desk.health rule; null when there is no rule.
export function notGreenCount(rule, rows) {
  if (!rule || !rule.field) return null;
  return (rows || []).filter(function (r) { return healthOf(rule, r) !== "green"; }).length;
}

export function notGreenLine(n) {
  return n + (n === 1 ? " item" : " items") + " not green yet";
}

// The Items list's chip row: desk.health for the type when declared, else its first summary choice field, else none.
export function chipSource(definition, type) {
  var h = definition && definition.desk && definition.desk.health && definition.desk.health[type];
  if (h && h.field) return { kind: "health", field: h.field, rule: h };
  var fields = (definition && definition.types && definition.types[type] && definition.types[type].fields) || {};
  var k = Object.keys(fields).filter(function (x) { return fields[x].type === "choice" && fields[x].summary && (fields[x].choices || []).length; })[0];
  return k ? { kind: "choice", field: k, choices: fields[k].choices.slice() } : null;
}

// Desk v2: what a person's decision does to a record's status before the producer's next run applies it.
export function overlayStatus(status, decision) {
  var dec = decision && decision.decision;
  if (status === "dropped") return dec === "keep" ? "kept-pending" : "dropped";
  return dec === "drop" ? "drop-pending" : "active";
}

// Fetches pages until `size` rows pass `keep` or the store runs out. fetch() gives {rows, done}.
export function fillPage(fetch, keep, size) {
  var out = [];
  function step() {
    return fetch().then(function (page) {
      page.rows.forEach(function (r) { if (keep(r)) out.push(r); });
      if (page.done || out.length >= size) return { rows: out, done: !!page.done };
      return step();
    });
  }
  return step();
}

export var PAGED_SORTS = ["lastSeen", "firstSeen", "seenCount"];

// The store filters and sorts top-level fields only, so only meta filters stay on the paged path.
// Browse waits this long after a change to the type's records before it reads the list again.
export var CHANGE_SETTLE_MS = 300;

export function needsFullRead(fs) {
  if (fs.q || fs.starred || fs.tag || fs.source || fs.health) return true;
  if (fs.scope && ((fs.scope.tag || []).length || (fs.scope.source || []).length)) return true;
  if (Object.keys(fs.fields || {}).some(function (k) { return fs.fields[k] !== ""; })) return true;
  var sort = fs.sort || BROWSE_DEFAULT_SORT;
  if (PAGED_SORTS.indexOf(sort.field) === -1) return true;
  return !!fs.window && fs.window !== "all" && sort.field !== "lastSeen";
}

export function windowRange(win, nowMs) {
  var now = new Date(nowMs);
  var month = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  if (win === "week") return [[">=", new Date(nowMs - 7 * 864e5).toISOString()], ["<=", now.toISOString()]];
  if (win === "month") return [[">=", new Date(month).toISOString()]];
  if (win === "last-month") return [[">=", new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString()], ["<", new Date(month).toISOString()]];
  return [];
}

// The store query for the paged path: type, status, drop reason and the last-seen window.
export function pagedBase(type, fs, now) {
  var w = [["type", "==", type]];
  if (fs.status && fs.status !== "all") w.push(["status", "==", fs.status]);
  if (fs.reason) w.push(["dropReason", "==", fs.reason]);
  windowRange(fs.window, now ? Date.parse(now) : Date.now()).forEach(function (r) { w.push(["lastSeen", r[0], r[1]]); });
  return { where: w };
}

export function readFilterState(q) {
  q = q || {};
  var fs = {
    q: q.q || "",
    // Dropped records are hidden by default; status=all in the hash shows them.
    status: q.status === "all" || q.status === "dropped" ? q.status : "active",
    starred: q.starred === "1",
    tag: q.tag || "",
    source: q.source || "",
    reason: q.reason || "",
    health: HEALTH_TONES.indexOf(q.health) !== -1 ? q.health : "",
    window: BROWSE_WINDOWS.indexOf(q.window) !== -1 ? q.window : "all",
    fields: {},
    sort: { field: BROWSE_DEFAULT_SORT.field, dir: BROWSE_DEFAULT_SORT.dir },
    group: q.group || "",
    cols: q.cols ? q.cols.split(",").filter(Boolean) : null,
  };
  if (q.calc) fs.calc = String(q.calc);
  Object.keys(q).forEach(function (k) { if (k.slice(0, 2) === "f." && q[k] !== "") fs.fields[k.slice(2)] = q[k]; });
  if (q.sort) {
    var i = q.sort.lastIndexOf(":");
    var field = i === -1 ? q.sort : q.sort.slice(0, i);
    if (field) fs.sort = { field: field, dir: q.sort.slice(i + 1) === "asc" ? "asc" : "desc" };
  }
  return fs;
}

// Only what differs from the defaults is written, so a fresh list has a bare hash.
export function writeFilterState(fs) {
  var p = new URLSearchParams();
  if (fs.q) p.set("q", fs.q);
  if (fs.status && fs.status !== "active") p.set("status", fs.status);
  if (fs.starred) p.set("starred", "1");
  if (fs.tag) p.set("tag", fs.tag);
  if (fs.source) p.set("source", fs.source);
  if (fs.reason) p.set("reason", fs.reason);
  if (fs.health) p.set("health", fs.health);
  if (fs.window && fs.window !== "all") p.set("window", fs.window);
  Object.keys(fs.fields || {}).sort().forEach(function (k) { if (fs.fields[k] !== "") p.set("f." + k, fs.fields[k]); });
  var s = fs.sort || BROWSE_DEFAULT_SORT;
  if (s.field !== BROWSE_DEFAULT_SORT.field || s.dir !== BROWSE_DEFAULT_SORT.dir) p.set("sort", s.field + ":" + s.dir);
  if (fs.group) p.set("group", fs.group);
  if (fs.calc) p.set("calc", fs.calc);
  if (fs.cols) p.set("cols", fs.cols.join(","));
  return p.toString();
}

// Spreadsheet-safe CSV: RFC 4180 quoting, and text starting with = + - @ tab or carriage return
// (after any leading spaces) is prefixed with ' so it opens as text, not a formula. Numbers stay numbers.
export function csvCell(v) {
  if (v === undefined || v === null) return "";
  var s;
  if (typeof v === "number" || typeof v === "boolean") s = String(v);
  else {
    s = Array.isArray(v) ? v.map(function (x) { return x === null || x === undefined ? "" : String(x); }).join("; ") : String(v);
    if (/^[=+\-@\t\r]/.test(s.replace(/^[ ]+/, ""))) s = "'" + s;
  }
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCsv(rows, cols) {
  var lines = [cols.map(function (c) { return csvCell(c.label); }).join(",")];
  rows.forEach(function (r) { lines.push(cols.map(function (c) { return csvCell(r[c.key]); }).join(",")); });
  return lines.join("\r\n") + "\r\n";
}

export function browseColumns(t, columnDocs, type) {
  var fields = t.fields || {};
  var keys = (t.order || []).filter(function (k) { return k in fields; });
  Object.keys(fields).forEach(function (k) { if (keys.indexOf(k) === -1) keys.push(k); });
  var cols = keys.map(function (k) {
    return { key: k, label: (t.fields[k] && t.fields[k].label) || k, type: (t.fields[k] || {}).type, summary: !!(t.fields[k] || {}).summary };
  });
  (columnDocs || []).forEach(function (c) {
    var key = c.data.field || c.data.name;
    if (c.data.type === type && c.data.state === "kept" && key && !cols.some(function (x) { return x.key === key; })) {
      cols.push({ key: key, label: c.data.name || key, agent: c.data.producer || "agent" });
    }
  });
  Object.keys(BROWSE_META).forEach(function (k) { cols.push({ key: k, label: BROWSE_META[k], meta: true }); });
  return cols;
}

export function defaultCols(all) {
  var summary = all.filter(function (c) { return c.summary; });
  var pick = (summary.length ? summary : all.filter(function (c) { return !c.meta && !c.agent; })).slice(0, 3);
  return pick.map(function (c) { return c.key; }).concat(["lastSeen"]);
}

// Footer calculations: calc=<field>:<fn>, comma separated. Only known columns and known functions survive, so a
// hostile or stale value draws nothing.
export var CALC_FNS = { count: "Count", empty: "Empty", filled: "Filled", unique: "Unique", sum: "Sum", avg: "Average", min: "Min", max: "Max" };
export var CALC_NUMERIC = ["sum", "avg", "min", "max"];
export function parseCalc(value, cols) {
  var out = [], seen = {};
  String(value || "").split(",").forEach(function (part) {
    var i = part.lastIndexOf(":");
    if (i < 1 || seen[part]) return;
    var field = part.slice(0, i), fn = part.slice(i + 1);
    if (cols.indexOf(field) === -1 || !Object.prototype.hasOwnProperty.call(CALC_FNS, fn)) return;
    seen[part] = true;
    out.push({ field: field, fn: fn });
  });
  return out;
}
export function calcValue(rows, c) {
  var vals = rows.map(function (r) { return rowValue(r, c.field); });
  var present = vals.filter(function (v) { return !missing(v); });
  var fmt = function (n) { return Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 }); };
  if (c.fn === "count") return fmt(vals.length);
  if (c.fn === "empty") return fmt(vals.length - present.length);
  if (c.fn === "filled") return fmt(present.length);
  if (c.fn === "unique") return fmt(new Set(present.map(browseText)).size);
  var nums = present.map(function (v) { return typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : v; })
    .filter(function (v) { return typeof v === "number" && isFinite(v); });
  if (!nums.length) return "";
  if (c.fn === "sum") return fmt(nums.reduce(function (a, b) { return a + b; }, 0));
  if (c.fn === "avg") return fmt(nums.reduce(function (a, b) { return a + b; }, 0) / nums.length);
  return fmt(c.fn === "min" ? Math.min.apply(null, nums) : Math.max.apply(null, nums));
}

// First-run words for a type: which producers write it and which settings shape it.
// settingFilters is the compiled list [{producer, setting, field}].
export function browseFirstRun(definition, type) {
  var t = (definition && definition.types && definition.types[type]) || {};
  var sources = ((definition && definition.producers) || []).filter(function (p) {
    return (p.types || []).indexOf(type) !== -1;
  }).map(function (p) { return p.label || p.id; });
  var settings = [];
  (t.settingFilters || []).forEach(function (f) { if (f && f.setting && settings.indexOf(f.setting) === -1) settings.push(f.setting); });
  return { sources: sources, settings: settings };
}

export var WINDOW_LABELS = { week: "Past 7 days", month: "This month", "last-month": "Last month" };
export var BROWSE_STATUSES = [["active", "Active"], ["dropped", "Dropped"], ["all", "All"]];

// Items filter row. Health values read as the preview words; counts show only when a full read holds them.
export var HEALTH_LABELS = { red: "Needs action", yellow: "Check", green: "All good" };
export var HEALTH_DOTS = { red: "red", yellow: "yellow", green: "green" };
export var AUTO_FULL_MAX = 2000;
export function autoFullRead(total) { return total <= AUTO_FULL_MAX; }
export function countText(n) { return Number(n).toLocaleString("en-US"); }
// Descriptors for the status pills: "All" then one per health value. counts is { all, red, yellow, green } or null.
export function statusPills(state, counts) {
  var cur = (state && state.health) || "";
  return [{ value: "", label: "All", dot: null }].concat(HEALTH_TONES.map(function (h) {
    return { value: h, label: HEALTH_LABELS[h], dot: HEALTH_DOTS[h] };
  })).map(function (p) {
    var n = counts ? (p.value ? counts[p.value] : counts.all) : null;
    return { value: p.value, label: p.label, dot: p.dot, count: n === null || n === undefined ? null : countText(n), pressed: cur === p.value };
  });
}
export function pillText(p) { return p.label + (p.count === null || p.count === undefined ? "" : p.count); }
export var PENDING_DROP_MAX = 200;
export var CONFIRM_NAMES = 5;
export var BULK_ON_PERSON_STATE = ["tag", "untag", "star", "unstar"];

// Desk v2 overlay on a flattened row. Active holds only records no one has dropped; a drop or a keep that waits
// for the next run sits under Dropped with its overlay word. Returns a new row.
export function overlayRow(row, decision) {
  var o = overlayStatus(row.status, decision);
  var out = Object.assign({}, row, { overlay: o, status: o === "active" ? "active" : "dropped" });
  if (o === "drop-pending" && decision.reason) out.dropReason = shownReason(decision.reason);
  return out;
}

// The userstate doc after one bulk change. Never changes `cur`.
export function userstateAfter(cur, kind, value) {
  var d = Object.assign({}, cur || {});
  var tags = (d.tags || []).slice();
  if (kind === "tag") { if (tags.indexOf(value) === -1) tags.push(value); d.tags = tags; }
  else if (kind === "untag") d.tags = tags.filter(function (x) { return x !== value; });
  else if (kind === "star") d.star = true;
  else if (kind === "unstar") d.star = false;
  else throw new Error("unknown bulk change: " + kind);
  return d;
}

// One removable chip per filter that narrows the list (status has its own chips). sourceLabel names a producer.
export function filterChips(fs, t, sourceLabel) {
  var chips = [];
  var fields = (t && t.fields) || {};
  if (fs.q) chips.push({ key: "q", label: "Search: " + fs.q });
  if (fs.starred) chips.push({ key: "starred", label: "Starred" });
  if (fs.tag) chips.push({ key: "tag", label: "Tag: " + fs.tag });
  if (fs.source) chips.push({ key: "source", label: "Source: " + (sourceLabel ? sourceLabel(fs.source) : fs.source) });
  if (fs.reason) chips.push({ key: "reason", label: "Drop reason: " + fs.reason });
  if (fs.health) chips.push({ key: "health", label: "Health: " + fs.health });
  if (fs.window && fs.window !== "all") chips.push({ key: "window", label: "Last seen: " + WINDOW_LABELS[fs.window] });
  Object.keys(fs.fields || {}).sort().forEach(function (k) {
    if (fs.fields[k] !== "") chips.push({ key: "f." + k, label: ((fields[k] && fields[k].label) || k) + ": " + fs.fields[k] });
  });
  return chips;
}

// A view module's fixed tag and source lists. A single string is a one item list; anything not a string is dropped.
export function scopeOf(module) {
  var f = (module && module.view && module.view.filters) || {};
  function list(v) {
    var a = typeof v === "string" ? [v] : Array.isArray(v) ? v : [];
    return a.filter(function (x) { return typeof x === "string" && x !== ""; });
  }
  return { tag: list(f.tag), source: list(f.source) };
}

// The module's scope as chips with no remove control (no key, so removeChip never sees them).
export function scopeChips(scope, sourceLabel) {
  var out = [];
  if (scope && scope.tag.length) out.push({ label: "Tag: " + scope.tag.join(" or "), fixed: true });
  if (scope && scope.source.length) {
    out.push({ label: "Source: " + scope.source.map(function (p) { return sourceLabel ? sourceLabel(p) : p; }).join(" or "), fixed: true });
  }
  return out;
}

// One line for the save dialog on a module page: a saved view does not keep the module's fixed scope.
export function scopeSaveNote(scope, sourceLabel) {
  var chips = scopeChips(scope, sourceLabel);
  if (!chips.length) return "";
  return "A saved view keeps the filters above, not this page's fixed " + chips.map(function (c) { return c.label; }).join(" and ") + ".";
}

// A module opened with no query starts from its view, as ?view= does, less the tag and source its scope holds.
export function moduleStartState(module) {
  var v = Object.assign({}, (module && module.view) || {});
  var f = Object.assign({}, v.filters || {});
  delete f.tag;
  delete f.source;
  v.filters = f;
  return viewToFilterState(v);
}

export function removeChip(fs, key) {
  var out = Object.assign({}, fs, { fields: Object.assign({}, fs.fields || {}) });
  if (key.slice(0, 2) === "f.") delete out.fields[key.slice(2)];
  else if (key === "starred") out.starred = false;
  else if (key === "window") out.window = "all";
  else out[key] = "";
  return out;
}

// A full read knows every count; a paged list knows only what it has shown and whether the store has more.
export function countLine(c, plural) {
  if (c.full) return "Showing " + c.shown + " of " + c.matching + " matching " + plural + " (" + c.total + " in all)";
  return (c.done ? "Showing all " : "Showing the first ") + c.shown + " " + plural;
}

// Comments per record id, counting what the thread shows (commentView: originals with a valid author, not deleted).
export function commentCounts(docs) {
  var by = {}, out = {};
  (docs || []).forEach(function (c) { var e = c.data && c.data.entity; if (e) (by[e] = by[e] || []).push(c); });
  Object.keys(by).forEach(function (e) { var n = commentView(by[e], null, 0).length; if (n) out[e] = n; });
  return out;
}

// Field cell components: {field: componentId} from the `fields` maps of every view module on this type.
export function fieldRenderers(definition, typeId) {
  var out = {};
  deskModules(definition).forEach(function (m) {
    if (m.view.type !== typeId || !m.fields || typeof m.fields !== "object") return;
    Object.keys(m.fields).forEach(function (k) { if (typeof m.fields[k] === "string") out[k] = m.fields[k]; });
  });
  return out;
}

// What a component may read: store.get and store.list, nothing else of the store or the page.
export function componentCtx(store) {
  return { store: {
    get: function (path) { return store.get(path); },
    list: function (collection, query) { return store.list(collection, query); },
  } };
}

// The ui a component builds with: a restricted el and the core factories without click handlers. A refused
// tag or attribute throws, so renderField draws the fallback. This narrows the API; it is not a sandbox.
export var COMPONENT_TAGS = ["span", "div", "p", "b", "strong", "i", "em", "small", "code", "a", "ul", "ol", "li", "dl", "dt",
  "dd", "time", "abbr", "mark", "s", "sub", "sup", "data", "br"];
export var COMPONENT_ATTRS = ["class", "title", "href", "datetime", "value", "lang", "dir"];
export function componentAttr(name) {
  return COMPONENT_ATTRS.indexOf(name) !== -1 || /^(aria|data)-[a-z0-9-]*[a-z0-9]$/.test(name);
}
