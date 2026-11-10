// core/pages/entity.js: one record (spec s8 item 3). Combined fields, per source values, sighting
// history, links, the viewer's notes, and a hand merge that the next run applies.
import { entityText, recordKeys } from "../shared.js";

export var MERGE_NOTE = "A hand merge is recorded now. Applies from the next run, which folds the two records together.";
export var KEEP_NOTE = "A keep is recorded now. Applies from the next run, which keeps this record active.";
export var DROP_AGAIN_NOTE = "Drop again is recorded now. Applies from the next run, which applies the settings filters again.";
export var KEPT_SIGHTING_NOTE = "kept by person";
export var PERSON_DROP_NOTE = "A drop is recorded now. The list hides this record at once; the next run marks it dropped.";

// The route's key is the doc id after "<type>--"; ids already carry any merge or hash suffix.
export function entityIdFromRoute(params) {
  return params.type + "--" + params.key;
}

export function sparkPoints(sightings, field) {
  return (sightings || []).filter(function (s) {
    return s.values && typeof s.values[field] === "number" && isFinite(s.values[field]);
  }).map(function (s) { return { at: s.at, v: s.values[field] }; }).sort(function (a, b) {
    return a.at === b.at ? 0 : (a.at < b.at ? -1 : 1);
  });
}

// The linked record named under the heading: a role shows its company. Empty when the type links nothing.
export function recordSubtitle(t, d) {
  var display = d.display || {};
  return ((t && t.links) || []).map(function (k) { return display[k]; })
    .filter(function (v) { return v !== undefined && v !== null && v !== ""; }).map(entityText).join(", ");
}

// The record's state once a person's keep is taken into account. A keep is decisions/<entityId>
// {decision: "keep"}; the next run applies it, so until then the stored status still reads dropped.
export function keepState(d, keep) {
  if (keep && keep.decision === "drop") return d.status === "dropped" ? "person-dropped" : "person-drop-pending";
  var kept = !!(keep && keep.decision === "keep");
  var latest = (d.sightings || []).slice().sort(function (a, b) { return a.at === b.at ? 0 : (a.at < b.at ? 1 : -1); })[0];
  if (d.status === "dropped") return kept ? "kept-pending" : "dropped";
  if (kept) return "kept";
  return latest && latest.note === KEPT_SIGHTING_NOTE ? "drop-pending" : "active";
}

// The Decision control's value for a keepState: keep, drop or pending. A record the settings dropped reads Drop.
export function decisionNow(state) {
  return state === "kept" || state === "kept-pending" ? "keep"
    : state === "person-dropped" || state === "person-drop-pending" || state === "dropped" ? "drop" : "pending";
}

// The declared fields whose values differ between the record merged away (from) and the one kept (into).
// Each row starts on the kept record's value.
export function mergeChoices(t, from, into) {
  var defs = (t && t.fields) || {};
  var keys = recordKeys(t);
  var a = (from && from.display) || {}, b = (into && into.display) || {};
  return keys.filter(function (k) {
    return a[k] !== undefined && a[k] !== null && a[k] !== "" && JSON.stringify(a[k]) !== JSON.stringify(b[k]);
  }).map(function (k) { return { field: k, label: defs[k].label || k, from: a[k], into: b[k], pick: "into" }; });
}

// merges/<from>: {into, at, by, fields?}. fields holds only the values picked from the merged-away record;
// the next run shows them on the kept record.
export function mergeDoc(into, rows, stampData) {
  var fields = {};
  rows.forEach(function (r) { if (r.pick === "from") fields[r.field] = r.from; });
  var out = Object.assign({ into: into }, stampData);
  if (Object.keys(fields).length) out.fields = fields;
  return out;
}

export { recordTitle, recordKeys, entityText } from "../shared.js";
