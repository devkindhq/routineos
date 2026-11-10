// app/componentMarkdown.js: ui.markdown for interactive extension slots. Text becomes a DOM tree from marked's token
// tree (marked only lexes). Nothing is ever written as HTML: a raw HTML tag in the source is shown as text, an image is
// its alt text, and a link is live only for an https address (anything else is plain text). Headings use h3 and h4
// (h1 to h3 map to h3, deeper to h4). Phrases to highlight are wrapped in <mark> inside single text nodes only, so a
// phrase that spans two tags is not marked. Every tag built is in EXT_TAGS; the host still checks the tree afterwards.
import { Lexer } from "marked";

function httpsHref(href) {
  try {
    var u = new URL(String(href));
    return u.protocol === "https:" ? u.href : null;
  } catch (e) { return null; }
}

function node(tag, attrs, kids) {
  var n = document.createElement(tag);
  Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
  (kids || []).forEach(function (k) { n.appendChild(typeof k === "string" ? document.createTextNode(k) : k); });
  return n;
}

function markRegex(marks) {
  var parts = (Array.isArray(marks) ? marks : []).map(String).filter(function (m) { return m.trim() !== ""; })
    .sort(function (a, b) { return b.length - a.length; })
    .map(function (m) { return m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); });
  return parts.length ? new RegExp(parts.join("|"), "gi") : null;
}

// A string as text nodes with each marked phrase wrapped in <mark>.
function marked(text, re) {
  text = String(text);
  if (!re) return [text];
  var out = [], last = 0, m;
  re.lastIndex = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(node("mark", {}, [m[0]]));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function hasText(text, re) {
  if (!re) return false;
  re.lastIndex = 0;
  return re.test(String(text));
}

function leaf(t) {
  return t.type === "image" ? (t.text || "") : (t.text !== undefined ? t.text : t.raw);
}

// True when one text node of the block would hold a mark (the same test the highlighter uses).
function blockHas(tokens, re) {
  return (tokens || []).some(function (t) {
    if (t.type === "list") return t.items.some(function (it) { return blockHas(it.tokens, re); });
    if (t.type === "table") {
      return t.header.concat([].concat.apply([], t.rows)).some(function (c) { return blockHas(c.tokens, re); });
    }
    if (t.tokens) return blockHas(t.tokens, re);
    if (t.type === "br" || t.type === "space" || t.type === "hr") return false;
    return hasText(leaf(t), re);
  });
}

function inline(tokens, re) {
  var out = [];
  (tokens || []).forEach(function (t) {
    var kids = t.tokens ? inline(t.tokens, re) : null;
    if (t.type === "strong") out.push(node("strong", {}, kids));
    else if (t.type === "em") out.push(node("em", {}, kids));
    else if (t.type === "codespan") out.push(node("code", {}, marked(t.text, re)));
    else if (t.type === "br") out.push(node("br"));
    else if (t.type === "image") out.push.apply(out, marked(t.text || "", re));
    else if (t.type === "link") {
      var href = httpsHref(t.href);
      if (href) out.push(node("a", { href: href, rel: "noopener noreferrer" }, kids));
      else out.push.apply(out, kids);
    } else if (kids) out.push.apply(out, kids);
    else out.push.apply(out, marked(leaf(t), re));
  });
  return out;
}

function cell(tag, c, re) { return node(tag, {}, inline(c.tokens, re)); }

function blocks(tokens, re, only, inItem) {
  var out = [];
  (tokens || []).forEach(function (t) {
    if (t.type === "space" || t.type === "hr") return;
    if (only && !blockHas([t], re)) return;
    if (t.type === "heading") out.push(node(t.depth <= 3 ? "h3" : "h4", {}, inline(t.tokens, re)));
    else if (t.type === "list") {
      var items = t.items.filter(function (it) { return !only || blockHas(it.tokens, re); });
      out.push(node(t.ordered ? "ol" : "ul", {}, items.map(function (it) {
        return node("li", {}, blocks(it.tokens, re, only, true));
      })));
    } else if (t.type === "blockquote") out.push(node("div", {}, blocks(t.tokens, re, only)));
    else if (t.type === "code") out.push(node("p", {}, [node("code", {}, marked(t.text, re))]));
    else if (t.type === "table") {
      out.push(node("table", {}, [
        node("thead", {}, [node("tr", {}, t.header.map(function (c) { return cell("th", c, re); }))]),
        node("tbody", {}, t.rows.map(function (r) { return node("tr", {}, r.map(function (c) { return cell("td", c, re); })); })),
      ]));
    } else if (t.type === "text" && inItem) out.push.apply(out, inline(t.tokens || [t], re));
    else out.push(node("p", {}, t.tokens ? inline(t.tokens, re) : marked(leaf(t), re)));
  });
  return out;
}

// opts: marks (phrases to highlight, any case), onlyMarked (keep only the paragraphs, headings, list items and
// table or quote blocks that hold a mark, so with no marks it shows nothing), clamp (show at most this many top-level blocks).
export function markdownNode(text, opts) {
  opts = opts || {};
  var re = markRegex(opts.marks);
  var kids = blocks(new Lexer().lex(typeof text === "string" ? text : ""), re, opts.onlyMarked === true, false);
  var n = Number(opts.clamp);
  if (n >= 1) kids = kids.slice(0, n);
  return node("div", {}, kids);
}
