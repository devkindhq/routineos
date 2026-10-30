/* src/ui.js: DOM builders. Stored text only ever reaches the page as text nodes. */

function el(tag, attrs) {
  var node = document.createElement(tag);
  Object.keys(attrs || {}).forEach(function (k) {
    var v = attrs[k];
    if (v === null || v === undefined || v === false) return;
    if (k.slice(0, 2) === "on" && typeof v === "function") {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === "class") {
      node.className = String(v);
    } else {
      node.setAttribute(k, v === true ? "" : String(v));
    }
  });
  for (var i = 2; i < arguments.length; i++) append(node, arguments[i]);
  return node;
}

function append(node, child) {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) {
    child.forEach(function (c) { append(node, c); });
  } else if (typeof child === "object" && child.nodeType) {
    node.appendChild(child);
  } else {
    node.appendChild(document.createTextNode(String(child)));
  }
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// tone: ok, warn, fail, or none. The text always states the meaning; colour only supports it.
function badge(text, tone) {
  return el("span", { class: "badge" + (tone ? " " + tone : "") }, text);
}

function agentBadge(producerLabel) {
  return el("span", { class: "badge agent" }, "agent made" + (producerLabel ? ", " + producerLabel : ""));
}

// One primary per card; every other button is a ghost. opts.icon adds a Lucide icon before the label;
// with opts.iconOnly the label becomes the aria-label and the title tooltip instead of visible text.
// opts.pressed (true or false) makes it a toggle with aria-pressed.
function button(label, onClick, opts) {
  opts = opts || {};
  var iconOnly = !!(opts.icon && opts.iconOnly);
  return el("button", {
    type: "button",
    class: (opts.primary ? "primary" : "ghost") + (iconOnly ? " icon-btn" : ""),
    disabled: !!opts.disabled,
    title: opts.title || (iconOnly ? label : null),
    "aria-label": iconOnly ? label : null,
    "aria-pressed": opts.pressed === undefined ? null : (opts.pressed ? "true" : "false"),
    onclick: onClick || null,
  }, opts.icon ? icon(opts.icon) : null, iconOnly ? null : label);
}

function chip(label, opts) {
  opts = opts || {};
  return el("button", {
    type: "button",
    class: "chip",
    "aria-pressed": opts.pressed ? "true" : "false",
    onclick: opts.onClick || null,
  }, label);
}

// columns: [{key, label, mono}]; rows: plain objects. Cells are text.
function table(columns, rowsData) {
  return el("table", null,
    el("thead", null, el("tr", null, columns.map(function (c) { return el("th", { scope: "col" }, c.label); }))),
    el("tbody", null, rowsData.map(function (r) {
      return el("tr", null, columns.map(function (c) {
        var v = r[c.key];
        return el("td", { class: c.mono ? "mono" : null }, v === undefined || v === null ? "" : v);
      }));
    })));
}

// Stacked phone rows: the first field is the title, the rest sit under it.
function rows(items, fields) {
  return el("ul", { class: "rows" }, items.map(function (it) {
    var first = fields[0];
    return el("li", null,
      el("div", { class: "primary-field" }, it[first] === undefined ? "" : it[first]),
      el("div", { class: "fields" }, fields.slice(1).map(function (f) {
        return it[f] === undefined || it[f] === null ? null : el("span", null, it[f]);
      })));
  }));
}

// Inline SVG built node by node; attributes only, never markup.
function svg(tag, attrs) {
  var node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, String(attrs[k])); });
  for (var i = 2; i < arguments.length; i++) append(node, arguments[i]);
  return node;
}

// Stored timestamps shown exactly, as UTC minutes: 2026-10-28 08:00.
function when(iso) {
  if (!iso) return "";
  var s = String(iso);
  return /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(s) ? s.slice(0, 10) + " " + s.slice(11, 16) : s;
}

// Entity doc ids are <type>--<rest>; the route carries both parts.
function entityHash(id) {
  var s = String(id);
  var i = s.indexOf("--");
  if (i === -1) return "#/today";
  return "#/entity/" + encodeURIComponent(s.slice(0, i)) + "/" + encodeURIComponent(s.slice(i + 2));
}

function producerLabel(definition, id) {
  var ps = (definition && definition.producers) || [];
  for (var i = 0; i < ps.length; i++) if (ps[i].id === id) return ps[i].label || id;
  return id || "";
}

// A stored URL becomes a link only over https; anything else stays plain text.
function isHttpsUrl(value) {
  try {
    return new URL(String(value)).protocol === "https:";
  } catch (e) {
    return false;
  }
}

// A short link label: the host name of an http(s) URL, without www. Anything else is returned as given.
function shortLabel(value) {
  var s = String(value);
  try {
    var u = new URL(s);
    if (u.protocol === "https:" || u.protocol === "http:") return u.hostname.replace(/^www\./, "");
  } catch (e) { /* not a URL */ }
  return s;
}

function urlOrText(value) {
  return isHttpsUrl(value) ? el("a", { href: String(value), rel: "noopener noreferrer" }, String(value)) : String(value);
}

// Session links render only for claude.ai over https; anything else stays plain text.
function isClaudeSessionUrl(value) {
  try {
    var u = new URL(String(value));
    var h = u.hostname.toLowerCase();
    return u.protocol === "https:" && (h === "claude.ai" || h.endsWith(".claude.ai"));
  } catch (e) {
    return false;
  }
}

if (typeof module === "object" && module.exports) {
  module.exports = { el: el, append: append, clear: clear, badge: badge, agentBadge: agentBadge, button: button, chip: chip, when: when,
    svg: svg, shortLabel: shortLabel, entityHash: entityHash };
}
