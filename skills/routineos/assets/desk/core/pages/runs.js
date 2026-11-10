// core/pages/runs.js: health strip, run history and run detail (spec s8 item 5). Read only apart
// from the viewer's own "seen" mark. Schedules are cron in UTC and are edited on the routines page.
export var RUN_COUNTS = [["new", "New"], ["updated", "Updated"], ["unchanged", "Unchanged"], ["dropped", "Dropped"]];

export function idType(id) {
  var s = String(id || "");
  var i = s.indexOf("--");
  return i === -1 ? "" : s.slice(0, i);
}

// [{reason, count, href}] biggest first. The type comes from the run's dropped sample, else the
// producer's first type; with neither there is no link.
export function dropReasonLinks(run, producer) {
  var by = (run && run.droppedByReason) || {};
  var dropped = (run && run.dropped) || [];
  var fallback = (producer && producer.types && producer.types[0]) || "";
  return Object.keys(by).sort(function (a, b) { return by[b] - by[a] || (a < b ? -1 : 1); }).map(function (reason) {
    var sample = dropped.filter(function (d) { return d.reason === reason && idType(d.id); })[0];
    var type = sample ? idType(sample.id) : fallback;
    var p = new URLSearchParams();
    p.set("status", "dropped");
    p.set("reason", reason);
    return { reason: reason, count: by[reason], href: type ? "#/browse/" + encodeURIComponent(type) + "?" + p.toString() : null };
  });
}

export function settingsDiff(used, current) {
  used = used || {};
  current = current || {};
  var keys = {};
  Object.keys(used).concat(Object.keys(current)).forEach(function (k) { keys[k] = true; });
  return Object.keys(keys).sort().map(function (k) {
    return { name: k, used: used[k], current: current[k], differs: JSON.stringify(used[k]) !== JSON.stringify(current[k]) };
  });
}

export function sourcesLine(run) {
  if (typeof run.parsed !== "number" || typeof run.claimed !== "number") return "";
  return "parsed " + run.parsed + " of " + run.claimed + " source" + (run.claimed === 1 ? "" : "s");
}

export function runTone(status) {
  return status === "ok" || status === "done" ? "ok" : status === "failed" ? "fail" : "warn";
}

// The run page's status tag: only ok is green; failed is red; partial, unknown and anything else are amber.
export function runStatusTone(status) { return { ok: "success", fail: "danger", warn: "warning" }[runTone(status)]; }
// Whole minutes a run took, or null when either time is missing or not a date.
export function runMinutes(d) {
  var a = Date.parse(d.startedAt), b = Date.parse(d.endedAt);
  return isFinite(a) && isFinite(b) ? Math.round((b - a) / 60000) : null;
}

export function runsNewest(docs) {
  return docs.slice().sort(function (a, b) {
    var x = a.data.startedAt || "", y = b.data.startedAt || "";
    return x === y ? (a.id < b.id ? 1 : -1) : (x < y ? 1 : -1);
  });
}

export function currentSettings(definition, producer, doc) {
  var p = ((definition && definition.producers) || []).filter(function (x) { return x.id === producer; })[0];
  var out = {};
  ((p && p.settings) || []).forEach(function (s) { out[s.name] = s.default; });
  return Object.assign(out, (doc && doc.values) || {});
}

export function shown(v) {
  return v === undefined ? "(not set)" : JSON.stringify(v);
}
