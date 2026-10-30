/* src/paging.js: hybrid paging over a store that has one orderBy, no cursors and no counts (db.d.ts).
   Lists read a page at a time ordered by one meta field. The next page is a keyset read from the last value
   shown: `<=` (or `>=`) on that value, dropping the ids already shown at it. When one value fills a whole read,
   the page walks that value alone in `key` order (unique per type) and then carries on strictly past it, so a
   tie of any size is neither skipped nor repeated. Full reads (search, field filters, counts, "all matching")
   walk `key` in reads of 1,000 and de-duplicate by id. */

var PAGE_SIZE = 100;
var FULL_STEP = 1000;
var TIE_FIELD = "key";
var FULL_READ_MAX = 30; // 25,000 documents per artifact at 1,000 a read, with room to spare

function rowValue_(row, field) {
  return row && row.data ? row.data[field] : undefined;
}

function withWhere(base, extra) {
  return ((base && base.where) || []).concat(extra);
}

// after: null for the first page, else {value, seen: [ids shown at value], mode: "le" | "tie" | "strict", key}.
function pageQuery(base, sort, after) {
  var desc = sort.dir === "desc";
  if (!after) return { where: withWhere(base, []), orderBy: [sort.field, sort.dir], limit: PAGE_SIZE };
  if (after.mode === "tie") {
    var w = [[sort.field, "==", after.value]];
    if (after.key !== null && after.key !== undefined) w.push([TIE_FIELD, ">", after.key]);
    return { where: withWhere(base, w), orderBy: [TIE_FIELD, "asc"], limit: PAGE_SIZE };
  }
  if (after.mode === "strict") {
    return { where: withWhere(base, [[sort.field, desc ? "<" : ">", after.value]]), orderBy: [sort.field, sort.dir], limit: PAGE_SIZE };
  }
  return {
    where: withWhere(base, [[sort.field, desc ? "<=" : ">=", after.value]]),
    orderBy: [sort.field, sort.dir],
    limit: Math.min(FULL_STEP, PAGE_SIZE + after.seen.length),
  };
}

// One page: {rows, after, done}. rows are store.list docs; done means the store has no more.
function nextPage(store, coll, base, sort, after) {
  var q = pageQuery(base, sort, after);
  return store.list(coll, q).then(function (raw) {
    var seen = new Set((after && after.seen) || []);
    var fresh = raw.filter(function (r) { return !seen.has(r.id); });
    if (after && after.mode === "tie") {
      var shown = (after.seen || []).concat(fresh.map(function (r) { return r.id; }));
      if (raw.length < q.limit) return { rows: fresh, after: { value: after.value, seen: [], mode: "strict" }, done: false };
      return { rows: fresh, after: { value: after.value, seen: shown, mode: "tie", key: rowValue_(raw[raw.length - 1], TIE_FIELD) }, done: false };
    }
    var full = raw.length >= q.limit;
    if (after && after.mode === "le" && full && raw.every(function (r) { return rowValue_(r, sort.field) === after.value; })) {
      // One value fills the whole read: walk it alone in key order.
      return nextPage(store, coll, base, sort, { value: after.value, seen: after.seen, mode: "tie", key: null });
    }
    if (!raw.length) return { rows: [], after: after, done: true };
    var last = rowValue_(raw[raw.length - 1], sort.field);
    var atLast = raw.filter(function (r) { return rowValue_(r, sort.field) === last; }).map(function (r) { return r.id; });
    return { rows: fresh, after: { value: last, seen: atLast, mode: "le" }, done: !full };
  });
}

// Every document matching base, read in key order 1,000 at a time, de-duplicated by id.
function fullRead(store, coll, base) {
  var out = [];
  var ids = new Set();
  function step(lastKey, n) {
    var w = lastKey === null ? [] : [[TIE_FIELD, ">", lastKey]];
    return store.list(coll, { where: withWhere(base, w), orderBy: [TIE_FIELD, "asc"], limit: FULL_STEP }).then(function (raw) {
      raw.forEach(function (r) { if (!ids.has(r.id)) { ids.add(r.id); out.push(r); } });
      if (raw.length < FULL_STEP || n + 1 >= FULL_READ_MAX) return out;
      return step(rowValue_(raw[raw.length - 1], TIE_FIELD), n + 1);
    });
  }
  return step(null, 0);
}

if (typeof module === "object" && module.exports) {
  module.exports = { PAGE_SIZE: PAGE_SIZE, FULL_STEP: FULL_STEP, pageQuery: pageQuery, nextPage: nextPage, fullRead: fullRead };
}
