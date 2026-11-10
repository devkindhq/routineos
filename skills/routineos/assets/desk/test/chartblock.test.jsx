import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { afterEach, expect, test } from "vitest";
import ChartBlock from "../app/pages/spec/ChartBlock.jsx";
import { chartData } from "../app/pages/spec/chartData.js";

afterEach(cleanup);

var POINTS = [
  { x: "2026-10-26", group: "organic", y: 100 }, { x: "2026-10-26", group: "paid", y: 50 },
  { x: "2026-11-02", group: "organic", y: 120 }, { x: "2026-11-02", group: "paid", y: 60 },
];
var SPEC = { id: "trend", kind: "chart", type: "line", title: "Sessions by source", query: { type: "metric", x: "week", window: { last: { n: 2, unit: "weeks" } } } };

function show(spec, points) {
  return render(<MantineProvider><ChartBlock spec={spec} points={points} /></MantineProvider>);
}

test("a chart is a figure with a name and a one sentence summary", () => {
  show(SPEC, POINTS);
  var fig = screen.getByRole("figure", { name: "Sessions by source" });
  expect(within(fig).getByText("Sessions by source: 150 to 180 over 2 weeks, up 20%")).toBeTruthy();
});

test("the table switch shows the same numbers as the chart data, and works from the keyboard", async () => {
  var user = userEvent.setup();
  show(SPEC, POINTS);
  expect(screen.queryByRole("table")).toBeNull();
  await user.tab();
  expect(document.activeElement).toBe(screen.getByRole("switch", { name: "Show as table" }));
  await user.keyboard(" ");
  var table = screen.getByRole("table");
  var want = chartData(POINTS, "line", { title: "x" }).tableRows;
  var rows = within(table).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell").map((c) => c.textContent));
  expect(rows).toEqual(want.map((r) => [r.x, String(r.organic), String(r.paid)]));
  await user.keyboard(" ");
  expect(screen.queryByRole("table")).toBeNull();
});

test("no points show the empty line and no axis", () => {
  show(SPEC, []);
  expect(screen.getByText("No data yet, the routine has not run")).toBeTruthy();
  expect(screen.queryByRole("switch")).toBeNull();
});

test("markup in a group name is text in the table and the legend, never an element", async () => {
  var bad = "<img src=x onerror=alert(1)>";
  var user = userEvent.setup();
  show(SPEC, [{ x: "a", group: bad, y: 3 }]);
  await user.tab();
  await user.keyboard(" ");
  expect(screen.getAllByText(bad).length).toBeGreaterThan(0);
  expect(document.querySelector("img")).toBeNull();
});

test("each chart type renders a figure", () => {
  ["bar", "stackedBar", "shareBar", "sparkline"].forEach((type) => {
    var { unmount } = show(Object.assign({}, SPEC, { type: type }), POINTS);
    expect(screen.getByRole("figure", { name: "Sessions by source" })).toBeTruthy();
    unmount();
  });
});
