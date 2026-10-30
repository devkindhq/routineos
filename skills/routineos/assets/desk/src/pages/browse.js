/* src/pages/browse.js: one list per entity type (spec s8 item 3). One subscription per type,
   filtered client side; filter state lives in the hash query so back and shared links work. */

var BROWSE_STEP = 100;
var BROWSE_WINDOWS = ["all", "week", "month", "last-month"];
var BROWSE_META = { lastSeen: "Last seen", firstSeen: "First seen", seenCount: "Times seen", status: "Status", dropReason: "Drop reason" };
var BROWSE_DEFAULT_SORT = { field: "lastSeen", dir: "desc" };

function browseText(v) {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.map(browseText).join(", ");
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// One entity doc plus the viewer-shared userstate, flattened for filtering. Search text is built once here.
function toRow(doc, us) {
  var d = doc.data || {};
  us = us || {};
  var f = Object.assign({}, d.display || {});
  var a = Object.assign({}, d.agentFields || {});
  var words = [doc.id, d.key || ""];
  Object.keys(f).forEach(function (k) { words.push(browseText(f[k])); });
  Object.keys(a).forEach(function (k) { words.push(browseText(a[k])); });
  return {
    id: doc.id, key: d.key, status: d.status || "active", dropReason: d.dropReason || "",
    sources: d.sources || [], firstSeen: d.firstSeen, lastSeen: d.lastSeen, seenCount: d.seenCount,
    f: f, a: a, star: !!us.star, tags: us.tags || [], note: us.note || "",
    text: words.join(" ").toLowerCase(),
  };
}

function rowValue(row, key) {
  if (row.f && Object.prototype.hasOwnProperty.call(row.f, key)) return row.f[key];
  if (row.a && Object.prototype.hasOwnProperty.call(row.a, key)) return row.a[key];
  return Object.prototype.hasOwnProperty.call(BROWSE_META, key) ? row[key] : undefined;
}

function missing(v) {
  return v === undefined || v === null || v === "";
}

function compareCells(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  var x = browseText(a), y = browseText(b);
  return x === y ? 0 : (x < y ? -1 : 1);
}

function monthOf(ms) {
  return new Date(ms).toISOString().slice(0, 7);
}

function inWindow(lastSeen, win, nowMs) {
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
function applyFilters(rows, fs) {
  fs = fs || {};
  var terms = String(fs.q || "").toLowerCase().split(/\s+/).filter(Boolean);
  var nowMs = fs.now ? Date.parse(fs.now) : Date.now();
  var fields = fs.fields || {};
  var fieldKeys = Object.keys(fields).filter(function (k) { return fields[k] !== ""; });
  var out = rows.filter(function (r) {
    for (var i = 0; i < terms.length; i++) if (r.text.indexOf(terms[i]) === -1) return false;
    if (fs.status && fs.status !== "all" && r.status !== fs.status) return false;
    if (fs.starred && !r.star) return false;
    if (fs.tag && r.tags.indexOf(fs.tag) === -1) return false;
    if (fs.source && r.sources.indexOf(fs.source) === -1) return false;
    if (fs.reason && r.dropReason !== fs.reason) return false;
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

// Desk v2: what a person's decision does to a record's status before the producer's next run applies it.
function overlayStatus(status, decision) {
  var dec = decision && decision.decision;
  if (status === "dropped") return dec === "keep" ? "kept-pending" : "dropped";
  return dec === "drop" ? "drop-pending" : "active";
}

// Fetches pages until `size` rows pass `keep` or the store runs out. fetch() gives {rows, done}.
function fillPage(fetch, keep, size) {
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

var PAGED_SORTS = ["lastSeen", "firstSeen", "seenCount"];

// The store filters and sorts top-level fields only, so only meta filters stay on the paged path.
function needsFullRead(fs) {
  if (fs.q || fs.starred || fs.tag || fs.source) return true;
  if (Object.keys(fs.fields || {}).some(function (k) { return fs.fields[k] !== ""; })) return true;
  var sort = fs.sort || BROWSE_DEFAULT_SORT;
  if (PAGED_SORTS.indexOf(sort.field) === -1) return true;
  return !!fs.window && fs.window !== "all" && sort.field !== "lastSeen";
}

function windowRange(win, nowMs) {
  var now = new Date(nowMs);
  var month = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  if (win === "week") return [[">=", new Date(nowMs - 7 * 864e5).toISOString()], ["<=", now.toISOString()]];
  if (win === "month") return [[">=", new Date(month).toISOString()]];
  if (win === "last-month") return [[">=", new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString()], ["<", new Date(month).toISOString()]];
  return [];
}

// The store query for the paged path: type, status, drop reason and the last-seen window.
function pagedBase(type, fs, now) {
  var w = [["type", "==", type]];
  if (fs.status && fs.status !== "all") w.push(["status", "==", fs.status]);
  if (fs.reason) w.push(["dropReason", "==", fs.reason]);
  windowRange(fs.window, now ? Date.parse(now) : Date.now()).forEach(function (r) { w.push(["lastSeen", r[0], r[1]]); });
  return { where: w };
}

function readFilterState(q) {
  q = q || {};
  var fs = {
    q: q.q || "",
    // Dropped records are hidden by default; status=all in the hash shows them.
    status: q.status === "all" || q.status === "dropped" ? q.status : "active",
    starred: q.starred === "1",
    tag: q.tag || "",
    source: q.source || "",
    reason: q.reason || "",
    window: BROWSE_WINDOWS.indexOf(q.window) !== -1 ? q.window : "all",
    fields: {},
    sort: { field: BROWSE_DEFAULT_SORT.field, dir: BROWSE_DEFAULT_SORT.dir },
    group: q.group || "",
    cols: q.cols ? q.cols.split(",").filter(Boolean) : null,
  };
  Object.keys(q).forEach(function (k) { if (k.slice(0, 2) === "f." && q[k] !== "") fs.fields[k.slice(2)] = q[k]; });
  if (q.sort) {
    var i = q.sort.lastIndexOf(":");
    var field = i === -1 ? q.sort : q.sort.slice(0, i);
    if (field) fs.sort = { field: field, dir: q.sort.slice(i + 1) === "asc" ? "asc" : "desc" };
  }
  return fs;
}

// Only what differs from the defaults is written, so a fresh list has a bare hash.
function writeFilterState(fs) {
  var p = new URLSearchParams();
  if (fs.q) p.set("q", fs.q);
  if (fs.status && fs.status !== "active") p.set("status", fs.status);
  if (fs.starred) p.set("starred", "1");
  if (fs.tag) p.set("tag", fs.tag);
  if (fs.source) p.set("source", fs.source);
  if (fs.reason) p.set("reason", fs.reason);
  if (fs.window && fs.window !== "all") p.set("window", fs.window);
  Object.keys(fs.fields || {}).sort().forEach(function (k) { if (fs.fields[k] !== "") p.set("f." + k, fs.fields[k]); });
  var s = fs.sort || BROWSE_DEFAULT_SORT;
  if (s.field !== BROWSE_DEFAULT_SORT.field || s.dir !== BROWSE_DEFAULT_SORT.dir) p.set("sort", s.field + ":" + s.dir);
  if (fs.group) p.set("group", fs.group);
  if (fs.cols) p.set("cols", fs.cols.join(","));
  return p.toString();
}

// Spreadsheet-safe CSV: RFC 4180 quoting, and text starting with = + - @ tab or carriage return
// (after any leading spaces) is prefixed with ' so it opens as text, not a formula. Numbers stay numbers.
function csvCell(v) {
  if (v === undefined || v === null) return "";
  var s;
  if (typeof v === "number" || typeof v === "boolean") s = String(v);
  else {
    s = Array.isArray(v) ? v.map(function (x) { return x === null || x === undefined ? "" : String(x); }).join("; ") : String(v);
    if (/^[=+\-@\t\r]/.test(s.replace(/^[ ]+/, ""))) s = "'" + s;
  }
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCsv(rows, cols) {
  var lines = [cols.map(function (c) { return csvCell(c.label); }).join(",")];
  rows.forEach(function (r) { lines.push(cols.map(function (c) { return csvCell(r[c.key]); }).join(",")); });
  return lines.join("\r\n") + "\r\n";
}

function browseColumns(t, columnDocs, type) {
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

function defaultCols(all) {
  var summary = all.filter(function (c) { return c.summary; });
  var pick = (summary.length ? summary : all.filter(function (c) { return !c.meta && !c.agent; })).slice(0, 3);
  return pick.map(function (c) { return c.key; }).concat(["lastSeen"]);
}

function labelled(text, control) {
  return el("label", { class: "field" }, el("span", null, text), control);
}

function selectOf(options, value, onChange) {
  var s = el("select", null, options.map(function (o) {
    return el("option", { value: o[0], selected: o[0] === value }, o[1]);
  }));
  s.addEventListener("change", function () { onChange(s.value); });
  return s;
}

// First-run words for a type: which producers write it and which settings shape it.
// settingFilters is the compiled list [{producer, setting, field}].
function browseFirstRun(definition, type) {
  var t = (definition && definition.types && definition.types[type]) || {};
  var sources = ((definition && definition.producers) || []).filter(function (p) {
    return (p.types || []).indexOf(type) !== -1;
  }).map(function (p) { return p.label || p.id; });
  var settings = [];
  (t.settingFilters || []).forEach(function (f) { if (f && f.setting && settings.indexOf(f.setting) === -1) settings.push(f.setting); });
  return { sources: sources, settings: settings };
}

var WINDOW_LABELS = { week: "Past 7 days", month: "This month", "last-month": "Last month" };
var BROWSE_STATUSES = [["active", "Active"], ["dropped", "Dropped"], ["all", "All"]];
var PENDING_DROP_MAX = 200;
var CONFIRM_NAMES = 5;
var BULK_ON_PERSON_STATE = ["tag", "untag", "star", "unstar"];

// Desk v2 overlay on a flattened row. Active holds only records no one has dropped; a drop or a keep that waits
// for the next run sits under Dropped with its overlay word. Returns a new row.
function overlayRow(row, decision) {
  var o = overlayStatus(row.status, decision);
  var out = Object.assign({}, row, { overlay: o, status: o === "active" ? "active" : "dropped" });
  if (o === "drop-pending" && decision.reason) out.dropReason = shownReason(decision.reason);
  return out;
}

// The userstate doc after one bulk change. Never changes `cur`.
function userstateAfter(cur, kind, value) {
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
function filterChips(fs, t, sourceLabel) {
  var chips = [];
  var fields = (t && t.fields) || {};
  if (fs.q) chips.push({ key: "q", label: "Search: " + fs.q });
  if (fs.starred) chips.push({ key: "starred", label: "Starred" });
  if (fs.tag) chips.push({ key: "tag", label: "Tag: " + fs.tag });
  if (fs.source) chips.push({ key: "source", label: "Source: " + (sourceLabel ? sourceLabel(fs.source) : fs.source) });
  if (fs.reason) chips.push({ key: "reason", label: "Drop reason: " + fs.reason });
  if (fs.window && fs.window !== "all") chips.push({ key: "window", label: "Last seen: " + WINDOW_LABELS[fs.window] });
  Object.keys(fs.fields || {}).sort().forEach(function (k) {
    if (fs.fields[k] !== "") chips.push({ key: "f." + k, label: ((fields[k] && fields[k].label) || k) + ": " + fs.fields[k] });
  });
  return chips;
}

function removeChip(fs, key) {
  var out = Object.assign({}, fs, { fields: Object.assign({}, fs.fields || {}) });
  if (key.slice(0, 2) === "f.") delete out.fields[key.slice(2)];
  else if (key === "starred") out.starred = false;
  else if (key === "window") out.window = "all";
  else out[key] = "";
  return out;
}

// A full read knows every count; a paged list knows only what it has shown and whether the store has more.
function countLine(c, plural) {
  if (c.full) return "Showing " + c.shown + " of " + c.matching + " matching " + plural + " (" + c.total + " in all)";
  return (c.done ? "Showing all " : "Showing the first ") + c.shown + " " + plural;
}

function renderBrowse(outlet, ctx, params) {
  var type = params.type;
  var t = ctx.definition && ctx.definition.types && ctx.definition.types[type];
  if (!t) {
    append(outlet, el("div", { class: "page" }, el("h1", null, "Browse"), el("p", { class: "notice" }, "This workspace has no type called " + type + ".")));
    return function () {};
  }
  var plural = t.plural || t.label || type;
  var query = params.query || {};
  var fs = readFilterState(query);
  // ?view=<id> opens a saved or built-in view. Any other query keys mean the view was edited
  // after opening, so the hash wins over the stored filters.
  var viewId = query.view || "";
  var viewBase = null, viewBuiltIn = false;
  var viewOnly = Object.keys(query).every(function (k) { return k === "view"; });
  var live = true;
  var people = false;
  var us = {}, decided = {}, columnDocs = [];
  // Every record of this type once a full read has run (search, field filters, Count all, Select all matching,
  // Export). While it is held, the list filters it in the page and pages nothing from the store.
  var allDocs = null, fullLoading = null;
  var paged = { docs: [], pending: [], after: null, done: false, loaded: false, token: 0 };
  var limit = PAGE_SIZE;
  var rows = [], filtered = [], visible = [], rowIndex = {};
  var selected = new Set(), anchor = null, allMatching = false;
  var boxes = {}, headBox = null;
  var drawSeq = 0, timer = null, undoTimer = null;

  var search = el("input", { type: "search", value: fs.q, "aria-label": "Search " + plural, placeholder: "Search " + plural });
  search.addEventListener("input", function () {
    clearTimeout(timer);
    timer = setTimeout(function () { fs.q = search.value; changed(); }, 150);
  });
  var statusChips = el("div", { class: "chips status-chips", role: "group", "aria-label": "Status" });
  var chipBox = el("div", { class: "chips filter-chips" });
  var viewBox = el("details", { class: "panel view-menu" });
  var filterBox = el("details", { class: "panel filter-panel" });
  var colBox = el("details", { class: "panel" });
  var saveBox = el("details", { class: "panel" });
  var saveSummary = el("summary");
  var status = el("span", { class: "status", role: "status" });
  var exportArea = el("div");
  var exportBtn = button("Export", function () { openExport(); }, { icon: "download" });
  var bulkBar = el("div", { class: "bulk-bar", role: "region", "aria-label": "Bulk actions" });
  var bulkStatus = el("span", { class: "status", role: "status" });
  var undoBox = el("span");
  var confirmBox = el("div");
  var count = el("p", { class: "count muted", role: "status" });
  var countAll = button("Count all", function () {
    countAll.disabled = true;
    ensureFull().then(function () { countAll.disabled = false; drawResults(); }, readError);
  });
  var results = el("div", { class: "results" });
  bulkBar.hidden = true;
  append(outlet, el("div", { class: "page" },
    el("h1", null, plural),
    el("div", { class: "toolbar" }, search, viewBox, filterBox, colBox, saveBox,
      el("div", { class: "actions" }, exportBtn, el("a", { href: "#/views" }, "All views"), status)),
    statusChips, chipBox, exportArea, bulkBar,
    el("div", { class: "count-line" }, count, countAll), results));

  // Command palette entries for this list (spec "Command palette": save, update, rename a view).
  function openSave(select) {
    saveBox.open = true;
    var input = saveBox.querySelector("input");
    if (input) { input.focus(); if (select && input.select) input.select(); }
  }
  ctx.pageCommands = function () {
    var out = [{ id: "view:save", label: "Save view as new", run: function () { openSave(false); } }];
    if (viewBase && !viewBuiltIn && canEditView(viewBase, ctx.viewer)) {
      out.push({ id: "view:update", label: "Update view " + (viewBase.name || ""), run: function () {
        var b = Array.prototype.filter.call(saveBox.querySelectorAll("button"), function (x) { return x.textContent === "Update view"; })[0];
        openSave(false);
        if (b && !b.disabled) b.click();
      } });
      out.push({ id: "view:rename", label: "Rename view " + (viewBase.name || ""), run: function () { openSave(true); } });
    }
    return out;
  };

  function allCols() { return browseColumns(t, columnDocs, type); }
  function shownCols() {
    var all = allCols();
    var keys = fs.cols || defaultCols(all);
    return keys.map(function (k) { return all.filter(function (c) { return c.key === k; })[0]; }).filter(Boolean);
  }
  function full() { return !!allDocs || needsFullRead(fs); }
  function mapRow(d) { return overlayRow(toRow(d, us[d.id]), decided[d.id]); }

  function writeHash() {
    var qs = writeFilterState(fs);
    if (viewId) qs = "view=" + encodeURIComponent(viewId) + (qs ? "&" + qs : "");
    var h = "#/browse/" + encodeURIComponent(type) + (qs ? "?" + qs : "");
    // replaceState does not fire hashchange, so the page keeps focus and scroll while filtering.
    if (globalThis.history && history.replaceState) history.replaceState(null, "", h);
  }

  function readError() {
    if (!live) return;
    clear(results);
    append(results, stateView("read-error", { collection: plural, onRetry: ctx.retry }));
  }

  // ---- reading ----
  function ensureFull() {
    if (allDocs) return Promise.resolve(allDocs);
    if (!fullLoading) {
      fullLoading = fullRead(ctx.store, "entities", { where: [["type", "==", type]] }).then(function (docs) {
        fullLoading = null; allDocs = docs; return docs;
      }, function (e) { fullLoading = null; throw e; });
    }
    return fullLoading;
  }

  // A person's drops wait for the next run, so the store still has those records as active. Dropped lists them
  // by id from the decisions (at most PENDING_DROP_MAX).
  function loadPending() {
    if (fs.status !== "dropped") return Promise.resolve([]);
    var ids = Object.keys(decided).filter(function (id) {
      return decided[id] && decided[id].decision === "drop" && id.indexOf(type + "--") === 0;
    }).slice(0, PENDING_DROP_MAX);
    return Promise.all(ids.map(function (id) {
      return ctx.store.get("entities/" + id).then(function (d) {
        return d.exists && (d.data.status || "active") === "active" ? { id: id, data: d.data } : null;
      }, function () { return null; });
    })).then(function (list) { return list.filter(Boolean); });
  }

  // reset reads page 1 again and replaces what is shown only once it arrives, so a live change does not flash.
  function loadPaged(reset) {
    var token = ++paged.token;
    var base = pagedBase(type, fs);
    var sort = fs.sort;
    var after = reset ? null : paged.after;
    var hide = fs.status === "active";
    return (reset ? loadPending() : Promise.resolve(paged.pending)).then(function (pending) {
      return fillPage(function () {
        return nextPage(ctx.store, "entities", base, sort, after).then(function (p) { after = p.after; return p; });
      }, function (d) { return !(hide && decided[d.id] && decided[d.id].decision === "drop"); }, PAGE_SIZE).then(function (p) {
        if (!live || token !== paged.token) return;
        paged.docs = (reset ? [] : paged.docs).concat(p.rows);
        paged.pending = pending;
        paged.after = after;
        paged.done = p.done;
        paged.loaded = true;
        drawResults();
      });
    }).catch(function () { if (token === paged.token) readError(); });
  }

  function refreshFull() {
    return fullRead(ctx.store, "entities", { where: [["type", "==", type]] }).then(function (docs) {
      if (!live) return;
      allDocs = docs;
      drawResults();
    }, readError);
  }

  function reload() {
    selected.clear(); anchor = null; allMatching = false; limit = PAGE_SIZE;
    if (full()) {
      drawResults();
      ensureFull().then(function () { if (live) drawResults(); }, readError);
      return;
    }
    paged.loaded = false;
    drawResults();
    loadPaged(true);
  }

  function currentRows() {
    if (full()) return allDocs ? allDocs.map(mapRow) : null;
    if (!paged.loaded) return null;
    var seen = {};
    return paged.docs.concat(paged.pending).filter(function (d) {
      if (seen[d.id]) return false;
      seen[d.id] = true;
      return true;
    }).map(mapRow);
  }

  // ---- filters ----
  function changed() {
    writeHash();
    drawChips();
    drawSaveSummary();
    reload();
  }

  // Clears what narrows the list; sort, grouping and columns stay as chosen.
  function clearFilters() {
    fs = Object.assign(readFilterState({ status: "all" }), { sort: fs.sort, group: fs.group, cols: fs.cols });
    search.value = "";
    changed();
    drawFilters();
  }

  function distinct(get) {
    var seen = {};
    rows.forEach(function (r) { [].concat(get(r)).forEach(function (v) { if (!missing(v)) seen[String(v)] = true; }); });
    return Object.keys(seen).sort();
  }

  function drawStatusChips() {
    clear(statusChips);
    var n = { active: 0, dropped: 0, all: 0 };
    if (full() && allDocs) rows.forEach(function (r) { n[r.status]++; n.all++; });
    append(statusChips, BROWSE_STATUSES.map(function (s) {
      return chip(s[1] + (full() && allDocs ? " (" + n[s[0]] + ")" : ""), {
        pressed: fs.status === s[0],
        onClick: function () { if (fs.status !== s[0]) { fs.status = s[0]; changed(); drawFilters(); } },
      });
    }));
  }

  function drawChips() {
    clear(chipBox);
    var list = filterChips(fs, t, function (p) { return producerLabel(ctx.definition, p); });
    append(chipBox, list.map(function (c) {
      return el("button", { type: "button", class: "chip removable", "aria-label": "Remove filter " + c.label, onclick: function () {
        fs = removeChip(fs, c.key);
        if (c.key === "q") search.value = "";
        changed();
        drawFilters();
      } }, c.label, " ", icon("x"));
    }));
    if (list.length > 1) append(chipBox, button("Clear filters", clearFilters));
  }

  function drawFilters() {
    var open = filterBox.open;
    clear(filterBox);
    var choiceFields = Object.keys(t.fields || {}).filter(function (k) { return ["choice", "bool"].indexOf(t.fields[k].type) !== -1; });
    var starred = el("input", { type: "checkbox", checked: fs.starred });
    starred.addEventListener("change", function () { fs.starred = starred.checked; changed(); });
    append(filterBox, [
      el("summary", null, "Filters"),
      el("div", { class: "filters" },
        el("label", { class: "field check" }, starred, el("span", null, "Starred only")),
        labelled("Tag", selectOf([["", "Any"]].concat(distinct(function (r) { return r.tags; }).concat(fs.tag ? [fs.tag] : []).filter(function (v, i, a) { return a.indexOf(v) === i; }).map(function (v) { return [v, v]; })), fs.tag, function (v) { fs.tag = v; changed(); })),
        labelled("Source", selectOf([["", "Any"]].concat(((ctx.definition && ctx.definition.producers) || []).filter(function (p) {
          return (p.types || []).indexOf(type) !== -1;
        }).map(function (p) { return [p.id, p.label || p.id]; })), fs.source, function (v) { fs.source = v; changed(); })),
        labelled("Drop reason", selectOf([["", "Any"]].concat(distinct(function (r) { return r.dropReason; }).concat(fs.reason ? [fs.reason] : []).filter(function (v, i, a) { return a.indexOf(v) === i; }).map(function (v) { return [v, v]; })), fs.reason, function (v) { fs.reason = v; changed(); })),
        labelled("Last seen", selectOf([["all", "Any time"], ["week", "Past 7 days"], ["month", "This month"], ["last-month", "Last month"]], fs.window, function (v) { fs.window = v; changed(); })),
        choiceFields.map(function (k) {
          var values = t.fields[k].type === "bool" ? ["true", "false"] : ((t.fields[k].choices || []).length ? t.fields[k].choices.slice() : distinct(function (r) { return rowValue(r, k); }));
          if (fs.fields[k] && values.indexOf(fs.fields[k]) === -1) values = values.concat([fs.fields[k]]);
          return labelled((t.fields[k].label || k), selectOf([["", "Any"]].concat(values.map(function (v) { return [String(v), t.fields[k].type === "bool" ? (v === "true" ? "yes" : "no") : String(v)]; })), fs.fields[k] || "", function (v) {
            if (v) fs.fields[k] = v; else delete fs.fields[k];
            changed();
          }));
        }),
        labelled("Group by", selectOf([["", "None"]].concat(choiceFields.map(function (k) { return [k, t.fields[k].label || k]; })), fs.group, function (v) { fs.group = v; changed(); })),
        labelled("Sort by", selectOf(allCols().map(function (c) { return [c.key, c.label]; }), fs.sort.field, function (v) { fs.sort = { field: v, dir: fs.sort.dir }; changed(); })),
        labelled("Order", selectOf([["desc", "Descending"], ["asc", "Ascending"]], fs.sort.dir, function (v) { fs.sort = { field: fs.sort.field, dir: v }; changed(); }))),
    ]);
    filterBox.open = open;

    var colsOpen = colBox.open;
    clear(colBox);
    var shown = shownCols().map(function (c) { return c.key; });
    append(colBox, [el("summary", null, "Columns"), el("div", { class: "filters" }, allCols().map(function (c) {
      var box = el("input", { type: "checkbox", checked: shown.indexOf(c.key) !== -1 });
      box.addEventListener("change", function () {
        var keys = shownCols().map(function (x) { return x.key; }).filter(function (k) { return k !== c.key; });
        if (box.checked) keys.push(c.key);
        fs.cols = keys;
        changed();
      });
      return el("label", { class: "field check" }, box, el("span", null, c.label), c.agent ? agentBadge(producerLabel(ctx.definition, c.agent)) : null);
    }))]);
    colBox.open = colsOpen;
  }

  // ---- rows ----
  function overlayBadge(r) {
    if (r.overlay === "drop-pending") return badge("Drop pending", "warn");
    if (r.overlay === "kept-pending") return badge("Kept (pending next run)", "warn");
    if (r.overlay === "dropped") return badge("Dropped", "fail");
    return null;
  }

  function cell(c, r) {
    var v = rowValue(r, c.key);
    if (c.key === "lastSeen" || c.key === "firstSeen") return el("time", { datetime: v || null }, when(v));
    if (c.key === "status") return overlayBadge(r) || r.status;
    if (c.type === "url" && !missing(v)) return urlOrText(v);
    return browseText(v);
  }

  function rowTitle(r, cols) {
    var first = cols.filter(function (c) { return !c.meta; })[0];
    var v = first ? browseText(rowValue(r, first.key)) : "";
    return v || r.key || r.id;
  }

  function starButton(r, cols) {
    return starToggle(ctx, rowTitle(r, cols), r.star, function () {
      return save(ctx.store, ctx.viewer, "userstate/" + r.id, userstateAfter(us[r.id], r.star ? "unstar" : "star"));
    }, { status: status });
  }

  // A dropped row offers Restore: a person's pending drop is undone, a routine's drop is kept until its next run.
  function restoreControl(r, cols) {
    if (r.overlay === "kept-pending" || r.status !== "dropped") return null;
    return actionButton(ctx, "Restore", function () { return restoreRecord(ctx, r.id, decided[r.id]); },
      { status: status, icon: "check", title: "Restore " + rowTitle(r, cols), done: "Restored " + rowTitle(r, cols) + ". Applies from the next run." });
  }

  function selectBox(r, cols) {
    var b = el("input", { type: "checkbox", "aria-label": "Select " + rowTitle(r, cols) });
    b.checked = selected.has(r.id);
    b.addEventListener("click", function (e) {
      if (e.shiftKey && anchor && anchor !== r.id) rangeSelect(visible.map(function (x) { return x.id; }), anchor, r.id, selected);
      else if (b.checked) selected.add(r.id);
      else selected.delete(r.id);
      anchor = r.id;
      allMatching = false;
      syncSelection();
    });
    (boxes[r.id] = boxes[r.id] || []).push(b);
    return b;
  }

  function syncSelection() {
    Object.keys(boxes).forEach(function (id) { boxes[id].forEach(function (b) { b.checked = selected.has(id); }); });
    if (headBox) {
      var on = visible.filter(function (r) { return selected.has(r.id); }).length;
      headBox.checked = !!visible.length && on === visible.length;
      headBox.indeterminate = on > 0 && on < visible.length;
    }
    drawBulk();
  }

  function rowLabel(r) {
    return [overlayBadge(r) ? [" ", overlayBadge(r)] : null,
      r.status === "dropped" && r.dropReason ? [" ", el("span", { class: "muted" }, "Reason: " + r.dropReason)] : null];
  }

  function block(list, cols) {
    var statusShown = cols.some(function (c) { return c.key === "status"; });
    var phone = el("ul", { class: "rows only-phone" }, list.map(function (r) {
      return el("li", null,
        el("div", { class: "primary-field" }, selectBox(r, cols), " ", el("a", { href: entityHash(r.id) }, rowTitle(r, cols)), r.star ? " (starred)" : null),
        el("div", { class: "fields" },
          cols.slice(1).map(function (c) {
            var v = cell(c, r);
            return v === "" || v === null ? null : el("span", null, v);
          }),
          rowLabel(r)),
        el("div", { class: "actions" }, starButton(r, cols), restoreControl(r, cols)));
    }));
    headBox = el("input", { type: "checkbox", "aria-label": "Select all shown" });
    headBox.addEventListener("change", function () {
      visible.forEach(function (r) { if (headBox.checked) selected.add(r.id); else selected.delete(r.id); });
      allMatching = false;
      syncSelection();
    });
    var head = el("tr", null,
      el("th", { scope: "col", class: "select-col" }, headBox),
      el("th", { scope: "col", class: "star-col" }, el("span", { class: "visually-hidden" }, "Star")), cols.map(function (c) {
        var on = fs.sort.field === c.key;
        var b = button(c.label + (on ? (fs.sort.dir === "asc" ? " (ascending)" : " (descending)") : ""), function () {
          fs.sort = { field: c.key, dir: on && fs.sort.dir === "desc" ? "asc" : "desc" };
          changed();
          drawFilters();
        });
        b.className = "sort";
        return el("th", { scope: "col", "aria-sort": on ? (fs.sort.dir === "asc" ? "ascending" : "descending") : null },
          b, c.agent ? agentBadge(producerLabel(ctx.definition, c.agent)) : null);
      }));
    var body = el("tbody", null, list.map(function (r) {
      return el("tr", { class: r.status === "dropped" ? "dropped" : null },
        el("td", { class: "select-col" }, selectBox(r, cols)),
        el("td", { class: "star-col" }, starButton(r, cols)),
        cols.map(function (c, i) {
          return el("td", { class: c.meta ? "mono" : null }, i === 0
            ? [el("a", { href: entityHash(r.id) }, cell(c, r) || r.key || r.id), statusShown ? null : rowLabel(r),
              restoreControl(r, cols) ? [" ", restoreControl(r, cols)] : null]
            : cell(c, r));
        }));
    }));
    return [phone, el("div", { class: "table-wrap only-desk" }, el("table", null, el("thead", null, head), body))];
  }

  function drawResults() {
    var seq = ++drawSeq;
    clear(results);
    boxes = {}; headBox = null;
    var got = currentRows();
    drawStatusChips();
    if (!got) {
      count.textContent = "";
      countAll.hidden = true;
      append(results, stateView("loading", { label: plural }));
      drawBulk();
      return;
    }
    rows = got;
    rowIndex = {};
    rows.forEach(function (r) { rowIndex[r.id] = r; });
    var isFull = full();
    drawStatusChips();
    filtered = applyFilters(rows, fs);
    visible = isFull ? filtered.slice(0, limit) : filtered;
    count.textContent = countLine(isFull ? { full: true, shown: visible.length, matching: filtered.length, total: rows.length }
      : { full: false, shown: visible.length, done: paged.done }, plural);
    countAll.hidden = isFull;
    drawBulk();
    if (!filtered.length) {
      var probe = isFull ? Promise.resolve(rows.length) : ctx.store.list("entities", { where: [["type", "==", type]], limit: 1 }).then(function (d) { return d.length; });
      probe.then(function (n) {
        if (!live || seq !== drawSeq) return;
        append(results, n ? stateView("empty-filter", { plural: plural, onClear: clearFilters })
          : stateView("first-run", Object.assign({ plural: plural }, browseFirstRun(ctx.definition, type))));
      }, readError);
      return;
    }
    var cols = shownCols();
    if (fs.group) {
      var groups = {};
      var order = [];
      visible.forEach(function (r) {
        var g = browseText(rowValue(r, fs.group)) || "(none)";
        if (!groups[g]) { groups[g] = []; order.push(g); }
        groups[g].push(r);
      });
      order.sort().forEach(function (g) {
        append(results, [el("h2", null, g + " (" + groups[g].length + ")"), block(groups[g], cols)]);
      });
    } else {
      append(results, block(visible, cols));
    }
    if (isFull && filtered.length > limit) {
      append(results, button("Show " + Math.min(PAGE_SIZE, filtered.length - limit) + " more", function () { limit += PAGE_SIZE; drawResults(); }));
    } else if (!isFull && !paged.done) {
      var more = button("Load more", function () { more.disabled = true; more.textContent = "Loading"; loadPaged(false); });
      append(results, more);
    }
    syncSelection();
  }

  // ---- bulk ----
  function nameOf(id) {
    return rowIndex[id] ? rowTitle(rowIndex[id], shownCols()) : id;
  }

  function selectAllMatching() {
    bulkStatus.textContent = "Reading every matching " + String(t.label || type).toLowerCase();
    ensureFull().then(function () {
      if (!live) return;
      drawResults();
      filtered.forEach(function (r) { selected.add(r.id); });
      allMatching = true;
      bulkStatus.textContent = "";
      syncSelection();
    }, readError);
  }

  function clearSelection() {
    selected.clear(); allMatching = false; anchor = null;
    clear(confirmBox);
    syncSelection();
  }

  function bulkButton(label, kind, value) {
    var allowed = canWrite(ctx);
    return button(label, function () { startBulk(kind, value ? value() : ""); },
      { disabled: !allowed.ok, title: allowed.ok ? null : allowed.reason });
  }

  function drawBulk() {
    clear(bulkBar);
    bulkBar.hidden = !selected.size && !bulkStatus.textContent;
    if (!selected.size) { append(bulkBar, [bulkStatus, undoBox]); return; }
    var n = selected.size;
    var ids = Array.from(selected);
    var reason = el("input", { type: "text", maxlength: "200", "aria-label": "Reason for the drop", placeholder: "Why drop?" });
    var tag = el("input", { type: "text", maxlength: "60", "aria-label": "Tag name", placeholder: "Tag" });
    var allowed = canWrite(ctx);
    append(bulkBar, [
      el("p", null, el("b", null, n + " selected"), " ",
        allMatching ? null : button(full() && allDocs ? "Select all " + filtered.length + " matching" : "Select all matching", selectAllMatching),
        " ", button("Clear selection", clearSelection)),
      el("div", { class: "actions" },
        bulkButton("Keep", "keep"),
        el("details", { class: "inline" }, el("summary", null, "Drop"), reason, bulkButton("Drop " + n, "drop", function () { return reason.value; })),
        el("details", { class: "inline" }, el("summary", null, "Tag"), tag,
          bulkButton("Add tag", "tag", function () { return tag.value; }), bulkButton("Remove tag", "untag", function () { return tag.value; })),
        bulkButton("Star selected", "star"),
        bulkButton("Unstar selected", "unstar"),
        button("Export selected", function () { openExport(); }, { icon: "download" }),
        n === 2 ? el("a", { class: "btn", href: entityHash(ids[0]), title: allowed.ok ? null : allowed.reason }, "Merge on the record page") : null),
      confirmBox, el("p", null, bulkStatus, " ", undoBox)]);
  }

  function startBulk(kind, value) {
    var ids = Array.from(selected);
    var gate = checkScope(ids.length);
    if (!gate.ok) { bulkStatus.textContent = gate.reason; return; }
    var v = String(value || "").trim();
    if ((kind === "drop" || kind === "tag" || kind === "untag") && !v) {
      bulkStatus.textContent = kind === "drop" ? "Give a reason for the drop." : "Name the tag first.";
      return;
    }
    var items = ids.map(function (id) { return { id: id, name: nameOf(id) }; });
    if (!allMatching) { runBulkNow(items, kind, v); return; }
    clear(confirmBox);
    var names = items.slice(0, CONFIRM_NAMES).map(function (i) { return i.name; });
    var more = items.length - names.length;
    append(confirmBox, el("div", { class: "notice", role: "alert" },
      el("p", null, "This changes " + items.length + " " + plural + ": " + names.join(", ") + (more > 0 ? " and " + more + " more" : "") + "."),
      el("div", { class: "actions" },
        button("Confirm", function () { clear(confirmBox); runBulkNow(items, kind, v); }, { primary: true }),
        button("Cancel", function () { clear(confirmBox); }))));
  }

  // Writes one record at a time; Undo puts back each doc as it was (or removes it when there was none).
  function runBulkNow(items, kind, v) {
    var coll = BULK_ON_PERSON_STATE.indexOf(kind) !== -1 ? "userstate" : "decisions";
    var prev = {};
    items.forEach(function (it) { prev[it.id] = coll === "userstate" ? us[it.id] : decided[it.id]; });
    function write(it) {
      if (kind === "keep") return decide(ctx, it.id, "keep");
      if (kind === "drop") return dropRecord(ctx, it.id, v);
      return save(ctx.store, ctx.viewer, "userstate/" + it.id, userstateAfter(prev[it.id], kind, v));
    }
    function revert(id) {
      var path = coll + "/" + id;
      return prev[id] ? save(ctx.store, ctx.viewer, path, prev[id]) : remove(ctx.store, ctx.viewer, path);
    }
    clearTimeout(undoTimer);
    clear(undoBox);
    bulkStatus.textContent = "Working: 0 of " + items.length;
    runBulk(items, write, function (i, n) { bulkStatus.textContent = "Working: " + i + " of " + n; }).then(function (res) {
      if (!live) return;
      bulkStatus.textContent = bulkSummary(res, items);
      if (!res.done.length) return;
      append(undoBox, button("Undo", function () {
        clearTimeout(undoTimer);
        clear(undoBox);
        bulkStatus.textContent = "Undoing";
        undoBulk(res.done, revert).then(function (r) {
          bulkStatus.textContent = r.failed.length ? "Undo failed for " + r.failed.length + ": " + r.failed.map(function (f) { return nameOf(f.id); }).join(", ") + "." : "Undone.";
        });
      }));
      undoTimer = setTimeout(function () { clear(undoBox); }, UNDO_MS);
    });
  }

  // ---- export ----
  function openExport() {
    if (exportArea.firstChild) { clear(exportArea); return; }
    var cols = shownCols();
    var needRead = !selected.size && !full();
    status.textContent = needRead ? "Reading every matching " + String(t.label || type).toLowerCase() : "";
    (needRead ? ensureFull().then(drawResults) : Promise.resolve()).then(function () {
      if (!live) return;
      status.textContent = "";
      append(exportArea, [exportDialog(ctx, {
        workspace: (ctx.workspace && ctx.workspace.name) || "", plural: plural, cols: cols, selected: selected,
        rows: selected.size ? rows : filtered,
        toPlain: function (list) {
          return list.map(function (r) { var o = {}; cols.forEach(function (c) { o[c.key] = rowValue(r, c.key); }); return o; });
        },
      }), button("Close", function () { clear(exportArea); })]);
    }, readError);
  }

  // ---- views ----
  function drawViewMenu(list) {
    clear(viewBox);
    var items = [{ id: "", name: "All " + plural, href: "#/browse/" + encodeURIComponent(type), fs: readFilterState({ status: "all" }) },
      { id: "dropped", name: "Dropped", href: "#/browse/" + encodeURIComponent(type) + "?status=dropped", fs: readFilterState({ status: "dropped" }) }]
      .concat((list || []).map(function (v) {
        return { id: v.id, name: v.data.name || v.id, href: "#/browse/" + encodeURIComponent(type) + "?view=" + encodeURIComponent(v.id), fs: viewToFilterState(v.data), builtIn: v.builtIn };
      }));
    append(viewBox, [el("summary", null, viewBase ? "View: " + (viewBase.name || viewId) : "Views"),
      list ? el("ul", { class: "rows" }, items.map(function (v) {
        var n = allDocs ? applyFilters(allDocs.map(mapRow), v.fs).length : null;
        return el("li", null, el("a", { href: v.href, "aria-current": v.id && v.id === viewId ? "page" : null }, v.name),
          n === null ? null : el("span", { class: "muted" }, " " + n), v.builtIn ? [" ", badge("Built in", "quiet")] : null);
      })) : el("p", { class: "muted" }, "Open to list the views for " + plural + ".")]);
  }

  viewBox.addEventListener("toggle", function () {
    if (!viewBox.open) return;
    var builtIn = ((ctx.definition && ctx.definition.views) || []).filter(function (v) { return v.type === type; })
      .map(function (v) { return { id: v.id, data: v, builtIn: true }; });
    Promise.all([ctx.store.list("views", { where: [["type", "==", type]] }), ensureFull()]).then(function (got) {
      if (!live) return;
      var saved = got[0].map(function (d) { return { id: d.id, data: d.data, builtIn: false }; });
      drawViewMenu(builtIn.concat(saved).sort(function (a, b) { return viewByName(a, b); }));
      viewBox.open = true;
      drawResults();
    }, function () { status.textContent = "Could not read the views."; });
  });

  function drawSaveSummary() {
    clear(saveSummary);
    var modified = viewBase && isModified(viewBase, fs);
    append(saveSummary, [viewBase && !viewBuiltIn ? "Save view: " + (viewBase.name || viewId) : "Save view",
      modified ? [" ", badge("Modified", "warn")] : null]);
  }

  // Saving a view stores the current filters; saving over a view keeps who made it (viewDoc). Only the
  // creator updates a view (canEditView); anyone who can write saves a new one.
  function drawSave() {
    var open = saveBox.open;
    clear(saveBox);
    var editable = viewBase && !viewBuiltIn && canEditView(viewBase, ctx.viewer);
    var name = el("input", { type: "text", value: viewBase && !viewBuiltIn ? viewBase.name || "" : "" });
    var saveStatus = el("span", { class: "status", role: "status" });
    function write(id, base) {
      var n = name.value.trim();
      if (!n) return Promise.reject(new Error("name the view first."));
      var s = stamp(ctx);
      var doc = viewDoc(fs, { type: type, name: n, base: base, at: s.at, by: s.by });
      return save(ctx.store, ctx.viewer, "views/" + id, doc).then(function () {
        viewId = id; viewBase = doc; viewBuiltIn = false;
        writeHash();
        drawSave();
      });
    }
    function fresh() { return write("v-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), null); }
    drawSaveSummary();
    append(saveBox, [
      saveSummary,
      el("div", { class: "filters" },
        labelled("View name", name),
        el("div", { class: "actions" },
          editable ? actionButton(ctx, "Update view", function () { return write(viewId, viewBase); }, { primary: true, status: saveStatus }) : null,
          actionButton(ctx, viewBase ? "Save as new" : "Save view", fresh, { primary: !editable, status: saveStatus }),
          saveStatus)),
    ]);
    saveBox.open = open;
  }

  function openView(id) {
    var builtIn = ((ctx.definition && ctx.definition.views) || []).filter(function (v) { return v.id === id && v.type === type; })[0];
    var got = builtIn ? Promise.resolve({ exists: true, data: builtIn }) : ctx.store.get("views/" + id);
    return got.then(function (doc) {
      if (!live) return;
      if (!doc.exists || doc.data.type !== type) { viewId = ""; status.textContent = "That view no longer exists."; drawSave(); return; }
      viewBase = doc.data;
      viewBuiltIn = !!builtIn;
      if (viewOnly) fs = viewToFilterState(doc.data);
      search.value = fs.q;
      drawSave();
      drawViewMenu(null);
      changed();
      drawFilters();
    }, function () { status.textContent = "Could not read that view."; });
  }

  drawFilters();
  drawChips();
  drawSave();
  drawViewMenu(null);
  drawResults();
  var stop = watchAll(ctx, {
    userstate: { collection: "userstate" },
    columns: { collection: "columns" },
    decisions: { collection: "decisions" },
  }, function (got) {
    us = byId(got.userstate);
    decided = byId(got.decisions);
    columnDocs = got.columns;
    if (!people) {
      people = true;
      if (viewId) openView(viewId); else reload();
      drawFilters();
      return;
    }
    if (fs.status === "dropped" && !full()) {
      loadPending().then(function (list) { if (live) { paged.pending = list; drawResults(); } });
    } else drawResults();
    drawFilters();
  }, readError);
  // Live updates: the newest records of this type by last seen. A run touches lastSeen on every record it
  // sights, so any change re-reads page 1 (or the full set when one is held). The first answer is the
  // subscription starting, not a change.
  var liveFirst = true;
  var stopLive = ctx.store.subscribe("entities", function () {
    if (liveFirst) { liveFirst = false; return; }
    if (!live || !people) return;
    if (allDocs) refreshFull();
    else if (!full()) loadPaged(true);
  }, Object.assign(pageQuery({ where: [["type", "==", type]] }, BROWSE_DEFAULT_SORT, null), { onError: function () {} }));
  return function () { live = false; clearTimeout(timer); clearTimeout(undoTimer); stop(); stopLive(); };
}

if (typeof module === "object" && module.exports) {
  module.exports = { overlayStatus: overlayStatus, fillPage: fillPage, needsFullRead: needsFullRead, pagedBase: pagedBase,
    browseFirstRun: browseFirstRun, applyFilters: applyFilters, toCsv: toCsv, toRow: toRow, readFilterState: readFilterState, writeFilterState: writeFilterState, browseColumns: browseColumns, defaultCols: defaultCols,
    overlayRow: overlayRow, userstateAfter: userstateAfter, filterChips: filterChips, removeChip: removeChip, countLine: countLine };
}
