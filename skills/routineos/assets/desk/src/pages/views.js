/* src/pages/views.js: saved Browse filters per type, human and agent made, plus agent-proposed
   columns (spec s8 item 4, s13). Agent-made items keep their badge after Keep. */

var VIEW_DEFAULT_SORT = { field: "lastSeen", dir: "desc" };
var VIEW_WINDOWS = ["all", "week", "month", "last-month"];

function viewByName(a, b) {
  var x = String(a.data.name || a.id), y = String(b.data.name || b.id);
  return x === y ? (a.id < b.id ? -1 : 1) : (x < y ? -1 : 1);
}

// Saved views (docs) and the definition's built-in views, grouped by type id. Built-in views are
// read only: they come from definition.json and change only when the definition does.
function groupViews(docs, definition) {
  var types = (definition && definition.types) || {};
  var groups = {};
  function add(type, v) {
    if (!groups[type]) {
      var t = types[type];
      groups[type] = { type: type, label: t ? t.plural || t.label || type : type, views: [] };
    }
    groups[type].views.push(v);
  }
  ((definition && definition.views) || []).forEach(function (v) { add(v.type, { id: v.id, data: v, builtIn: true }); });
  (docs || []).forEach(function (d) { add(d.data.type, { id: d.id, data: d.data, builtIn: false }); });
  return Object.keys(groups).sort().map(function (k) {
    groups[k].views.sort(viewByName);
    return groups[k];
  });
}

// Kept local so this file loads on its own under node; the shape matches readFilterState in browse.js.
function viewToFilterState(v) {
  v = v || {};
  var f = v.filters || {};
  var sort = v.sort && v.sort.field ? { field: v.sort.field, dir: v.sort.dir === "asc" ? "asc" : "desc" }
    : { field: VIEW_DEFAULT_SORT.field, dir: VIEW_DEFAULT_SORT.dir };
  return {
    q: f.q || "",
    status: f.status === "active" || f.status === "dropped" ? f.status : "all",
    starred: !!f.starred,
    tag: f.tag || "",
    source: f.source || "",
    reason: f.reason || "",
    window: VIEW_WINDOWS.indexOf(v.window) !== -1 ? v.window : "all",
    fields: Object.assign({}, f.fields || {}),
    sort: sort,
    group: v.group || "",
    cols: Array.isArray(v.columns) ? v.columns.slice() : null,
  };
}

// Only filters that narrow the list are stored.
function filterStateToView(fs) {
  var f = {};
  if (fs.q) f.q = fs.q;
  if (fs.status && fs.status !== "all") f.status = fs.status;
  if (fs.starred) f.starred = true;
  if (fs.tag) f.tag = fs.tag;
  if (fs.source) f.source = fs.source;
  if (fs.reason) f.reason = fs.reason;
  if (fs.fields && Object.keys(fs.fields).length) f.fields = Object.assign({}, fs.fields);
  return {
    filters: f,
    window: fs.window || "all",
    sort: { field: (fs.sort || VIEW_DEFAULT_SORT).field, dir: (fs.sort || VIEW_DEFAULT_SORT).dir },
    group: fs.group || "",
    columns: fs.cols ? fs.cols.slice() : null,
  };
}

// opts: {type, name, base, at, by}. Saving over a view keeps who made it; a new view records its creator's
// viewer id in madeBy ("human" only when there is no viewer id).
// Saving is a person's choice, so the view is kept from then on.
function viewDoc(fs, opts) {
  var base = opts.base || {};
  var out = Object.assign({}, base, filterStateToView(fs), {
    type: opts.type, name: opts.name, state: "kept", updatedAt: opts.at, updatedBy: opts.by,
  });
  if (!base.madeBy) out.madeBy = opts.by || "human";
  if (!base.createdAt) out.createdAt = opts.at;
  return out;
}

// Desk-enforced ownership (spec "Saved views"): the creator edits; agent, definition and pre-v2 human views
// (madeBy "human" or missing) are editable by anyone who can write. The store cannot express this rule.
var SHARED_MAKERS = ["agent", "definition", "human"];
function canEditView(view, viewer) {
  var by = view && view.madeBy;
  if (!by || SHARED_MAKERS.indexOf(by) !== -1) return true;
  return !!viewer && by === viewer;
}

// A copy the duplicator owns: kept, no producer, fresh timestamps.
function duplicateView(view, viewer, at) {
  var out = JSON.parse(JSON.stringify(view || {}));
  delete out.producer;
  delete out.updatedAt;
  delete out.updatedBy;
  out.name = (view.name || "View") + " (copy)";
  out.madeBy = viewer || "human";
  out.state = "kept";
  out.createdAt = at;
  return out;
}

// True when the page's filter state no longer matches the saved view.
function isModified(view, fs) {
  if (!view) return false;
  return JSON.stringify(filterStateToView(viewToFilterState(view))) !== JSON.stringify(filterStateToView(fs));
}

// pins: Set of view ids the viewer pinned. Stable within each group.
function pinnedFirst(list, pins) {
  var on = (list || []).filter(function (v) { return pins.has(v.id); });
  var off = (list || []).filter(function (v) { return !pins.has(v.id); });
  return on.concat(off);
}

function viewSummary(fs, t) {
  var bits = [];
  var fields = (t && t.fields) || {};
  if (fs.q) bits.push("search " + JSON.stringify(fs.q));
  if (fs.status !== "all") bits.push(fs.status);
  if (fs.starred) bits.push("starred");
  if (fs.tag) bits.push("tag " + fs.tag);
  if (fs.source) bits.push("from " + fs.source);
  if (fs.reason) bits.push("drop reason " + JSON.stringify(fs.reason));
  if (fs.window !== "all") bits.push({ week: "past 7 days", month: "this month", "last-month": "last month" }[fs.window]);
  Object.keys(fs.fields).sort().forEach(function (k) { bits.push(((fields[k] && fields[k].label) || k) + " " + fs.fields[k]); });
  bits.push("sorted by " + fs.sort.field + (fs.sort.dir === "asc" ? " ascending" : " descending"));
  return bits.join(", ");
}

// Two-step delete inside the row; there are no blocking dialogs on this page. A deleted view can be put
// back for 10 seconds (Undo writes the same document again).
function deleteControl(ctx, label, path, status, data) {
  var box = el("span", { class: "actions" });
  function ask() {
    clear(box);
    append(box, [
      el("span", null, "Delete " + label + " for everyone?"),
      actionButton(ctx, "Delete", function () {
        return remove(ctx.store, ctx.viewer, path).then(function () { if (data) offerUndo(ctx, path, data, status); });
      }, { status: status, done: "Deleted." }),
      button("Cancel", reset),
    ]);
  }
  function reset() {
    clear(box);
    append(box, button("Delete", ask, { disabled: ctx.store.readOnly, title: ctx.store.readOnly ? READ_ONLY_NOTE : null }));
  }
  reset();
  return box;
}

function offerUndo(ctx, path, data, status) {
  var undo = actionButton(ctx, "Undo", function () { return save(ctx.store, ctx.viewer, path, data); }, { status: status, done: "Put back." });
  append(status.parentNode || status, undo);
  setTimeout(function () { if (undo.parentNode) undo.parentNode.removeChild(undo); }, UNDO_MS);
}

function keepButton(ctx, path, data, status) {
  return actionButton(ctx, "Keep", function () {
    var s = stamp(ctx);
    return save(ctx.store, ctx.viewer, path, Object.assign({}, data, { state: "kept", updatedAt: s.at, updatedBy: s.by }));
  }, { primary: true, status: status, done: "Kept." });
}

function madeByBadges(ctx, data) {
  return [
    data.madeBy === "agent" || (data.producer && data.madeBy !== "human") ? [" ", agentBadge(producerLabel(ctx.definition, data.producer))] : null,
    data.state === "proposed" ? [" ", badge("proposed", "warn")] : null,
  ];
}

function pinButton(ctx, id, pinned, status) {
  var path = viewerPath(ctx.viewer, "pin", id);
  return actionButton(ctx, pinned ? "Unpin" : "Pin", function () {
    return pinned ? remove(ctx.store, ctx.viewer, path) : save(ctx.store, ctx.viewer, path, stamp(ctx));
  }, { status: status });
}

function duplicateButton(ctx, v, status) {
  return actionButton(ctx, "Duplicate", function () {
    var s = stamp(ctx);
    var id = "v-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    return save(ctx.store, ctx.viewer, "views/" + id, duplicateView(v.data, s.by, s.at));
  }, { status: status, done: "Duplicated." });
}

function viewItem(ctx, g, v, pins) {
  var status = el("span", { class: "status", role: "status" });
  var t = ctx.definition && ctx.definition.types && ctx.definition.types[g.type];
  var fs = viewToFilterState(v.data);
  var pinned = pins.has(v.id);
  var actions;
  if (v.builtIn) {
    var qs = writeFilterState(fs);
    actions = [el("a", { href: "#/browse/" + encodeURIComponent(g.type) + (qs ? "?" + qs : "") }, "Open"),
      duplicateButton(ctx, v, status)];
  } else if (canEditView(v.data, ctx.viewer)) {
    actions = [
      v.data.state === "proposed" ? keepButton(ctx, "views/" + v.id, v.data, status) : null,
      el("a", { class: "link-action", href: "#/browse/" + encodeURIComponent(g.type) + "?view=" + encodeURIComponent(v.id) }, icon("pencil"), "Edit"),
      duplicateButton(ctx, v, status),
      deleteControl(ctx, v.data.name || v.id, "views/" + v.id, status, v.data),
    ];
  } else {
    actions = [
      el("a", { class: "link-action", href: "#/browse/" + encodeURIComponent(g.type) + "?view=" + encodeURIComponent(v.id) }, "Open"),
      duplicateButton(ctx, v, status),
    ];
  }
  actions.push(ctx.viewer ? pinButton(ctx, v.id, pinned, status) : null);
  return el("li", { class: "item", "data-view": v.id },
    el("div", { class: "item-head" }, v.data.name || v.id, pinned ? [" ", badge("pinned")] : null,
      v.builtIn ? [" ", badge("built in")] : madeByBadges(ctx, v.data)),
    el("p", { class: "muted" }, viewSummary(fs, t)),
    el("div", { class: "actions" }, actions, status));
}

function columnItem(ctx, c) {
  var status = el("span", { class: "status", role: "status" });
  var t = ctx.definition && ctx.definition.types && ctx.definition.types[c.data.type];
  return el("li", { class: "item", "data-column": c.id },
    el("div", { class: "item-head" }, c.data.name || c.id, " on ", t ? t.plural || t.label : c.data.type || "", madeByBadges(ctx, c.data)),
    el("p", { class: "muted" }, c.data.state === "proposed"
      ? "Proposed: shown in Browse once kept."
      : "Shown in Browse. Deleting hides its values; the next run drops them."),
    el("div", { class: "actions" },
      c.data.state === "proposed" ? keepButton(ctx, "columns/" + c.id, c.data, status) : null,
      deleteControl(ctx, c.data.name || c.id, "columns/" + c.id, status), status));
}

function renderViews(outlet, ctx) {
  var box = el("div", { class: "page" }, el("h1", null, "Views"), stateView("loading", { label: "views" }));
  append(outlet, box);
  return watchAll(ctx, withViewerState(ctx, { views: { collection: "views" }, columns: { collection: "columns" } }, ["pin"]), function (got) {
    var groups = groupViews(got.views, ctx.definition);
    var pins = idSet(got.pin) || new Set();
    clear(box);
    append(box, [el("h1", null, "Views"),
      el("p", { class: "muted" }, "Saved Browse filters. Save a new one from any Browse list. Agent-made views stay labelled after you keep them.")]);
    if (!groups.length) append(box, el("p", null, "No saved views yet."));
    groups.forEach(function (g) {
      append(box, el("section", null, el("h2", null, g.label + " (" + g.views.length + ")"),
        el("ul", { class: "items" }, pinnedFirst(g.views, pins).map(function (v) { return viewItem(ctx, g, v, pins); }))));
    });
    if (got.columns.length) {
      append(box, el("section", null, el("h2", null, "Columns"),
        el("ul", { class: "items" }, got.columns.slice().sort(viewByName).map(function (c) { return columnItem(ctx, c); }))));
    }
  }, function () {
    clear(box);
    append(box, [el("h1", null, "Views"), stateView("read-error", { collection: "views", onRetry: ctx.retry })]);
  });
}

if (typeof module === "object" && module.exports) {
  module.exports = { groupViews: groupViews, viewToFilterState: viewToFilterState, filterStateToView: filterStateToView, viewDoc: viewDoc,
    canEditView: canEditView, duplicateView: duplicateView, isModified: isModified, pinnedFirst: pinnedFirst };
}
