// app/pages/spec/chartData.js: turn the points of a spec chart query ([{x, group, y}], core/pages/spec-query.js) into
// what the chart, its summary sentence and its table need. Pure.
// Colours come from the Mantine palette; the dash patterns differ per series so colour is never the only cue. A
// seventh series and later repeat the first six patterns (a chart with that many groups is read from its table).
var COLORS = ["blue.6", "orange.6", "teal.6", "grape.6", "cyan.6", "pink.6", "lime.6", "indigo.6"];
var DASHES = ["", "6 3", "2 3", "8 3 2 3", "1 4", "10 4"];

function num(v) {
  return typeof v === "number" && isFinite(v) ? v : null;
}

function fmt(n) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// First and last per-x totals (all groups of one x added), in x order.
function totals(points) {
  var by = new Map();
  points.forEach(function (p) {
    var y = num(p.y);
    if (y !== null) by.set(p.x, (by.get(p.x) || 0) + y);
  });
  return Array.from(by.keys()).sort().map(function (x) { return by.get(x); });
}

function summarise(points, opts) {
  var title = opts.title || "Chart";
  var t = totals(points);
  if (t.length === 0) return title + ": no data";
  var first = t[0], last = t[t.length - 1];
  var line = title + ": " + fmt(first) + " to " + fmt(last) + " over " + t.length + " " + (opts.unit || "points");
  if (first === 0 || t.length < 2) return line;
  var pct = Math.round((last - first) / Math.abs(first) * 100);
  if (pct === 0) return line + ", no change";
  return line + ", " + (pct > 0 ? "up " : "down ") + Math.abs(pct) + "%";
}

function copyRow(r) {
  var c = Object.create(null);
  Object.keys(r).forEach(function (k) { c[k] = r[k]; });
  return c;
}

// opts: {title, unit}. type is one of the chart types of the spec (line, bar, stackedBar, shareBar, sparkline).
export function chartData(points, type, opts) {
  var o = opts || {};
  var names = [];
  var seen = new Set();
  var xs = [];
  var xSeen = new Set();
  (points || []).forEach(function (p) {
    var g = p.group === null || p.group === undefined ? (o.title || "Total") : String(p.group);
    if (!seen.has(g)) { seen.add(g); names.push(g); }
    if (!xSeen.has(p.x)) { xSeen.add(p.x); xs.push(p.x); }
  });
  names.sort();
  xs.sort();
  var cell = new Map();
  (points || []).forEach(function (p) {
    var g = p.group === null || p.group === undefined ? (o.title || "Total") : String(p.group);
    cell.set(JSON.stringify([p.x, g]), num(p.y));
  });
  var data = xs.map(function (x) {
    // No prototype, so a group named __proto__ or constructor is an own column like any other.
    var row = Object.create(null);
    row.x = x;
    var sum = 0;
    names.forEach(function (g) {
      var v = cell.get(JSON.stringify([x, g]));
      row[g] = v === undefined ? null : v;
      if (row[g] !== null) sum += row[g];
    });
    if (type === "shareBar") {
      names.forEach(function (g) {
        if (row[g] !== null) row[g] = sum === 0 ? 0 : row[g] / sum * 100;
      });
    }
    return row;
  });
  var series = names.map(function (g, i) {
    return { name: g, color: COLORS[i % COLORS.length], dash: DASHES[i % DASHES.length] };
  });
  return { data: data, series: series, summary: summarise(points || [], o), tableRows: data.map(copyRow) };
}

// The per-x totals as a plain number list, for a sparkline.
export function sparkValues(points) {
  return totals(points || []);
}
