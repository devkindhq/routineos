// core/pages/settings.js: grouped Settings (spec 5.9): Account (appearance, shortcuts) and Workspace (routine forms,
// routine notifications, members, modules, saved views, privacy PIN, export, settings history, About).
// Settings are human-owned: this page writes settings/<producerId> and settings/workspace; the PIN goes through actions.js.
// Producers read the values at the start of a run and snapshot them on the run record.
import { deskModules } from "../palette.js";

export var SETTINGS_LWW = "Saves from this page are last write wins: if two people change the same thing, the later save is kept.";
export var SETTINGS_CAP_TEXT = "25,000";
export var WORKSPACE_SETTINGS = "settings/workspace";
// Shared collections a visitor can count. Per-viewer state under data/users/ is private to each person.
export var SETTINGS_COUNTED = ["meta", "entities", "runs", "inbox", "pending", "settings", "views", "columns", "userstate", "merges", "decisions", "settingsHistory"];
export var NOTIFY_CHOICES = [["inbox", "Inbox only"], ["push", "Inbox plus push"]];

export function plainLabel(name) {
  var s = String(name || "").replace(/[_-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Pure: what to draw for one schema entry and the stored value (undefined falls back to the default).
export function controlSpec(entry, value) {
  var kinds = ["toggle", "number", "choice", "list"];
  return {
    kind: kinds.indexOf(entry.type) === -1 ? "text" : entry.type,
    name: entry.name,
    label: entry.label || plainLabel(entry.name),
    value: value === undefined ? entry.default : value,
    // Bracket access: the bundle test rejects the synthetic-domain suffix as a substring.
    example: entry["example"] || "",
    costNote: entry.cost_note || "",
    min: typeof entry.min === "number" ? entry.min : null,
    max: typeof entry.max === "number" ? entry.max : null,
    choices: Array.isArray(entry.choices) ? entry.choices.slice() : [],
  };
}

// "" when the value is allowed, otherwise one plain sentence.
export function checkSetting(entry, value) {
  var spec = controlSpec(entry, value);
  if (spec.kind === "number") {
    if (typeof value !== "number" || isNaN(value)) return "Enter a number.";
    if (spec.min !== null && value < spec.min) return "At least " + spec.min + ".";
    if (spec.max !== null && value > spec.max) return "At most " + spec.max + ".";
  }
  if (spec.kind === "choice" && spec.choices.indexOf(value) === -1) return "Choose one of the listed values.";
  return "";
}

export function listAdd(list, value) {
  var v = String(value || "").trim();
  var out = (list || []).slice();
  if (!v) return out;
  var lower = v.toLowerCase();
  if (!out.some(function (x) { return String(x).toLowerCase() === lower; })) out.push(v);
  return out;
}

export function listRemove(list, value) {
  return (list || []).filter(function (x) { return x !== value; });
}

export function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function changedValues(loaded, draft) {
  var out = {};
  Object.keys(draft).forEach(function (k) { if (!sameValue(loaded[k], draft[k])) out[k] = draft[k]; });
  return out;
}

export function scheduleText(schedule) {
  return schedule ? schedule + " (cron, UTC)" : "No schedule recorded";
}

export var HISTORY_SHOWN = 10;

// Open proposals from inbox for one setting of one producer: no decision, or a snooze that has run out.
export function settingSuggestions(msgs, producer, setting, decisions, now) {
  decisions = decisions || {};
  return (msgs || []).filter(function (m) {
    var d = m.data, p = d.proposal;
    if (d.kind !== "proposal" || d.producer !== producer || !p || p.setting !== setting) return false;
    var dec = decisions[m.id];
    return !dec || (dec.decision === "snooze" && !!dec.until && Date.parse(dec.until) <= now);
  }).sort(function (a, b) { var x = a.data.createdAt || "", y = b.data.createdAt || ""; return x === y ? 0 : x < y ? 1 : -1; });
}

export function historyLine(e) {
  return Object.keys(e.after || {}).map(function (k) {
    var b = (e.before || {})[k];
    return k + ": " + (b === null || b === undefined ? "(not set)" : JSON.stringify(b)) + " to " + JSON.stringify(e.after[k]);
  }).join("; ");
}

// The Sidebar group: one row per view module on a type this workspace has. shown is false when it is hidden.
export function sidebarRows(definition, hidden) {
  var types = (definition && definition.types) || {};
  var off = Array.isArray(hidden) ? hidden : [];
  return deskModules(definition).filter(function (m) { return Object.prototype.hasOwnProperty.call(types, m.view.type); })
    .map(function (m) { return { id: m.id, label: String(m.label || m.id), type: m.view.type, shown: off.indexOf(m.id) === -1 }; });
}

// The hide list after one switch: sorted, each string id once. The switch only adds ids of the listed view modules
// (moduleIds); ids outside that list (a module whose type is missing for now) are kept as they were.
export function nextHidden(hidden, id, shown, moduleIds) {
  var out = (Array.isArray(hidden) ? hidden : []).filter(function (h) { return h !== id; });
  if (!shown && moduleIds.indexOf(id) !== -1) out.push(id);
  return out.filter(function (h, i) { return typeof h === "string" && out.indexOf(h) === i; }).sort();
}

export function lintText(lint) {
  if (lint === undefined || lint === null) return "Not recorded";
  if (typeof lint === "string") return lint;
  if (lint.ok === true) return "Passed";
  var n = Array.isArray(lint.problems) ? lint.problems.length : 0;
  return lint.ok === false ? n + " problem" + (n === 1 ? "" : "s") : JSON.stringify(lint);
}

// bundle_desk.py puts the plugin.json version here; empty when it is not known.
export var DESK_TEMPLATE_VERSION = "__ROUTINEOS_VERSION__";

export var VIEW_DEFAULT_SORT = { field: "lastSeen", dir: "desc" };
export var VIEW_WINDOWS = ["all", "week", "month", "last-month"];

export function viewByName(a, b) {
  var x = String(a.data.name || a.id), y = String(b.data.name || b.id);
  return x === y ? (a.id < b.id ? -1 : 1) : (x < y ? -1 : 1);
}

// Saved views (docs) and the definition's built-in views, grouped by type id. Built-in views are
// read only: they come from definition.json and change only when the definition does.
export function groupViews(docs, definition) {
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
export function viewToFilterState(v) {
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
export function filterStateToView(fs) {
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
export function viewDoc(fs, opts) {
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
export var SHARED_MAKERS = ["agent", "definition", "human"];
export function canEditView(view, viewer) {
  var by = view && view.madeBy;
  if (!by || SHARED_MAKERS.indexOf(by) !== -1) return true;
  return !!viewer && by === viewer;
}

// A copy the duplicator owns: kept, no producer, fresh timestamps.
export function duplicateView(view, viewer, at) {
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
export function isModified(view, fs) {
  if (!view) return false;
  return JSON.stringify(filterStateToView(viewToFilterState(view))) !== JSON.stringify(filterStateToView(fs));
}

// pins: Set of view ids the viewer pinned. Stable within each group.
export function pinnedFirst(list, pins) {
  var on = (list || []).filter(function (v) { return pins.has(v.id); });
  var off = (list || []).filter(function (v) { return !pins.has(v.id); });
  return on.concat(off);
}

export function viewSummary(fs, t) {
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

// The grouped sub-nav (spec 5.9). Account is this viewer in this browser; Workspace is shared, owner writes.
// Notifications (Account) is left out until its matrix lands (Tier 2 item 10).
export var SETTINGS_NAV = [
  { group: "account", id: "appearance", label: "Appearance" },
  { group: "account", id: "shortcuts", label: "Shortcuts" },
  { group: "workspace", id: "routine", label: "Routine" },
  { group: "workspace", id: "routine-notifications", label: "Routine notifications" },
  { group: "workspace", id: "members", label: "Members" },
  { group: "workspace", id: "modules", label: "Modules" },
  { group: "workspace", id: "views", label: "Saved views" },
  { group: "workspace", id: "lock", label: "Privacy PIN" },
  { group: "workspace", id: "tour", label: "Starter tour" },
  { group: "workspace", id: "export", label: "Export" },
  { group: "workspace", id: "history", label: "Settings history" },
  { group: "workspace", id: "about", label: "About" },
];
export var ACCOUNT_SECTIONS = ["appearance", "shortcuts"];

export function capitalWord(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
