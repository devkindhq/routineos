// app/componentUi.js: what a routine's custom field component builds with, and the call that draws one.
// A component is a factory in window.DESK_COMPONENTS: (ctx, {value, record, field}, ui) -> an element. It gets a
// restricted el (COMPONENT_TAGS and componentAttr only, https links only) and plain helpers with no click handlers.
// Whatever it returns is checked again before it is shown: a non-element, a tag outside the allow-list anywhere in
// the tree, or an event handler attribute draws the fallback. This narrows the API; it is not a sandbox.
import { human } from "../core/dates.js";
import { COMPONENT_TAGS, componentAttr, componentCtx } from "../core/pages/browse.js";
import { EXT_TAGS, extAttr, extImageSrc, extTag } from "../core/ext.js";
import { entityHash } from "../core/shared.js";
import { markdownNode } from "./componentMarkdown.js";

function isHttpsUrl(value) {
  try { return new URL(String(value)).protocol === "https:"; } catch (e) { return false; }
}

function append(node, kids) {
  (Array.isArray(kids) ? kids : [kids]).forEach(function (k) {
    if (k === null || k === undefined || k === false) return;
    if (Array.isArray(k)) append(node, k);
    else node.appendChild(typeof k === "object" && k.nodeType ? k : document.createTextNode(String(k)));
  });
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

// The page's own element maker: attributes only, never a property or a handler.
function make(tag, attrs, kids) {
  var node = document.createElement(tag);
  Object.keys(attrs || {}).forEach(function (k) {
    var v = attrs[k];
    if (v === null || v === undefined || v === false) return;
    node.setAttribute(k, v === true ? "" : String(v));
  });
  return append(node, kids);
}

function el(tag, attrs) {
  var t = String(tag).toLowerCase();
  if (COMPONENT_TAGS.indexOf(t) === -1) throw new Error("Tag " + t + " is not allowed in a component");
  var safe = {};
  Object.keys(attrs || {}).forEach(function (k) {
    var name = k.toLowerCase();
    var v = attrs[k];
    if (!componentAttr(name) || typeof v === "function") throw new Error("Attribute " + k + " is not allowed in a component");
    if (name === "href" && v !== null && v !== undefined && v !== false && !isHttpsUrl(v)) {
      throw new Error("Only an https link is allowed in a component");
    }
    safe[name] = v;
  });
  return make(t, safe, Array.prototype.slice.call(arguments, 2));
}

function shortLabel(value) {
  var s = String(value);
  try {
    var u = new URL(s);
    if (u.protocol === "https:" || u.protocol === "http:") return u.hostname.replace(/^www\./, "");
  } catch (e) { /* not a URL */ }
  return s;
}

function urlOrText(value) {
  return isHttpsUrl(value) ? make("a", { href: String(value), rel: "noopener noreferrer" }, String(value)) : String(value);
}

export function componentUi() {
  return {
    el: el, append: append, clear: clear,
    badge: function (text, tone) { return make("span", { class: "badge" + (tone ? " " + tone : "") }, text); },
    agentBadge: function (label) { return make("span", { class: "badge agent" }, "agent made" + (label ? ", " + label : "")); },
    button: function (label, _onClick, opts) {
      return make("span", { class: "button", title: (opts && opts.iconOnly) ? String(label) : null }, label);
    },
    chip: function (label, opts) {
      opts = opts || {};
      return make("span", { class: "chip" }, [label, opts.count === undefined || opts.count === null ? null : make("span", { class: "count" }, String(opts.count))]);
    },
    when: function (iso) { return human(iso, Date.now()); },
    shortLabel: shortLabel, entityHash: entityHash, urlOrText: urlOrText,
  };
}

// Every element in the tree uses an allowed tag and no on* attribute. Links stay https.
function allowedTree(node) {
  if (node.nodeType === 3) return true;
  if (node.nodeType !== 1) return false;
  var tag = node.tagName.toLowerCase();
  if (COMPONENT_TAGS.indexOf(tag) === -1) return false;
  for (var i = 0; i < node.attributes.length; i++) {
    var a = node.attributes[i].name.toLowerCase();
    if (a === "rel" && tag === "a") continue;
    if (!componentAttr(a)) return false;
    if (a === "href" && !isHttpsUrl(node.attributes[i].value)) return false;
  }
  for (var c = node.firstChild; c; c = c.nextSibling) if (!allowedTree(c)) return false;
  return true;
}

// The element a component draws for one field, or null when it is missing, throws, or returns anything unsafe.
export function renderComponent(id, props, store) {
  var reg = typeof window !== "undefined" ? window.DESK_COMPONENTS : null;
  var fn = reg && Object.prototype.hasOwnProperty.call(reg, id) ? reg[id] : null;
  if (typeof fn !== "function") return null;
  var out;
  try {
    out = fn(componentCtx(store), { value: props.value, record: props.record, field: props.field }, componentUi());
  } catch (e) {
    return null;
  }
  if (!out || typeof out !== "object" || out.nodeType !== 1) return null;
  return allowedTree(out) ? out : null;
}

// Interactive slots (record section, panel, page): the field cell helpers plus working buttons and inputs. The
// extra tags and attributes are listed in core/ext.js; no on* attribute is ever allowed, so a click handler exists
// only through ui.button, and it can reach nothing but the ctx.actions the component was handed.
function extEl(tag, attrs) {
  var t = String(tag).toLowerCase();
  if (!extTag(t)) throw new Error("Tag " + t + " is not allowed in a component");
  var safe = {};
  Object.keys(attrs || {}).forEach(function (k) {
    var name = k.toLowerCase();
    var v = attrs[k];
    if (typeof v === "function" || !extAttr(name, t, v, extImageSrc)) throw new Error("Attribute " + k + " is not allowed in a component");
    if (name === "href" && v !== null && v !== undefined && v !== false && !isHttpsUrl(v)) {
      throw new Error("Only an https link is allowed in a component");
    }
    safe[name] = v;
  });
  return make(t, safe, Array.prototype.slice.call(arguments, 2));
}

// onError(e) gets a verb's rejection or a thrown error from a click, so the host can say it. writable false (a
// read-only or signed-out visit) draws every button disabled unless the component passes {local: true} for a button
// that changes nothing shared.
export function interactiveUi(onError, writable) {
  var base = componentUi();
  function field(tag, attrs) { return extEl(tag, attrs); }
  return Object.assign({}, base, {
    el: extEl,
    button: function (label, onClick, opts) {
      var off = writable === false && !(opts && opts.local === true);
      var b = make("button", { type: "button", class: "button", disabled: off,
        title: off ? "Changes are not available on this visit" : (opts && opts.iconOnly) ? String(label) : null }, label);
      b.addEventListener("click", function () {
        if (typeof onClick !== "function" || b.disabled) return;
        b.disabled = true;
        Promise.resolve().then(function () { return onClick(); }).then(function () { b.disabled = false; }, function (e) {
          b.disabled = false;
          try { onError(e); } catch (x) { /* the host's own reporter failed; nothing more to do */ }
        });
      });
      return b;
    },
    input: function (attrs) { return field("input", Object.assign({ type: "text" }, attrs)); },
    textarea: function (attrs) { return field("textarea", attrs); },
    image: function (src, alt) {
      return extImageSrc(src) ? extEl("img", { src: src, alt: alt || "" }) : make("span", { class: "muted" }, alt || "");
    },
    markdown: function (text, opts) { return markdownNode(text, opts); },
    valueOf: function (node) { return node && typeof node.value === "string" ? node.value : ""; },
    status: function (text) { return make("span", { "aria-live": "polite" }, text || ""); },
  });
}

// True when every element in the tree uses an allowed interactive tag and attribute. The host runs it after the
// factory returns and again after any later change to the tree.
export function extTreeOk(node) {
  if (node.nodeType === 3) return true;
  if (node.nodeType !== 1) return false;
  var tag = node.tagName.toLowerCase();
  if (EXT_TAGS.indexOf(tag) === -1) return false;
  for (var i = 0; i < node.attributes.length; i++) {
    var a = node.attributes[i].name.toLowerCase();
    var val = node.attributes[i].value;
    if (a === "rel" && tag === "a") continue;
    if (!extAttr(a, tag, val, extImageSrc)) return false;
    if (a === "href" && !isHttpsUrl(val)) return false;
  }
  for (var c = node.firstChild; c; c = c.nextSibling) if (!extTreeOk(c)) return false;
  return true;
}

// The element an extension draws, or null when it is missing, throws, or returns anything unsafe.
export function renderExtension(id, props, ctx, onError) {
  var reg = typeof window !== "undefined" ? window.DESK_COMPONENTS : null;
  var fn = reg && Object.prototype.hasOwnProperty.call(reg, id) ? reg[id] : null;
  if (typeof fn !== "function") return null;
  var out;
  try {
    out = fn(ctx, props, interactiveUi(onError, ctx && ctx.canWrite));
  } catch (e) {
    return null;
  }
  if (!out || typeof out !== "object" || out.nodeType !== 1) return null;
  return extTreeOk(out) ? out : null;
}
