// core/pages/spec-query.js: evaluate a spec page query over rows already read (spec-read.js). Pure.
// Dates are ISO date strings compared as text in UTC, never through local-time Date getters.
// Per-x totals: for latest, delta, sum and avg a tile or point combines every row at one x (all groups for a
// tile, one group for a chart point). Rows whose aggregate field is not a finite number are skipped and counted.
import { browseText, compareCells, missing, rowValue } from "./browse.js";

var DAY_MS = 864e5;

function fieldOf(row, field) {
  var v = rowValue(row, field);
  if (v !== undefined) return v;
  return field === "type" || field === "key" || field === "id" ? row[field] : undefined;
}

function clauseMatches(row, clause) {
  var v = fieldOf(row, clause[0]);
  var want = clause[2];
  switch (clause[1]) {
    case "==": return v === want;
    case "!=": return v !== want;
    case "<": return v !== undefined && v < want;
    case "<=": return v !== undefined && v <= want;
    case ">": return v !== undefined && v > want;
    case ">=": return v !== undefined && v >= want;
    case "in": return Array.isArray(want) && want.indexOf(v) !== -1;
    case "not-in": return Array.isArray(want) && want.indexOf(v) === -1;
    case "array-contains": return Array.isArray(v) && v.indexOf(want) !== -1;
    default: return false;
  }
}

function dayOf(v) {
  var s = browseText(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

// The longest last-N window the evaluator will use, in days; definition.py lints the same limits (3660 days, 520 weeks).
export var MAX_WINDOW_DAYS = 3660;

// A real calendar day written YYYY-MM-DD (2026-02-30 is not one).
export function isRealDay(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var ms = Date.parse(s + "T00:00:00Z");
  return isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === s;
}

// The range control's value "<from>..<to>" as {from, to}, or null when either end is not a real day or from is after to.
export function parseRange(text) {
  var m = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(String(text || ""));
  return m && isRealDay(m[1]) && isRealDay(m[2]) && m[1] <= m[2] ? { from: m[1], to: m[2] } : null;
}

function isoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function shiftDay(day, days) {
  return isoDay(Date.parse(day + "T00:00:00Z") + days * DAY_MS);
}

// The inclusive day bounds {from, to} of the query window, or null for no window. back > 0 moves to the
// previous window of the same length.
function bounds(query, ctx, back) {
  var w = query.window;
  var today = isoDay(ctx.now);
  var shift = back || 0;
  if (w && w.last) {
    var len = Math.min(Number(w.last.n) * (w.last.unit === "weeks" ? 7 : 1), MAX_WINDOW_DAYS);
    if (!(len > 0)) return null;
    return { from: shiftDay(today, 1 - len - shift * len), to: shiftDay(today, -shift * len) };
  }
  if (w === "range" && ctx.range && isRealDay(ctx.range.from) && isRealDay(ctx.range.to) && ctx.range.from <= ctx.range.to) {
    var len2 = (Date.parse(ctx.range.to + "T00:00:00Z") - Date.parse(ctx.range.from + "T00:00:00Z")) / DAY_MS + 1;
    return { from: shiftDay(ctx.range.from, -shift * len2), to: shiftDay(ctx.range.to, -shift * len2) };
  }
  return null;
}

function select(rows, query, ctx, back) {
  var b = bounds(query, ctx, back);
  var f = ctx.filter && ctx.filter.field ? ctx.filter : null;
  return rows.filter(function (r) {
    if (r.status === "dropped") return false; // a dropped record is one the routine marked out, never part of a total
    if (!(query.where || []).every(function (c) { return clauseMatches(r, c); })) return false;
    if (f && browseText(fieldOf(r, f.field)) !== String(f.value)) return false;
    if (b) {
      var d = dayOf(fieldOf(r, query.x));
      if (d === null || d < b.from || d > b.to) return false;
    }
    return true;
  });
}

function numeric(v) {
  return typeof v === "number" && isFinite(v) ? v : null;
}

function groupLabel(row, groupBy) {
  if (!groupBy) return null;
  var g = browseText(fieldOf(row, groupBy));
  return g === "" ? "(none)" : g;
}

// Combine the rows at one x into one number (or null). state.skipped counts non-numeric aggregate values.
function combine(rows, agg, state) {
  if (agg.op === "count") return rows.length;
  var nums = [];
  rows.forEach(function (r) {
    var n = numeric(fieldOf(r, agg.field));
    if (n === null) state.skipped++;
    else nums.push(n);
  });
  if (!nums.length) return null;
  var sum = nums.reduce(function (a, b) { return a + b; }, 0);
  return agg.op === "avg" ? sum / nums.length : sum;
}

// Every map keyed by a value from the data is a Map, so a value such as "__proto__" or "constructor" is a key like any other.
function byX(rows, query) {
  var m = new Map();
  rows.forEach(function (r) {
    var x = browseText(fieldOf(r, query.x));
    if (!m.has(x)) m.set(x, []);
    m.get(x).push(r);
  });
  return m;
}

export function evalQuery(rows, query, ctx) {
  var state = { skipped: 0 };
  var picked = select(rows, query, ctx, 0);
  var cells = new Map();
  var groupSet = new Set();
  picked.forEach(function (r) {
    var x = browseText(fieldOf(r, query.x));
    var g = groupLabel(r, query.groupBy);
    if (g !== null) groupSet.add(g);
    var k = JSON.stringify([x, g]);
    if (!cells.has(k)) cells.set(k, { x: x, group: g, rows: [] });
    cells.get(k).rows.push(r);
  });
  var points = Array.from(cells.values()).map(function (c) {
    var rs = c.rows;
    if (query.aggregate.op === "latest" || query.aggregate.op === "delta") {
      // one value per cell: the sum of its rows, as for a tile
      return { x: c.x, group: c.group, y: combine(rs, { op: "sum", field: query.aggregate.field }, state) };
    }
    return { x: c.x, group: c.group, y: combine(rs, query.aggregate, state) };
  });
  points.sort(function (a, b) {
    return a.x === b.x ? compareCells(a.group, b.group) : (a.x < b.x ? -1 : 1);
  });
  return { points: points, groups: Array.from(groupSet).sort(), skipped: state.skipped };
}

function change(value, previous) {
  if (value === null || previous === null || previous === 0) return { pct: null, direction: null };
  var pct = (value - previous) / Math.abs(previous) * 100;
  return { pct: pct, direction: value > previous ? "up" : value < previous ? "down" : "flat" };
}

// The first x (a day) any row of the query has once the where clauses and the filter apply, ignoring the window, and the
// smallest gap in days between two x values (the cadence: 7 for weekly data, 1 when there is a single day).
function coverage(rows, query, ctx) {
  var all = select(rows, Object.assign({}, query, { window: undefined }), ctx, 0);
  var days = Array.from(new Set(all.map(function (r) { return dayOf(fieldOf(r, query.x)); }).filter(function (d) { return d !== null; }))).sort();
  var gap = 1;
  for (var i = 1; i < days.length; i++) {
    var g = (Date.parse(days[i] + "T00:00:00Z") - Date.parse(days[i - 1] + "T00:00:00Z")) / DAY_MS;
    gap = i === 1 ? g : Math.min(gap, g);
  }
  return { first: days.length ? days[0] : null, gap: gap };
}

export function aggregateTile(rows, query, ctx) {
  var agg = query.aggregate;
  var state = { skipped: 0 };
  var inWindow = select(rows, query, ctx, 0);
  var groups = byX(inWindow, query);
  var xs = Array.from(groups.keys()).sort();
  var per = { op: agg.op === "avg" || agg.op === "count" ? agg.op : "sum", field: agg.field };
  var series = xs.map(function (x) { return combine(groups.get(x), per, state); });
  var spark = series.filter(function (v) { return v !== null; });
  if (agg.op === "latest" || agg.op === "delta") {
    // the latest x that holds a number, and the number before it
    var n = spark.length;
    var value = n ? spark[n - 1] : null;
    var prev = n > 1 ? spark[n - 2] : null;
    return {
      value: agg.op === "delta" ? (value !== null && prev !== null ? value - prev : null) : value,
      previous: prev,
      change: change(value, prev),
      spark: spark,
      skipped: state.skipped,
    };
  }
  var scratch = { skipped: 0 };
  var cur = inWindow.length ? combine(inWindow, per, scratch) : null;
  var b = bounds(query, ctx, 0);
  var prevBounds = b ? bounds(query, ctx, 1) : null;
  var cov = prevBounds ? coverage(rows, query, ctx) : { first: null, gap: 1 };
  // Only a previous window the data reaches back over completely gives a change; a part window would read as growth.
  // A week starts on a day of its own, so the first x may sit up to one cadence step after the window starts.
  var covered = cov.first !== null && cov.first <= shiftDay(prevBounds.from, cov.gap - 1);
  var before = covered ? select(rows, query, ctx, 1) : [];
  var pv = before.length ? combine(before, per, scratch) : null;
  return { value: cur, previous: pv, change: change(cur, pv), spark: spark, skipped: state.skipped };
}

export function tableRows(rows, query, ctx) {
  var out = select(rows, query, ctx, 0);
  if (query.orderBy) {
    var field = query.orderBy[0];
    var dir = query.orderBy[1] === "desc" ? -1 : 1;
    out = out.slice().sort(function (a, b) {
      var x = fieldOf(a, field), y = fieldOf(b, field);
      if (missing(x) && missing(y)) return 0;
      if (missing(x)) return 1;
      if (missing(y)) return -1;
      return dir * compareCells(x, y);
    });
  }
  return query.limit ? out.slice(0, query.limit) : out;
}
