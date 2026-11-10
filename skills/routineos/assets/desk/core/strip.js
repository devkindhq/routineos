// core/strip.js: the chips under a record's heading. The default order is state, notes, decision, captured, run, type,
// last seen. A routine may declare its own list per type at desk.record.strip: [{chip: name} | {field: name}].
// Every chip reads a field the record already has; one the record lacks is left out, never filled with something else.
import { human } from "./dates.js";
import { keepState } from "./pages/entity.js";
import { recHealth, recType } from "./record.js";
import { entityText, isSafeImageSrc, noteBox } from "./shared.js";

export var STRIP_DEFAULT = ["state", "notes", "decision", "captured", "run", "type", "lastSeen"];

function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }

// The run of the newest sighting, or "".
function newestRun(d) {
  var s = (d.sightings || []).slice().sort(function (a, b) { return a.at === b.at ? 0 : a.at < b.at ? 1 : -1; })[0];
  return s && typeof s.run === "string" ? s.run : "";
}

// One chip as {key, label, value}, or null when the record has nothing for it. label is the text to draw; value is
// the datum: a health tone, a keep state, a note count, a time, a run id or the type name.
function chip(name, d, keep, def, now) {
  var t = recType(def, d.type), cap = d.capture && typeof d.capture === "object" ? d.capture : null, v = d.display || {};
  if (name === "state") {
    var h = recHealth(def, d.type, v);
    return h ? { key: "state", label: h.value, value: h.tone } : null;
  }
  if (name === "notes") {
    if (!cap) return null;
    var n = Array.isArray(cap.notes) ? cap.notes.length : 0;
    var img = isSafeImageSrc(cap.image), placed = img ? cap.notes.filter((x) => noteBox(x && x.box)).length : n;
    // On an image the count is of the notes that sit on it; the others are named, never folded into the total.
    var label = !n ? "No notes" : img && placed < n ? placed + " placed, " + (n - placed) + " not placed" : plural(n, img ? "image note" : "note");
    return { key: "notes", label: label, value: n };
  }
  if (name === "decision") return { key: "decision", label: keepState(d, keep), value: keepState(d, keep) };
  if (name === "captured") {
    var at = cap && cap.capturedAt ? human(cap.capturedAt, now, { style: "sentence" }) : "";
    return at ? { key: "captured", label: "Captured " + at, value: cap.capturedAt } : null;
  }
  if (name === "run") {
    var run = newestRun(d);
    return run ? { key: "run", label: "Run " + run, value: run } : null;
  }
  if (name === "type") return { key: "type", label: t.label || d.type, value: d.type };
  if (name === "lastSeen") {
    var seen = d.lastSeen ? human(d.lastSeen, now, { style: "sentence" }) : "";
    return seen ? { key: "lastSeen", label: "Last seen " + seen, value: d.lastSeen } : null;
  }
  return null;
}

// The strip for a record: [{key, label, value}] in order. A declared field chip reads the record's display value
// and is left out when it is empty.
export function stripItems(d, keep, def, now) {
  now = now === undefined ? Date.now() : now;
  var declared = def && def.desk && def.desk.record && def.desk.record.strip && def.desk.record.strip[d.type];
  var spec = Array.isArray(declared) ? declared : STRIP_DEFAULT.map(function (c) { return { chip: c }; });
  var out = [];
  spec.forEach(function (it) {
    var item = null;
    if (it && it.chip) item = chip(it.chip, d, keep, def, now);
    else if (it && it.field) {
      var x = (d.display || {})[it.field], text = x === undefined || x === null ? "" : entityText(x);
      item = text ? { key: "field:" + it.field, label: text, value: x } : null;
    }
    if (item) out.push(item);
  });
  return out;
}
