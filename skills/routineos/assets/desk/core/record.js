// core/record.js: one record, drawn the same way for the full page and the peek body (spec 5.5, R7).
// A header (breadcrumb, star, title, source url, overflow menu), a status strip, a main column of section cards and a
// 320px Details rail. Under 900px, and in the peek, the rail comes first as section cards.
import { entityHash, entityText, recordKeys, recordTitle } from "./shared.js";
import { exportName } from "./exporter.js";
import { byId } from "./actions.js";
import { HEALTH_LABELS, applyFilters, chipSource, overlayRow, readFilterState, toRow, writeFilterState } from "./pages/browse.js";
import { peekPosition } from "./peek.js";

export var recC = { recordTitle: recordTitle, recordKeys: recordKeys, entityText: entityText, entityHash: entityHash };
export var RECORD_RAIL_KEY = "routineos-desk-record-rail";
export var NOTES_SHOW_KEY = "routineos-desk-show-notes";

export function recType(definition, type) {
  return (definition && definition.types && definition.types[type]) || { label: type, fields: {} };
}

export function recByAt(a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; }

export function recLine(s) { return String(s).replace(/\s+/g, " ").trim(); }

// One line of stored text as Markdown text: inline markup characters are escaped, and so is a list marker at the
// start, so a value never becomes a link, an image, HTML, emphasis or a list of its own.
export function recMdText(s) {
  return recLine(s).replace(/[\\`*_[\]()#!<>|~]/g, "\\$&").replace(/^([-+])(?=\s)/, "\\$1");
}

// The record as Markdown: its title, each field with a value as "- Label: value", then the summary text.
// Every value is one line of escaped text (recMdText), so stored text cannot start a heading, a list or a link.
export function recordMarkdown(d, definition) {
  var c = recC;
  var t = recType(definition, d.type), defs = t.fields || {}, v = d.display || {};
  var out = ["# " + recMdText(c.recordTitle(t, d)), ""];
  c.recordKeys(t).forEach(function (k) {
    var s = recMdText(c.entityText(v[k]));
    if (s && k !== SUMMARY_FIELD_) out.push("- " + recMdText(defs[k].label || k) + ": " + s);
  });
  var sum = recMdText(c.entityText(v[SUMMARY_FIELD_]));
  if (sum) out.push("", sum);
  return out.join("\n") + "\n";
}
export var SUMMARY_FIELD_ = "summary";

// The health of a record from desk.health (spec 7c): {value, tone} or null.
export function recHealth(def, type, v) {
  var h = def.desk && def.desk.health && def.desk.health[type];
  if (!h || v[h.field] === undefined) return null;
  var x = v[h.field];
  var tone = (h.red || []).indexOf(x) !== -1 ? "danger" : (h.yellow || []).indexOf(x) !== -1 ? "warning" : (h.green || []).indexOf(x) !== -1 ? "success" : null;
  return tone ? { value: entityText(x), tone: tone } : null;
}

// Everything that happened to a record, newest first (spec 5.5): sightings, field changes between sightings,
// merges either way, the decision, settings changes of its producers, and comments. Each event is
// {at, kind, by?, parts}; a part is text, {person: id} or {link: {label, href}}. o.id is the record's doc id.
export function recordEvents(d, o) {
  o = o || {};
  var id = o.id, out = [], src = d.sources || [], prev = null;
  var defs = recType(o.definition, d.type).fields || {};
  function add(at, kind, by, parts) { out.push({ at: at, kind: kind, by: by || undefined, parts: by ? [{ person: by }, " "].concat(parts) : parts }); }
  (d.sightings || []).slice().sort(recByAt).forEach(function (x) {
    var v = x.values || {};
    if (prev) Object.keys(v).forEach(function (k) {
      var a = recC.entityText(prev[k]), b = recC.entityText(v[k]);
      if (a !== b) add(x.at, "change", null, [((defs[k] || {}).label || k) + ": " + (a || "empty") + " to " + (b || "empty")]);
    });
    prev = v;
    add(x.at, "seen", null, ["Seen by " + x.producer + (x.outcome ? ", " + x.outcome : "")].concat(
      x.dropReason ? [" Reason: " + x.dropReason] : [], x.note ? [" Note: " + x.note] : [],
      x.run ? [" ", { link: { label: "Run " + x.run, href: "#/runs/" + encodeURIComponent(x.run) } }] : []));
  });
  (o.merges || []).forEach(function (m) {
    var from = String(m.id).replace(/^merges\//, ""), x = m.data || {}, other = from === id ? x.into : from;
    if (other && (from === id || x.into === id)) add(x.at, "merge", x.by, [from === id ? "merged this into " : "merged into this ",
      { link: { label: other, href: recC.entityHash(other) } }]);
  });
  (o.decisions || []).forEach(function (x) {
    x = x.data || x;
    add(x.at, "decision", x.by, [x.decision === "keep" ? "kept this" : "dropped this" + (x.reason ? ": " + x.reason : "")]);
  });
  (o.settingsHistory || []).forEach(function (h) {
    var x = h.data || {}, b = x.before || {}, a = x.after || {};
    if (src.indexOf(x.producer) !== -1) add(x.at, "setting", x.by, ["changed " + x.producer + " settings: " + Object.keys(a).filter(function (k) {
      return JSON.stringify(a[k]) !== JSON.stringify(b[k]);
    }).join(", ")]);
  });
  (o.comments || []).forEach(function (c) {
    var x = c.data || {};
    if (x.entity === id && !x.edits && !x.deleted) add(x.at, "comment", x.by, [x.replyTo ? "replied" : "commented"]);
  });
  return out.sort(recByAt).reverse();
}

// The events to draw: all, or with value changes past the 5 newest left out. {events, hidden}.
export function recShown(events, all) {
  var n = 0, ev = events.filter(function (e) { return all || e.kind !== "change" || ++n <= 5; });
  return { events: ev, hidden: events.length - ev.length };
}

// A comment doc id <entity>--<author>--<ts36> as {author, ts}, or null. The author and time are read from the right,
// since an entity id holds "--" itself.
export function commentIdParts(id) {
  var p = String(id).replace(/^comments\//, "").split("--"), ts = parseInt(p[p.length - 1], 36);
  return p.length > 2 && p[p.length - 2] && isFinite(ts) ? { author: p[p.length - 2], ts: ts } : null;
}

// Comments as shown (spec 7d): a doc counts only when its by is the author in its id. For each original, the newest
// edit or delete whose id author is the original's and whose id time is within 15 minutes after the original's
// applies; others are ignored, so the window holds wherever edits are read, not only in the UI. canEdit only on the
// viewer's own, for 15 minutes after posting. Oldest first.
export function commentView(docs, viewer, now) {
  var mine = docs.filter(function (c) { var x = c.data || {}, p = commentIdParts(c.id); return p && x.by === p.author; });
  var orig = {}, last = {};
  mine.forEach(function (c) { if (!c.data.edits) orig[c.id] = commentIdParts(c.id); });
  mine.forEach(function (c) {
    var x = c.data, o = x.edits && String(x.edits).replace(/^comments\//, ""), a = orig[o], p = commentIdParts(c.id);
    if (a && p.author === a.author && p.ts >= a.ts && p.ts - a.ts <= 9e5 && (!last[o] || last[o].at < x.at)) last[o] = x;
  });
  return mine.filter(function (c) { return !c.data.edits; }).map(function (c) {
    var x = c.data, e = last[c.id];
    return e && e.deleted ? null : { id: c.id, by: x.by, text: (e || x).text, at: x.at, edited: !!e,
      canEdit: !!viewer && x.by === viewer && now - orig[c.id].ts < 9e5 };
  }).filter(Boolean).sort(recByAt);
}

export var REC_ICONS = { seen: "dot", change: "pencil", merge: "users", decision: "check", setting: "settings", comment: "message-square" };

// One record as a file: {name, body}. fmt is "md" (recordMarkdown) or "json" (the display values). The name is
// "<workspace>-<title>-<date>.<fmt>", the same shape as the list exports.
export function exportRecord(rec, fmt, definition, workspace) {
  var t = recType(definition, rec.type);
  var ext = fmt === "json" ? "json" : "md";
  var body = ext === "json" ? JSON.stringify(Object.assign({ id: rec.id, type: rec.type }, rec.display || {}), null, 2) + "\n"
    : recordMarkdown(rec, definition);
  return { name: exportName(workspace, recordTitle(t, rec), null, ext), body: body };
}

// Where a record sits in the list it was opened from: the entity route's filters read as Items filters, over the
// same rows Browse shows (a person's stars and tags, and a decision that waits for the next run). Resolves
// {index, total, label, prev, next, qs} or null when the address carries no filters, the record is not in the list
// or a read fails.
export function recPosition(ctx, type, id, query, def) {
  var fs = readFilterState(query || {}), qs = writeFilterState(fs);
  if (!qs) return Promise.resolve(null);
  var src = chipSource(def, type);
  if (src && src.kind === "health") fs.healthRule = src.rule;
  fs.now = new Date().toISOString();
  function more(c) { return ctx.store.list(c).then(byId, function () { return {}; }); }
  return Promise.all([ctx.store.list("entities", { where: [["type", "==", type]] }), more("userstate"), more("decisions")]).then(function (r) {
    var ids = applyFilters(r[0].map(function (d) { return overlayRow(toRow(d, r[1][d.id]), r[2][d.id]); }), fs).map(function (x) { return x.id; });
    var p = peekPosition(ids, id);
    if (p.index === null) return null;
    var t = recType(def, type);
    return { index: p.index, total: p.total, qs: qs, prev: p.prev, next: p.next,
      label: fs.health ? HEALTH_LABELS[fs.health] : (t.plural || t.label || type) };
  }, function () { return null; });
}
