import { expect, test } from "vitest";
import { chartData } from "../app/pages/spec/chartData.js";

function weeks(n, group, from, step) {
  var out = [];
  for (var i = 0; i < n; i++) {
    var d = new Date(Date.UTC(2026, 7, 17 + i * 7)).toISOString().slice(0, 10);
    out.push({ x: d, group: group, y: from + i * step });
  }
  return out;
}

test("rows are one per x with a column per group, missing cells null", () => {
  var pts = [{ x: "a", group: "organic", y: 1 }, { x: "a", group: "paid", y: 2 }, { x: "b", group: "organic", y: 3 }];
  var out = chartData(pts, "line", { title: "T" });
  expect(out.data).toEqual([{ x: "a", organic: 1, paid: 2 }, { x: "b", organic: 3, paid: null }]);
  expect(out.series.map((s) => s.name)).toEqual(["organic", "paid"]);
  expect(out.tableRows).toEqual(out.data);
});

test("series dash patterns are pairwise distinct for three groups, so colour is never the only cue", () => {
  var pts = [].concat(weeks(2, "a", 1, 1), weeks(2, "b", 1, 1), weeks(2, "c", 1, 1));
  var s = chartData(pts, "line", { title: "T" }).series;
  expect(new Set(s.map((x) => x.dash)).size).toBe(3);
  expect(new Set(s.map((x) => x.color)).size).toBe(3);
});

test("an ungrouped query is one series named for the chart title", () => {
  var out = chartData([{ x: "a", group: null, y: 5 }], "line", { title: "Sessions" });
  expect(out.series.map((s) => s.name)).toEqual(["Sessions"]);
  expect(out.data).toEqual([{ x: "a", Sessions: 5 }]);
});

test("the summary names the first and last total, the span and the change", () => {
  var pts = weeks(12, null, 4120, 0);
  pts[11].y = 5030;
  var out = chartData(pts, "line", { title: "Sessions", unit: "weeks" });
  expect(out.summary).toBe("Sessions: " + (4120).toLocaleString() + " to " + (5030).toLocaleString() + " over 12 weeks, up 22%");
});

test("the summary adds the groups of one x together and says down for a fall", () => {
  var pts = [{ x: "a", group: "p", y: 50 }, { x: "a", group: "q", y: 50 }, { x: "b", group: "p", y: 30 }, { x: "b", group: "q", y: 20 }];
  expect(chartData(pts, "bar", { title: "T" }).summary).toBe("T: 100 to 50 over 2 points, down 50%");
});

test("a first total of zero gives no change claim, and no points a plain empty summary", () => {
  expect(chartData([{ x: "a", group: null, y: 0 }, { x: "b", group: null, y: 4 }], "line", { title: "T" }).summary).toBe("T: 0 to 4 over 2 points");
  expect(chartData([], "line", { title: "T" }).summary).toBe("T: no data");
});

test("share returns percentages that sum to 100 at every x", () => {
  var pts = [{ x: "a", group: "p", y: 1 }, { x: "a", group: "q", y: 2 }, { x: "a", group: "r", y: 4 }, { x: "b", group: "p", y: 5 }, { x: "b", group: "q", y: 5 }];
  var out = chartData(pts, "shareBar", { title: "T" });
  out.data.forEach((row) => {
    var sum = out.series.reduce((m, s) => m + (row[s.name] || 0), 0);
    expect(Math.abs(sum - 100)).toBeLessThan(1e-9);
  });
});

test("share with an all-zero x gives zero shares, never NaN", () => {
  var out = chartData([{ x: "a", group: "p", y: 0 }, { x: "a", group: "q", y: 0 }], "shareBar", { title: "T" });
  expect(out.data).toEqual([{ x: "a", p: 0, q: 0 }]);
});

test("x and group values named like Object.prototype members chart like any other value", () => {
  var names = ["__proto__", "constructor", "hasOwnProperty"];
  var pts = [];
  names.forEach(function (n, i) { pts.push({ x: n, group: n, y: i + 1 }); pts.push({ x: "z", group: n, y: 1 }); });
  var out = chartData(pts, "line", { title: "T" });
  expect(out.series.map((s) => s.name)).toEqual(names.slice().sort());
  var row = out.data.filter((r) => r.x === "constructor")[0];
  expect(Object.keys(row).sort()).toEqual(["__proto__", "constructor", "hasOwnProperty", "x"]);
  expect(row.constructor).toBe(2);
  expect(row.__proto__).toBe(null);
  var proto = out.data.filter((r) => r.x === "__proto__")[0];
  expect(Object.getOwnPropertyDescriptor(proto, "__proto__").value).toBe(1);
  expect(Object.getOwnPropertyDescriptor(out.tableRows.filter((r) => r.x === "__proto__")[0], "__proto__").value).toBe(1);
  expect(out.data.filter((r) => r.x === "z").length).toBe(1);
  expect(out.summary).toMatch(/^T: /);
});
