import { expect, test } from "vitest";
import { aggregateTile, evalQuery, tableRows } from "../core/pages/spec-query.js";

var NOW = Date.UTC(2026, 10, 10, 12, 0, 0); // 2026-11-10, a Tuesday
var WEEKS = ["2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09"];

function row(week, source, value, extra) {
  return Object.assign({ id: source + week, key: source + "/" + week, type: "metric", lastSeen: week, f: { week: week, source: source, value: value }, a: {} }, extra || {});
}

var ROWS = [];
WEEKS.forEach(function (w, i) {
  ROWS.push(row(w, "organic", 100 + i * 10));
  ROWS.push(row(w, "paid", 50 + i * 5));
});

var Q = { type: "metric", x: "week", groupBy: "source", aggregate: { op: "sum", field: "value" }, window: { last: { n: 4, unit: "weeks" } } };

test("sum grouped by source over the window", () => {
  var out = evalQuery(ROWS, Q, { now: NOW });
  expect(out.groups).toEqual(["organic", "paid"]);
  var p = out.points.filter(function (x) { return x.group === "organic"; });
  expect(p.map(function (x) { return x.x; })).toEqual(WEEKS);
  expect(p.map(function (x) { return x.y; })).toEqual([100, 110, 120, 130]);
});

test("window last 2 weeks anchored on now drops older weeks", () => {
  var q = Object.assign({}, Q, { window: { last: { n: 2, unit: "weeks" } } });
  var out = evalQuery(ROWS, q, { now: NOW });
  expect(Array.from(new Set(out.points.map(function (x) { return x.x; })))).toEqual(["2026-11-02", "2026-11-09"]);
});

test("range window is inclusive of both dates", () => {
  var q = Object.assign({}, Q, { window: "range" });
  var out = evalQuery(ROWS, q, { now: NOW, range: { from: "2026-10-26", to: "2026-11-02" } });
  expect(Array.from(new Set(out.points.map(function (x) { return x.x; })))).toEqual(["2026-10-26", "2026-11-02"]);
});

test("avg skips non-numeric values and counts them", () => {
  var rows = [row("2026-11-09", "organic", 10), row("2026-11-09", "organic", "n/a"), row("2026-11-09", "organic", 30), row("2026-11-09", "organic", undefined)];
  var q = { type: "metric", x: "week", groupBy: null, aggregate: { op: "avg", field: "value" }, window: { last: { n: 1, unit: "weeks" } } };
  var out = evalQuery(rows, q, { now: NOW });
  expect(out.points).toEqual([{ x: "2026-11-09", group: null, y: 20 }]);
  expect(out.skipped).toBe(2);
});

test("a cell with no numeric value gives y null, never NaN", () => {
  var rows = [row("2026-11-09", "organic", "n/a")];
  var out = evalQuery(rows, { type: "metric", x: "week", aggregate: { op: "sum", field: "value" } }, { now: NOW });
  expect(out.points[0].y).toBeNull();
});

test("count counts rows", () => {
  var out = evalQuery(ROWS, Object.assign({}, Q, { aggregate: { op: "count", field: "value" } }), { now: NOW });
  expect(out.points.every(function (p) { return p.y === 1; })).toBe(true);
});

test("latest picks the row with the greatest x", () => {
  var t = aggregateTile(ROWS, { type: "metric", x: "week", aggregate: { op: "latest", field: "value" }, window: { last: { n: 4, unit: "weeks" } } }, { now: NOW });
  expect(t.value).toBe(130 + 65); // organic 130 + paid 65 on 2026-11-09
  expect(t.previous).toBe(120 + 60);
  expect(t.change.direction).toBe("up");
  expect(t.change.pct).toBeCloseTo((195 - 180) / 180 * 100);
  expect(t.spark).toEqual([150, 165, 180, 195]);
});

test("delta is latest minus the previous period", () => {
  var t = aggregateTile(ROWS, { type: "metric", x: "week", aggregate: { op: "delta", field: "value" }, window: { last: { n: 4, unit: "weeks" } } }, { now: NOW });
  expect(t.value).toBe(15);
});

test("sum tile compares with the previous window of the same length", () => {
  var q = { type: "metric", x: "week", aggregate: { op: "sum", field: "value" }, window: { last: { n: 2, unit: "weeks" } } };
  var t = aggregateTile(ROWS, q, { now: NOW });
  expect(t.value).toBe(180 + 195);
  expect(t.previous).toBe(165 + 150);
});

test("previous zero or absent gives no change data, not Infinity", () => {
  var rows = [row("2026-11-02", "a", 0), row("2026-11-09", "a", 40)];
  var q = { type: "metric", x: "week", aggregate: { op: "latest", field: "value" }, window: { last: { n: 4, unit: "weeks" } } };
  var t = aggregateTile(rows, q, { now: NOW });
  expect(t.value).toBe(40);
  expect(t.change).toEqual({ pct: null, direction: null });
  var one = aggregateTile([row("2026-11-09", "a", 40)], q, { now: NOW });
  expect(one.previous).toBeNull();
  expect(one.change).toEqual({ pct: null, direction: null });
});

test("a falling value reads down and an equal one flat", () => {
  var q = { type: "metric", x: "week", aggregate: { op: "latest", field: "value" } };
  expect(aggregateTile([row("2026-11-02", "a", 50), row("2026-11-09", "a", 40)], q, { now: NOW }).change.direction).toBe("down");
  expect(aggregateTile([row("2026-11-02", "a", 40), row("2026-11-09", "a", 40)], q, { now: NOW }).change.direction).toBe("flat");
});

test("filter keeps only rows where the field equals the value", () => {
  var out = evalQuery(ROWS, Q, { now: NOW, filter: { field: "source", value: "paid" } });
  expect(out.groups).toEqual(["paid"]);
});

test("where operators mirror the store", () => {
  var t = function (where) { return tableRows(ROWS, { type: "metric", where: where }, { now: NOW }).length; };
  expect(t([["source", "==", "paid"]])).toBe(4);
  expect(t([["source", "!=", "paid"]])).toBe(4);
  expect(t([["value", "<", 100]])).toBe(4);
  expect(t([["value", "<=", 50]])).toBe(1);
  expect(t([["value", ">", 120]])).toBe(1);
  expect(t([["value", ">=", 120]])).toBe(2);
  expect(t([["source", "in", ["paid", "x"]]])).toBe(4);
  expect(t([["source", "not-in", ["paid"]]])).toBe(4);
});

test("empty rows give no points and a null tile", () => {
  var out = evalQuery([], Q, { now: NOW });
  expect(out).toEqual({ points: [], groups: [], skipped: 0 });
  var t = aggregateTile([], Q, { now: NOW });
  expect(t.value).toBeNull();
  expect(t.spark).toEqual([]);
  expect(t.change).toEqual({ pct: null, direction: null });
});

test("a group value with markup comes back unchanged as a string", () => {
  var rows = [row("2026-11-09", "<img onerror=x>", 5)];
  var out = evalQuery(rows, Q, { now: NOW });
  expect(out.groups).toEqual(["<img onerror=x>"]);
  expect(out.points[0].group).toBe("<img onerror=x>");
});

test("tableRows sorts and limits", () => {
  var out = tableRows(ROWS, { type: "metric", orderBy: ["value", "desc"], limit: 2 }, { now: NOW });
  expect(out.map(function (r) { return r.f.value; })).toEqual([130, 120]);
});

test("week comparison does not depend on the local zone", () => {
  var q = Object.assign({}, Q, { window: { last: { n: 1, unit: "weeks" } } });
  var out = evalQuery(ROWS, q, { now: Date.UTC(2026, 10, 10, 0, 30, 0) });
  expect(Array.from(new Set(out.points.map(function (x) { return x.x; })))).toEqual(["2026-11-09"]);
});

test("x and group values named like Object.prototype members aggregate like any other value", () => {
  var names = ["__proto__", "constructor", "hasOwnProperty", "toString"];
  var rows = [];
  names.forEach(function (n, i) {
    rows.push(row("2026-11-09", n, 10 * (i + 1), { f: { week: n, source: n, value: 10 * (i + 1) } }));
    rows.push(row("2026-11-09", n, 1, { f: { week: n, source: n, value: 1 } }));
  });
  var q = { type: "metric", x: "week", groupBy: "source", aggregate: { op: "sum", field: "value" } };
  var out = evalQuery(rows, q, { now: NOW });
  expect(out.groups).toEqual(names.slice().sort());
  names.forEach(function (n, i) {
    var p = out.points.filter(function (x) { return x.x === n && x.group === n; });
    expect(p.length).toBe(1);
    expect(p[0].y).toBe(10 * (i + 1) + 1);
  });
  var tile = aggregateTile(rows, Object.assign({}, q, { aggregate: { op: "latest", field: "value" } }), { now: NOW });
  expect(tile.value).toBe(41); // the last x in order is "toString": 40 + 1
  expect(tile.previous).toBe(31); // "hasOwnProperty": 30 + 1
});
