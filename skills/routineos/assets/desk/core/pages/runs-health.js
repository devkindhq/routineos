// core/pages/runs-health.js: the Runs page (spec 5.6). Runs happen on the schedule; nothing here starts one.
import { runsNewest } from "./runs.js";
import { deriveRequests } from "../requests.js";
import { isLate, nextRun, nextRunFor } from "../schedule.js";
import { human, plural, untilText } from "../dates.js";

export var RUN_EXTRA = [["captured", "Captured"], ["failed", "Failed"], ["newReds", "New reds"], ["cost", "Cost"]];

export function runCaptured_(r) {
  var c = (r && r.data.counts) || {};
  return (c.new || 0) + (c.updated || 0) + (c.unchanged || 0);
}

// The optional numbers a run doc may carry: counts.captured, counts.failed, counts.newReds (names assumed, a producer
// opts in) and cost. Absent stays undefined, so a column is drawn only when some run has it.
function extra_(d) {
  var c = d.counts || {}, out = {};
  ["captured", "failed", "newReds"].forEach(function (k) { if (typeof c[k] === "number") out[k] = c[k]; });
  if (typeof d.cost === "number" && isFinite(d.cost)) out.cost = d.cost;
  return out;
}

// "Next run <when>, with N approvals queued." The next run's id is never shown: ids are not derivable.
export function nextRunLine(next, queued, now) {
  var h = next && next.at ? Math.max(0, Math.round((Date.parse(next.at) - now) / 3600000)) : 0;
  var when = next && next.at ? "Next run " + human(next.at, now, { style: "sentence" }) + " (in " + untilText(h) + ")" : "Next run at the routine's next scheduled time";
  return when + (queued ? ", with " + plural(queued, "approval", "approvals") + " queued" : "") + ".";
}

// src: deriveRequests' inputs plus definition. now in ms. A row is late when it is its producer's latest run and that
// producer is late now; expectedBy is then the scheduled run that did not happen.
export function runsModel(src, now) {
  var defn = src.definition || {}, iso = new Date(now).toISOString(), byP = {}, sched = {};
  var runs = runsNewest(src.runs || []);
  (defn.producers || []).forEach(function (p) { sched[p.id] = p.schedule; });
  runs.forEach(function (r) { (byP[r.data.producer] = byP[r.data.producer] || []).push(r); });
  var captured = { value: 0, delta: 0 }, partial7d = 0, late7d = 0;
  Object.keys(byP).forEach(function (p) {
    var l = byP[p];
    captured.value += runCaptured_(l[0]);
    if (l[1]) captured.delta += runCaptured_(l[0]) - runCaptured_(l[1]);
  });
  var rows = runs.map(function (r) {
    var d = r.data, c = d.counts || {}, s = sched[d.producer];
    var late = byP[d.producer][0] === r && isLate(d.startedAt, s, iso) === true;
    var result = late ? "late" : d.status === "partial" ? "partial" : "ok";
    if (late) late7d++;
    else if (result === "partial" && Date.parse(d.startedAt) >= now - 7 * 86400000) partial7d++;
    return { id: r.id, run: r, producer: d.producer, startedAt: d.startedAt, result: result, parsed: d.parsed, claimed: d.claimed,
      new: c.new || 0, dropped: c.dropped || 0, durationMs: isFinite(Date.parse(d.endedAt) - Date.parse(d.startedAt)) ? Date.parse(d.endedAt) - Date.parse(d.startedAt) : null,
      expectedBy: late ? nextRun(s, d.startedAt) : null, extra: extra_(d) };
  });
  // Only the columns some run doc carries are drawn; the budget card needs a cost on the newest run of a producer.
  var columns = RUN_EXTRA.filter(function (k) { return rows.some(function (r) { return r.extra[k[0]] !== undefined; }); })
    .map(function (k) { return { key: k[0], label: k[1] }; });
  var cost = null;
  Object.keys(byP).forEach(function (p) {
    var v = byP[p][0].data.cost;
    if (typeof v === "number" && isFinite(v)) cost = (cost || 0) + v;
  });
  return { next: nextRunFor(defn, null, now), captured: captured, partial7d: partial7d, late7d: late7d, rows: rows, columns: columns, cost: cost,
    queued: deriveRequests(src, src.viewer || null, now).filter(function (r) { return r.state === "queued"; }).length };
}
