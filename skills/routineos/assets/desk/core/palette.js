// core/palette.js: the sidebar model, keyboard shortcuts and the command palette (spec "Shell and navigation").
// The pure parts (navModel, bottomModel, shortcutFor, isTyping, paletteCommands, matchCommands) are tested in
// tests/visual/shell.test.mjs; the shell draws them.
import { ICON_NAMES } from "./shared.js";

export var NAV_HEAD = [["today", "Today", "#/today", "house"], ["approvals", "Approvals", "#/approvals", "badge-check"], ["runs", "Runs", "#/runs", "chart-line"], ["history", "History", "#/history", "history"]];
export var NAV_TAIL = [["settings", "Settings", "#/settings", "settings"]];
// A type without an icon shows a list; a view without one shows a dot under its type.
export var TYPE_ICON = "list";
export var VIEW_ICON = "dot";
export var GO_KEYS = { t: "#/today", i: "#/approvals", a: "#/approvals", u: "#/runs", h: "#/history", s: "#/settings" };
// j, k and o move through and open the list on screen; a page that has one answers them (ctx.listKey).
export var SINGLE_KEYS = { "/": "search", f: "filters", n: "notifications", "[": "sidebar", "?": "help", j: "next", k: "prev", o: "open" };
export var TEXT_INPUTS = ["text", "search", "email", "url", "tel", "password", "number", "date", "datetime-local", "time", "month", "week", ""];

// Types in definition order (the order the routine declares them).
export function navTypes_(definition) {
  var t = (definition && definition.types) || {};
  return Object.keys(t).map(function (id) {
    return { id: id, plural: t[id].plural || t[id].label || id, icon: t[id].icon };
  });
}

export function navEntry_(row) {
  return { id: row[0], label: row[1], href: row[2], icon: row[3], children: [] };
}

// The named icon when the sprite has it, else the default. Lint refuses unknown names in a definition; a stored
// view is checked here too, so a bad name never blanks the nav or throws.
export function navIcon_(name, fallback) {
  return typeof name === "string" && ICON_NAMES.indexOf(name) !== -1 ? name : fallback;
}

// The view modules the compiled definition carries (definition.desk.modules), in compile order. A stored
// definition is data a person could have edited, so anything not shaped like a view module is left out.
export function deskModules(definition) {
  var list = definition && definition.desk && definition.desk.modules;
  if (!Array.isArray(list)) return [];
  return list.filter(function (m) {
    return !!m && typeof m === "object" && m.kind === "view" && typeof m.id === "string" && m.id !== "" &&
      !!m.view && typeof m.view === "object" && typeof m.view.type === "string";
  });
}

// The module for #/m/<id>, or null when there is none or its type is no longer in the definition.
export function moduleFor(definition, id) {
  var t = (definition && definition.types) || {};
  var m = deskModules(definition).filter(function (x) { return x.id === id; })[0];
  return m && Object.prototype.hasOwnProperty.call(t, m.view.type) ? m : null;
}

// The spec pages the compiled definition carries (definition.desk.pages). Like deskModules this is data a person
// could have edited, so a page without an id, a title or a blocks list is left out, and so is a block whose query
// names a type the definition no longer has.
// Ids a spec page may not take: the built-in pages and the retired ones (the same lists as definition.py), words
// learning never touches, and any desk module id, so nav, the palette and moduleFor stay unambiguous.
var BUILTIN_PAGE_IDS = ["today", "approvals", "runs", "workers", "history", "settings", "browse", "entity", "inbox", "suggestions", "views"];
var NEVER_LEARNABLE = /push|gate|send|alert|permission|budget|maxruns|capoverride/;

export function deskPages(definition) {
  var list = definition && definition.desk && definition.desk.pages;
  if (!Array.isArray(list)) return [];
  var t = (definition && definition.types) || {};
  var taken = new Set(deskModules(definition).map(function (m) { return m.id; }));
  return list.filter(function (p) {
    return !!p && typeof p === "object" && typeof p.id === "string" && p.id !== "" &&
      BUILTIN_PAGE_IDS.indexOf(p.id) === -1 && !NEVER_LEARNABLE.test(p.id.replace(/[^0-9a-z]/gi, "").toLowerCase()) && !taken.has(p.id) &&
      typeof p.title === "string" && p.title.trim() !== "" && Array.isArray(p.blocks);
  }).map(function (p) {
    return Object.assign({}, p, { blocks: p.blocks.filter(function (b) { return specBlockOk(b, t); }) });
  });
}

// The client half of definition.lint_pages: a block the Python lint would refuse is dropped here, so a hand edited
// definition cannot crash the page. Kinds, a declared query type, x and aggregate for a tile or chart, a window the
// evaluator can use (the same limits as definition.py: 3660 days, 520 weeks).
var SPEC_KINDS = ["tile", "chart", "table", "text"];
var SPEC_AGG_OPS = ["latest", "sum", "avg", "count", "delta"];
var SPEC_WINDOW = { days: 3660, weeks: 520 };

function windowOk(w) {
  if (w === undefined || w === null || w === "range") return true;
  var last = w && typeof w === "object" ? w.last : null;
  return !!last && typeof last === "object" && Number.isInteger(last.n) && last.n >= 1 &&
    Object.prototype.hasOwnProperty.call(SPEC_WINDOW, last.unit) && last.n <= SPEC_WINDOW[last.unit];
}

function specBlockOk(b, types) {
  if (!b || typeof b !== "object" || SPEC_KINDS.indexOf(b.kind) === -1) return false;
  if (b.kind === "text") return !b.query || (typeof b.query === "object" && typeof b.query.type === "string");
  var q = b.query;
  if (!q || typeof q !== "object" || typeof q.type !== "string" || !Object.prototype.hasOwnProperty.call(types, q.type)) return false;
  if (!windowOk(q.window)) return false;
  if (q.where !== undefined && !Array.isArray(q.where)) return false;
  if (b.kind === "table") return Array.isArray(b.columns);
  if (typeof q.x !== "string") return false;
  return !!q.aggregate && typeof q.aggregate === "object" && SPEC_AGG_OPS.indexOf(q.aggregate.op) !== -1;
}

// The spec page for #/p/<id>, or null.
export function specPageFor(definition, id) {
  return deskPages(definition).filter(function (p) { return p.id === id; })[0] || null;
}

// The hide list stored in settings/workspace (values.nav.hidden), from the settings collection's docs.
export function navHidden(settingsDocs) {
  var ws = (settingsDocs || []).filter(function (d) { return d && d.id === "workspace"; })[0];
  var nav = ws && ws.data && ws.data.values && ws.data.values.nav;
  return nav && Array.isArray(nav.hidden) ? nav.hidden : [];
}

// The hide list as a lookup of strings; anything else in it (numbers, null, objects) is ignored.
export function hiddenSet_(hidden) {
  // No prototype: an id like "__proto__" is a plain key.
  var out = Object.create(null);
  var list = hidden instanceof Set ? Array.from(hidden) : Array.isArray(hidden) ? hidden : [];
  list.forEach(function (h) { if (typeof h === "string") out[h] = true; });
  return out;
}

// views: saved view docs [{id, data: {type, name, state}}]; the definition's own views are added here.
// pins: Set of view ids this viewer pinned (or null). A pinned view sits at the top of its type.
// join: the Desk's join card (meta/join) or null; with one, Workers ends the Workspace group.
// hidden: optional list of view module ids (settings/workspace values.nav.hidden); it hides modules only, so
// retired page ids in an old list (inbox, suggestions, views) change nothing.
// counts: optional {typeId: total} the Desk already knows; a type without one has no count.
// View modules follow their type's saved views in compile order; pins do not move them.
// Returns {groups: [{id: "workspace", label, items}, {id: "lists", label, items}], settings, members}, the shape pinned by
// tests/visual/golden/nav-v2.json; members sits above settings in the rail.
export function navModel(definition, views, pins, join, hidden, counts, extPages) {
  pins = pins || new Set();
  var hide = hiddenSet_(hidden);
  var modules = deskModules(definition).filter(function (m) { return !Object.prototype.hasOwnProperty.call(hide, m.id); });
  var all = ((definition && definition.views) || []).map(function (v) { return { id: v.id, data: v }; }).concat(views || []);
  var head = NAV_HEAD.map(navEntry_);
  var lists = [];
  navTypes_(definition).forEach(function (t) {
    var kids = all.filter(function (v) { return v.data && v.data.type === t.id && v.data.state !== "proposed"; })
      .map(function (v) {
        return { id: "view:" + v.id, label: String(v.data.name || v.id), pinned: pins.has(v.id), icon: navIcon_(v.data.icon, VIEW_ICON),
          href: "#/browse/" + encodeURIComponent(t.id) + "?view=" + encodeURIComponent(v.id) };
      });
    kids.sort(function (a, b) {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
    modules.forEach(function (m) {
      if (m.view.type !== t.id) return;
      kids.push({ id: "module:" + m.id, label: String(m.label || m.id), icon: navIcon_(m.icon, VIEW_ICON), href: "#/m/" + encodeURIComponent(m.id), module: true });
    });
    var item = { id: "type:" + t.id, label: t.plural, href: "#/browse/" + encodeURIComponent(t.id), icon: navIcon_(t.icon, TYPE_ICON), children: kids };
    // A count shows only when the Desk already knows it; nothing is read to find it.
    if (counts && Object.prototype.hasOwnProperty.call(counts, t.id) && typeof counts[t.id] === "number") item.count = counts[t.id];
    lists.push(item);
  });
  if (join) head.push(navEntry_(["workers", "Workers", "#/workers", "users"]));
  var groups = [{ id: "workspace", label: "Workspace", items: head }, { id: "lists", label: "Lists", items: lists }];
  // Pages an agent wrote and the routine put in the sidebar (nav: true); the group exists only when there are some.
  var pages = (extPages || []).filter(function (p) { return p && typeof p.id === "string"; });
  if (pages.length) {
    groups.push({ id: "pages", label: "Pages", items: pages.map(function (p) {
      return { id: "ext:" + p.id, label: String(p.title || p.id), href: "#/x/" + encodeURIComponent(p.id), icon: TYPE_ICON, children: [] };
    }) });
  }
  // Spec pages (desk.pages in the definition) join that group, or start their own when there are no code pages.
  var specItems = deskPages(definition).map(function (p) {
    var label = p.nav && typeof p.nav.label === "string" && p.nav.label !== "" ? p.nav.label : p.title;
    return { id: "spec:" + p.id, label: String(label), href: "#/p/" + encodeURIComponent(p.id), icon: navIcon_(p.nav && p.nav.icon, TYPE_ICON), children: [] };
  });
  if (specItems.length) {
    var shared = groups.filter(function (g) { return g.id === "pages"; })[0];
    if (shared) shared.items = shared.items.concat(specItems);
    else groups.push({ id: "specpages", label: "Pages", items: specItems });
  }
  return { groups: groups,
    settings: navEntry_(NAV_TAIL[0]), members: navEntry_(["members", "Members", "#/settings/members", "users"]) };
}

// Every top entry of a grouped nav in order, Settings last. A flat list passes through.
export function navFlat(nav) {
  if (Array.isArray(nav)) return nav;
  var out = [];
  ((nav && nav.groups) || []).forEach(function (g) { out = out.concat(g.items); });
  return nav && nav.settings ? out.concat([nav.settings]) : out;
}

// Phone: Today, Approvals, the first type, History, and More, which opens the rail as a drawer (no address).
export function bottomModel(nav) {
  var flat = navFlat(nav);
  var firstType = flat.filter(function (n) { return n.id.indexOf("type:") === 0; })[0];
  var by = function (id) { return flat.filter(function (n) { return n.id === id; })[0]; };
  return [by("today"), by("approvals"), firstType, by("history"), { id: "more", label: "More", icon: "menu", children: [] }].filter(Boolean);
}

// "Owner" when the viewer recorded meta/owner, "Member" for any other viewer, null with no viewer (read only).
export function viewerRole(ctx) {
  if (!ctx || !ctx.viewer) return null;
  return ctx.owner && ctx.owner.by === ctx.viewer ? "Owner" : "Member";
}

// The user menu entries in order. Signed in needs a viewer; the tour entry needs the tour on; Lock now needs meta/lock.
export function userMenuItems(ctx) {
  ctx = ctx || {};
  return [
    ctx.viewer ? { id: "signed-in", label: "Signed in" } : null,
    { id: "theme", label: "Theme" },
    { id: "density", label: "Density" },
    ctx.tour && !ctx.tourOff ? { id: "tour", label: "Take the tour" } : null,
    { id: "shortcuts", label: "Keyboard shortcuts" },
    ctx.lock ? { id: "lock", label: "Lock now" } : null,
  ].filter(Boolean);
}

// The letter after g for each type: the first letter of its plural, when no other type and no page owns it.
export function typeLetters(types) {
  var count = {};
  (types || []).forEach(function (t) {
    var k = String(t.plural || t.id || "").charAt(0).toLowerCase();
    if (k) count[k] = (count[k] || 0) + 1;
  });
  var out = {};
  (types || []).forEach(function (t) {
    var k = String(t.plural || t.id || "").charAt(0).toLowerCase();
    if (k && count[k] === 1 && !GO_KEYS[k]) out[k] = t;
  });
  return out;
}

// keys: the keys pressed so far, e.g. ["g", "t"]. Returns {pending}, {go: hash}, {run: name} or null.
export function shortcutFor(keys, types) {
  if (!keys || !keys.length) return null;
  if (keys[0] === "g") {
    if (keys.length === 1) return { pending: true };
    if (keys.length !== 2) return null;
    if (GO_KEYS[keys[1]]) return { go: GO_KEYS[keys[1]] };
    var t = typeLetters(types)[keys[1]];
    return t ? { go: "#/browse/" + encodeURIComponent(t.id) } : null;
  }
  if (keys.length === 1 && SINGLE_KEYS[keys[0]]) return { run: SINGLE_KEYS[keys[0]] };
  return null;
}

// Shortcuts never fire while a person types.
export function isTyping(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  var tag = String(target.tagName || "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  var host = target.getRootNode && (target.getRootNode() || {}).host;
  if (host && host !== target && isTyping(host)) return true;
  if (tag !== "INPUT") return false;
  return TEXT_INPUTS.indexOf(String(target.type || "").toLowerCase()) !== -1;
}

// Every page, type and view as a "Go to" command, then extra commands [{id, label, run, group}] in the order given.
export function paletteCommands(nav, extra) {
  var out = [];
  navFlat(nav).forEach(function (n) {
    out.push({ id: "go:" + n.id, label: "Go to " + n.label, href: n.href, group: "Go to" });
    n.children.forEach(function (c) { out.push({ id: "go:" + c.id, label: "Open view " + c.label + " (" + n.label + ")", href: c.href, group: "Go to" }); });
  });
  return out.concat(extra || []);
}

// The palette's groups, in order; a command with no group is an Action.
export var PALETTE_GROUPS = ["Go to", "Records", "Actions", "Settings"];

// Records whose key or display values hold every query word at the start of a word, case-insensitive; dropped
// records are left out. At most max (20) in the order given.
export function searchRecords(entities, q, max) {
  var words = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length || !Array.isArray(entities)) return [];
  max = typeof max === "number" ? max : 20;
  var out = [];
  for (var i = 0; i < entities.length && out.length < max; i++) {
    var d = entities[i] && entities[i].data;
    if (!d || d.status === "dropped") continue;
    var display = d.display && typeof d.display === "object" ? d.display : {};
    var fields = [d.key].concat(Object.keys(display).map(function (k) { return display[k]; }))
      .filter(function (v) { return typeof v === "string" || typeof v === "number"; })
      .map(function (v) { return String(v).toLowerCase(); });
    var tokens = fields.concat.apply(fields, fields.map(function (f) { return f.split(/[^a-z0-9]+/); }));
    if (words.every(function (w) { return tokens.some(function (t) { return t.indexOf(w) === 0; }); })) out.push(entities[i]);
  }
  return out;
}

// Record search over every row given: {hits, capped}. hits holds at most limit (20); capped is true only when more
// than limit records match, so the palette can say its list is cut.
export function search(term, rows, limit) {
  limit = typeof limit === "number" ? limit : 20;
  var all = searchRecords(rows, term, limit + 1);
  return { hits: all.slice(0, limit), capped: all.length > limit };
}

export var RESULTS_CAPPED = "Results capped. Keep typing to narrow them.";
export var SEARCH_UNAVAILABLE = "Record search is unavailable. Try again later.";

// The palette's own actions: switch theme always, the tour when it is on.
export function paletteActions(ctx) {
  return [{ id: "theme", label: "Switch theme" }].concat(ctx && ctx.tour ? [{ id: "tour", label: "Take the tour" }] : []);
}

// The next theme choice in the order the menu lists them.
export function nextTheme(cur) {
  var order = ["system", "light", "dark"];
  var i = order.indexOf(cur);
  return i === -1 ? "light" : order[(i + 1) % order.length];
}

export var SIGN_OUT_NOTE = "No sign-out here";

// "Signed in as <name>" for the user menu, or null when the name is not a real one.
export function signedInLine(name) {
  var n = typeof name === "string" ? name.trim() : "";
  return n && n !== "someone" && n !== "you" ? "Signed in as " + n : null;
}

export function matchCommands(cmds, q) {
  var words = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
  return cmds.filter(function (c) {
    var label = c.label.toLowerCase();
    return words.every(function (w) { return label.indexOf(w) !== -1; });
  });
}

// The ? dialog: every shortcut, with the type letters this workspace has.
export function shortcutRows(types) {
  var rows = [["g t", "Today"], ["g i", "Approvals"], ["g a", "Approvals"], ["g u", "Runs"], ["g h", "History"], ["g s", "Settings"]];
  var letters = typeLetters(types);
  Object.keys(letters).sort().forEach(function (k) { rows.push(["g " + k, letters[k].plural]); });
  return rows.concat([["/", "Search"], ["f", "Filters"], ["n", "Notifications"], ["[", "Full or slim sidebar"], ["j", "Next item"], ["k", "Previous item"], ["o", "Open the item"],
    ["Ctrl K or Cmd K", "Command palette"], ["?", "This list"], ["Esc", "Close the top panel"]]);
}

// "Search all records for <text>": a command for non-empty text only, opening the browse page of typeId with ?q=.
// No type, no command.
export function searchAllCommand(text, typeId) {
  var q = String(text || "").trim();
  if (!q || !typeId) return null;
  return { id: "search-all", label: "Search all records for " + q, href: "#/browse/" + encodeURIComponent(typeId) + "?q=" + encodeURIComponent(q) };
}
