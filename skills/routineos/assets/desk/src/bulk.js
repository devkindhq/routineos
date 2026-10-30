/* src/bulk.js: bulk actions on many records (spec "Bulk actions"). The store has no batch verb for pages, so
   writes run one at a time with progress, and the summary says how many failed and which. Undo reverts the
   writes that succeeded, for 10 seconds. */

var BULK_CAP = 1000;
var UNDO_MS = 10000;

function bulkCount_(n) {
  return Number(n).toLocaleString("en-US");
}

function checkScope(n) {
  if (!n) return { ok: false, reason: "Select at least one record." };
  if (n > BULK_CAP) return { ok: false, reason: "This would change " + bulkCount_(n) + " records. A bulk action can change at most " + bulkCount_(BULK_CAP) + "; narrow the filter first." };
  return { ok: true, reason: null };
}

function bulkMessage_(e) {
  if (typeof isQuota === "function" && isQuota(e)) return QUOTA_NOTE;
  return (e && e.message) || String(e);
}

// items: [{id, ...}]; write(item) returns a promise. Sequential on purpose. Resolves {done: [ids], failed: [{id, message}]}.
function runBulk(items, write, onProgress) {
  var res = { done: [], failed: [] };
  var i = 0;
  function step() {
    if (i >= items.length) return Promise.resolve(res);
    var it = items[i++];
    return Promise.resolve().then(function () { return write(it); }).then(function () {
      res.done.push(it.id);
    }, function (e) {
      res.failed.push({ id: it.id, message: bulkMessage_(e) });
    }).then(function () {
      if (onProgress) onProgress(i, items.length);
      return step();
    });
  }
  return step();
}

// Revert the ids that succeeded, one at a time. Resolves {failed: [{id, message}]}.
function undoBulk(done, revert) {
  return runBulk(done.map(function (id) { return { id: id }; }), function (it) { return revert(it.id); }).then(function (r) {
    return { failed: r.failed };
  });
}

// "Done 8, failed 2: Role 3, Role 7." Names come from items' name, else the id.
function bulkSummary(res, items) {
  var names = {};
  (items || []).forEach(function (it) { names[it.id] = it.name || it.id; });
  var s = "Done " + res.done.length;
  if (!res.failed.length) return s + ".";
  return s + ", failed " + res.failed.length + ": " + res.failed.map(function (f) { return names[f.id] || f.id; }).join(", ") + ".";
}

// Shift-click: add every id between anchor and target (inclusive) to set, in either direction.
function rangeSelect(ids, anchor, target, set) {
  var a = ids.indexOf(anchor), b = ids.indexOf(target);
  if (a === -1 || b === -1) { set.add(target); return set; }
  var lo = Math.min(a, b), hi = Math.max(a, b);
  for (var k = lo; k <= hi; k++) set.add(ids[k]);
  return set;
}

if (typeof module === "object" && module.exports) {
  module.exports = { BULK_CAP: BULK_CAP, UNDO_MS: UNDO_MS, checkScope: checkScope, runBulk: runBulk, undoBulk: undoBulk,
    bulkSummary: bulkSummary, rangeSelect: rangeSelect };
}
