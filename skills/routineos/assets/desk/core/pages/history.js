// core/pages/history.js: one History page (spec 5.8). Modes from ?mode: timeline (default: runs, comments and
// people writes that carry by and at) and cal (runs by UTC day, like the schedules). Health lives on Runs. Names come
// from store.profiles(ids) at render; only ids are stored, and an id is never shown.
import { entityHash, producerLabel } from "../shared.js";

export var HISTORY_MODES = [["timeline", "Timeline"], ["cal", "Calendar"]];
export var HISTORY_LIST_MAX = 200;
export var ACTIVITY_KINDS = [["run", "Runs"], ["decision", "Decisions"], ["settings", "Settings"], ["comment", "Comments"], ["merge", "Merges"], ["view", "Views"]];
export var DECISION_WORDS = { approve: "Approved", reject: "Rejected", dismiss: "Dismissed", accept: "Accepted", drop: "Dropped", keep: "Kept" };
export var NOT_PEOPLE = ["agent", "definition", "human"];
export var WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function historyMode(params) {
  var m = params && params.query && params.query.mode;
  return m === "cal" ? m : "timeline";
}

export function runsByDay(runs) {
  var out = {};
  (runs || []).forEach(function (r) {
    var s = String(r.data.startedAt || "");
    if (!/^\d{4}-\d\d-\d\d/.test(s)) return;
    (out[s.slice(0, 10)] = out[s.slice(0, 10)] || []).push(r);
  });
  Object.keys(out).forEach(function (k) {
    out[k].sort(function (a, b) { return a.data.startedAt < b.data.startedAt ? 1 : a.data.startedAt > b.data.startedAt ? -1 : 0; });
  });
  return out;
}

// n weeks of UTC dates (YYYY-MM-DD), Monday first, the last week holding now.
export function calendarWeeks(now, n) {
  var d = new Date(now);
  var day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  var monday = day - ((d.getUTCDay() + 6) % 7) * 864e5;
  var weeks = [];
  for (var w = n - 1; w >= 0; w--) {
    var row = [];
    for (var k = 0; k < 7; k++) row.push(new Date(monday - w * 7 * 864e5 + k * 864e5).toISOString().slice(0, 10));
    weeks.push(row);
  }
  return weeks;
}

export function decisionHref_(id) {
  var s = String(id);
  if (/--g\d+$/.test(s)) return "#/approvals";
  if (/--\d+$/.test(s)) return "#/approvals";
  return entityHash(s);
}

export function changedKeys_(before, after) {
  before = before || {};
  after = after || {};
  var keys = {};
  Object.keys(before).concat(Object.keys(after)).forEach(function (k) { keys[k] = true; });
  return Object.keys(keys).sort().filter(function (k) { return JSON.stringify(before[k]) !== JSON.stringify(after[k]); });
}

export function isPerson_(by) {
  return typeof by === "string" && by && NOT_PEOPLE.indexOf(by) === -1;
}

// [{at, by, kind, text, href, entity?}] newest first: runs (by null), then only writes with a person's id and a time.
// src.names maps a record id to its name; entity is the record id an event is about, for the peek.
export function historyEvents(src) {
  var out = [], names = src.names || {};
  function name(id) { return Object.prototype.hasOwnProperty.call(names, id) ? names[id] : id; }
  function add(at, by, kind, text, href, entity, unverified) {
    if (at && (by === null || isPerson_(by))) out.push(Object.assign({ at: at, by: by, kind: kind, text: text, href: href }, entity ? { entity: entity } : {}, unverified ? { unverified: true } : {}));
  }
  (src.runs || []).forEach(function (r) {
    add(r.data.startedAt, null, "run", producerLabel(src.definition, r.data.producer) + " run, " + (r.data.status || "unknown"), "#/runs/" + encodeURIComponent(r.id));
  });
  (src.comments || []).forEach(function (c) {
    // A comment from an earlier Desk (verified false) says who wrote it only in its own body, so it names nobody.
    if (c.verified === false) add(c.data.at, null, "comment", "Unverified comment on " + name(c.data.entity) + ": " + c.data.text, entityHash(c.data.entity), c.data.entity, true);
    else add(c.data.at, c.data.by, "comment", "Commented on " + name(c.data.entity) + ": " + c.data.text, entityHash(c.data.entity), c.data.entity);
  });
  (src.decisions || []).forEach(function (d) {
    var x = d.data;
    var word = DECISION_WORDS[x.decision] || ("Decided " + x.decision + " on");
    var rec = decisionHref_(d.id) === entityHash(d.id);
    add(x.at, x.by, "decision", word + " " + (rec ? name(d.id) : d.id) + (x.reason ? ": " + x.reason : ""), decisionHref_(d.id), rec ? d.id : null);
  });
  (src.settingsHistory || []).forEach(function (h) {
    var x = h.data;
    var keys = changedKeys_(x.before, x.after);
    add(x.at, x.by, "settings", "Changed " + x.producer + " settings" + (keys.length ? ": " + keys.join(", ") : ""), "#/settings");
  });
  (src.merges || []).forEach(function (m) {
    add(m.data.at, m.data.by, "merge", "Merged " + name(m.id) + " into " + name(m.data.into), entityHash(m.data.into), m.data.into);
  });
  (src.views || []).forEach(function (v) {
    add(v.data.createdAt, v.data.madeBy, "view", "Saved view " + (v.data.name || v.id), "#/settings/views");
  });
  out.sort(function (a, b) { return a.at === b.at ? 0 : a.at < b.at ? 1 : -1; });
  return out;
}

export function filterActivity(items, f) {
  f = f || {};
  return items.filter(function (i) { return (!f.by || i.by === f.by) && (!f.kind || i.kind === f.kind); });
}

export function personLabel(ctx, profiles, id) {
  var p = profiles && Object.prototype.hasOwnProperty.call(profiles, id) ? profiles[id] : null;
  if (p && p.name) return p.name;
  return id === ctx.viewer ? "you" : "Someone";
}

// personLabel for the middle of a sentence ("by someone"). Approvals and Settings history use it.
export function personWord(ctx, profiles, id) {
  var label = personLabel(ctx, profiles, id);
  return label === "Someone" ? "someone" : label;
}

// Each node carries data-person and is drawn first as "you" or "someone"; the names fill in once
// store.profiles(ids) answers. A page that redraws later keeps its unsaved edits.
export function fillNames(ctx, nodes) {
  var ids = nodes.map(function (n) { return n.getAttribute("data-person"); })
    .filter(function (v, i, a) { return v && a.indexOf(v) === i; });
  if (!ids.length || !ctx.store || !ctx.store.profiles) return Promise.resolve();
  return ctx.store.profiles(ids).then(function (p) {
    nodes.forEach(function (n) { n.textContent = personWord(ctx, p || {}, n.getAttribute("data-person")); });
  }, function () {});
}
