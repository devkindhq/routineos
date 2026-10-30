/* src/palette.js: the sidebar model, keyboard shortcuts and the command palette (spec "Shell and navigation").
   The pure parts (navModel, bottomModel, shortcutFor, isTyping, paletteCommands, matchCommands) are tested in
   tests/visual/shell.test.mjs; the shell draws them. */

var NAV_HEAD = [["today", "Today", "#/today", "house"], ["inbox", "Inbox", "#/inbox", "inbox"], ["approvals", "Approvals", "#/approvals", "badge-check"]];
var NAV_TAIL = [["history", "History", "#/history", "history"], ["settings", "Settings", "#/settings", "settings"]];
// A type without an icon shows a list; a view without one shows a dot under its type.
var TYPE_ICON = "list";
var VIEW_ICON = "dot";
var GO_KEYS = { t: "#/today", i: "#/inbox", a: "#/approvals", h: "#/history", s: "#/settings" };
var SINGLE_KEYS = { "/": "search", f: "filters", n: "notifications", "[": "sidebar", "?": "help" };
var TEXT_INPUTS = ["text", "search", "email", "url", "tel", "password", "number", "date", "datetime-local", "time", "month", "week", ""];

function navTypes_(definition) {
  var t = (definition && definition.types) || {};
  return Object.keys(t).sort().map(function (id) {
    return { id: id, plural: t[id].plural || t[id].label || id, icon: t[id].icon };
  });
}

function navEntry_(row) {
  return { id: row[0], label: row[1], href: row[2], icon: row[3], children: [] };
}

// The named icon when the sprite has it, else the default. Lint refuses unknown names in a definition; a stored
// view is checked here too, so a bad name never blanks the nav or throws.
function navIcon_(name, fallback) {
  return typeof name === "string" && typeof ICONS === "object" && Object.prototype.hasOwnProperty.call(ICONS, name) ? name : fallback;
}

// views: saved view docs [{id, data: {type, name, state}}]; the definition's own views are added here.
// pins: Set of view ids this viewer pinned (or null). A pinned view sits at the top of its type.
// join: the Desk's join card (meta/join) or null; with one, Workers sits before History.
function navModel(definition, views, pins, join) {
  pins = pins || new Set();
  var all = ((definition && definition.views) || []).map(function (v) { return { id: v.id, data: v }; }).concat(views || []);
  var out = NAV_HEAD.map(navEntry_);
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
    out.push({ id: "type:" + t.id, label: t.plural, href: "#/browse/" + encodeURIComponent(t.id), icon: navIcon_(t.icon, TYPE_ICON), children: kids });
  });
  if (join) out.push(navEntry_(["workers", "Workers", "#/workers", "users"]));
  return out.concat(NAV_TAIL.map(navEntry_));
}

// Phone: Today, Inbox, the first type, History, Settings.
function bottomModel(nav) {
  var firstType = nav.filter(function (n) { return n.id.indexOf("type:") === 0; })[0];
  return nav.filter(function (n) {
    return n.id === "today" || n.id === "inbox" || n === firstType || n.id === "history" || n.id === "settings";
  });
}

// The letter after g for each type: the first letter of its plural, when no other type and no page owns it.
function typeLetters(types) {
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
function shortcutFor(keys, types) {
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
function isTyping(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  var tag = String(target.tagName || "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  return TEXT_INPUTS.indexOf(String(target.type || "").toLowerCase()) !== -1;
}

// Every page, type and view as a "Go to" command, then extra commands [{id, label, run}] in the order given.
function paletteCommands(nav, extra) {
  var out = [];
  nav.forEach(function (n) {
    out.push({ id: "go:" + n.id, label: "Go to " + n.label, href: n.href });
    n.children.forEach(function (c) { out.push({ id: "go:" + c.id, label: "Open view " + c.label + " (" + n.label + ")", href: c.href }); });
  });
  return out.concat(extra || []);
}

function matchCommands(cmds, q) {
  var words = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
  return cmds.filter(function (c) {
    var label = c.label.toLowerCase();
    return words.every(function (w) { return label.indexOf(w) !== -1; });
  });
}

// The palette dialog. opts: {commands, query, onPick(cmd), onClose()}. Arrow keys move, Enter runs.
function paletteDialog(opts) {
  var input = el("input", { type: "search", class: "pal-input", "aria-label": "Type a command or a page", placeholder: "Type a command or a page",
    autocomplete: "off", spellcheck: "false" });
  input.value = opts.query || "";
  var list = el("ul", { class: "pal-list", role: "listbox", "aria-label": "Commands" });
  var shown = [];
  var at = 0;
  function draw() {
    shown = matchCommands(opts.commands, input.value);
    if (at >= shown.length) at = Math.max(0, shown.length - 1);
    clear(list);
    if (!shown.length) { append(list, el("li", { class: "pal-none muted" }, "No command matches.")); return; }
    shown.forEach(function (c, i) {
      append(list, el("li", { role: "option", class: "pal-item", "aria-selected": i === at ? "true" : "false",
        onmousedown: function (e) { e.preventDefault(); opts.onPick(c); } }, c.label));
    });
  }
  input.addEventListener("input", function () { at = 0; draw(); });
  input.addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown") { e.preventDefault(); at = Math.min(at + 1, shown.length - 1); draw(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); at = Math.max(at - 1, 0); draw(); }
    else if (e.key === "Enter") { e.preventDefault(); if (shown[at]) opts.onPick(shown[at]); }
  });
  draw();
  var box = el("div", { class: "pal-back", onmousedown: function (e) { if (e.target === box) opts.onClose(); } },
    el("div", { class: "pal", role: "dialog", "aria-label": "Command palette" }, input, list));
  box.focusInput = function () { input.focus(); };
  return box;
}

// The ? dialog: every shortcut, with the type letters this workspace has.
function shortcutRows(types) {
  var rows = [["g t", "Today"], ["g i", "Inbox"], ["g a", "Approvals"], ["g h", "History"], ["g s", "Settings"]];
  var letters = typeLetters(types);
  Object.keys(letters).sort().forEach(function (k) { rows.push(["g " + k, letters[k].plural]); });
  return rows.concat([["/", "Search"], ["f", "Filters"], ["n", "Notifications"], ["[", "Full or slim sidebar"],
    ["Ctrl K or Cmd K", "Command palette"], ["?", "This list"], ["Esc", "Close the top panel"]]);
}

if (typeof module === "object" && module.exports) {
  module.exports = { navModel: navModel, bottomModel: bottomModel, typeLetters: typeLetters, shortcutFor: shortcutFor, isTyping: isTyping,
    paletteCommands: paletteCommands, matchCommands: matchCommands, shortcutRows: shortcutRows, paletteDialog: paletteDialog };
}
