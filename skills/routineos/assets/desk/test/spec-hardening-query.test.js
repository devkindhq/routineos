import { expect, test } from "vitest";
import { aggregateTile, evalQuery, parseRange, tableRows } from "../core/pages/spec-query.js";

var NOW = Date.UTC(2026, 10, 10, 12, 0, 0); // 2026-11-10

function row(week, source, value, extra) {
  return Object.assign({ id: source + week, key: source + "/" + week, type: "metric", status: "active", lastSeen: week, f: { week: week, source: source, value: value }, a: {} }, extra || {});
}

var SUM = { type: "metric", x: "week", aggregate: { op: "sum", field: "value" } };

test("parseRange accepts a real, ordered pair of calendar days and nothing else", () => {
  expect(parseRange("2026-10-26..2026-11-02")).toEqual({ from: "2026-10-26", to: "2026-11-02" });
  expect(parseRange("2026-13-45..2026-99-99")).toBeNull();
  expect(parseRange("2026-02-30..2026-03-01")).toBeNull();
  expect(parseRange("2026-11-02..2026-10-26")).toBeNull();
  expect(parseRange("nonsense")).toBeNull();
  expect(parseRange(undefined)).toBeNull();
});

test("a range that is not a real date never throws in evalQuery or aggregateTile", () => {
  var rows = [row("2026-11-02", "a", 5)];
  var q = Object.assign({}, SUM, { window: "range" });
  var ctx = { now: NOW, range: { from: "2026-13-45", to: "2026-99-99" } };
  expect(() => evalQuery(rows, q, ctx)).not.toThrow();
  expect(() => aggregateTile(rows, q, ctx)).not.toThrow();
  expect(() => tableRows(rows, q, ctx)).not.toThrow();
});

test("a huge window.last.n is clamped and does not throw", () => {
  var rows = [row("2026-11-02", "a", 5)];
  var q = Object.assign({}, SUM, { window: { last: { n: 1e12, unit: "days" } } });
  expect(() => evalQuery(rows, q, { now: NOW })).not.toThrow();
  expect(evalQuery(rows, q, { now: NOW }).points.length).toBe(1);
  var w = Object.assign({}, SUM, { window: { last: { n: 1e8, unit: "weeks" } } });
  expect(() => aggregateTile(rows, w, { now: NOW })).not.toThrow();
});

test("a dropped record is not summed into a tile, a chart or a table", () => {
  var rows = [row("2026-11-09", "a", 10), row("2026-11-09", "b", 1000, { status: "dropped" })];
  expect(aggregateTile(rows, Object.assign({}, SUM, { aggregate: { op: "latest", field: "value" } }), { now: NOW }).value).toBe(10);
  expect(evalQuery(rows, SUM, { now: NOW }).points.map((p) => p.y)).toEqual([10]);
  expect(tableRows(rows, { type: "metric" }, { now: NOW }).length).toBe(1);
});

test("a change is not shown when the window before is only partly covered by data", () => {
  var weeks = ["2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09"];
  var rows = weeks.map((w, i) => row(w, "a", i === 0 ? 100 : 300));
  var q = Object.assign({}, SUM, { window: { last: { n: 3, unit: "weeks" } } });
  var t = aggregateTile(rows, q, { now: NOW });
  expect(t.value).toBe(900);
  expect(t.change.pct).toBeNull();
  // the same window with data reaching back over the whole previous window does show a change
  var full = ["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09"].map((w) => row(w, "a", 100));
  var t2 = aggregateTile(full, q, { now: NOW });
  expect(t2.change.pct).not.toBeNull();
});

test("a tile reports how many values it skipped", () => {
  var rows = [row("2026-11-09", "a", 10), row("2026-11-09", "b", "12")];
  var t = aggregateTile(rows, Object.assign({}, SUM, { aggregate: { op: "latest", field: "value" } }), { now: NOW });
  expect(t.value).toBe(10);
  expect(t.skipped).toBe(1);
  var s = aggregateTile(rows, SUM, { now: NOW });
  expect(s.skipped).toBe(1);
});

test("latest takes the latest x that holds a number, never null while numbers exist", () => {
  var rows = [row("2026-11-02", "a", 100), row("2026-11-09", "a", "n/a")];
  var t = aggregateTile(rows, Object.assign({}, SUM, { aggregate: { op: "latest", field: "value" } }), { now: NOW });
  expect(t.value).toBe(100);
  expect(t.skipped).toBe(1);
});
