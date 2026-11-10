// core/queue.js: the db request queue (Desk v2). A person's Retry or Run now writes requests/<id> as pending; the
// routine reads pending requests at the start of its next scheduled run and reports each through `processed`.
// Nothing here starts a run: a queued request waits for the schedule.
export var REQUEST_KINDS = ["run-now", "retry"];
export var QUEUED_LABEL = "Queued for next run";
export var REQUEST_NOTE_MAX = 2000;

export function newRequestId() {
  var r = "";
  try {
    var a = new Uint8Array(6);
    globalThis.crypto.getRandomValues(a);
    r = Array.prototype.map.call(a, function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join("");
  } catch (e) {
    r = Math.random().toString(16).slice(2, 14);
  }
  return "req~" + Date.now().toString(36) + "~" + r;
}

// The routine ids the Desk lists (definition.producers). A request names one of them, never anything else.
export function listedRoutines(definition) {
  return ((definition && definition.producers) || []).map(function (p) { return p && p.id; }).filter(Boolean);
}

// [{id, data}] of one routine's requests still pending, oldest first.
export function queuedRequests(docs, routine) {
  return (docs || []).filter(function (d) {
    return d && d.data && d.data.status === "pending" && d.data.routine === routine;
  }).sort(function (a, b) {
    var x = a.data.createdAt || "", y = b.data.createdAt || "";
    return x === y ? (a.id < b.id ? -1 : 1) : (x < y ? -1 : 1);
  });
}

// [{id, data}] of every request still waiting: pending in its doc and named by no run's processed report.
export function waitingRequests(docs, runs) {
  var done = {};
  (runs || []).forEach(function (r) {
    ((r.data && r.data.processed) || []).forEach(function (p) { if (p && p.request) done[p.request] = true; });
  });
  return (docs || []).filter(function (d) { return d && d.data && d.data.status === "pending" && !done[d.id]; });
}
