import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "../app/App.jsx";
import Tile from "../app/pages/spec/Tile.jsx";
import { SpecBlock } from "../app/pages/spec/blocks.jsx";
import { deskPages } from "../core/palette.js";
import { createStore } from "../core/store.js";

var force = { poison: false };
vi.mock("../core/pages/spec-read.js", async (importOriginal) => {
  var real = await importOriginal();
  return {
    readSpecRows: (store, q) => real.readSpecRows(store, q).then((r) => {
      if (!force.poison) return r;
      var bad = { id: "bad", type: "metric", status: "active", f: {} };
      Object.defineProperty(bad, "a", { get() { throw new Error("boom"); } });
      return Object.assign({}, r, { rows: [bad] });
    }),
  };
});

var PAGE = {
  id: "overview",
  title: "Overview",
  controls: ["refresh", "dateRange", "filter"],
  filter: { field: "source", label: "Source" },
  blocks: [
    { id: "sessions", kind: "tile", label: "Sessions", query: { type: "metric", x: "week", aggregate: { op: "latest", field: "value" } } },
    { id: "trend", kind: "chart", type: "line", title: "Trend", query: { type: "metric", x: "week", groupBy: "source", aggregate: { op: "sum", field: "value" } } },
  ],
};

function definition(page) {
  return {
    types: { metric: { plural: "Metrics", fields: { week: { type: "date" }, source: { type: "text" }, value: { type: "number" } } } },
    producers: [{ id: "weekly", label: "Weekly", types: ["metric"], schedule: "0 21 * * 0" }],
    desk: { pages: [page || PAGE] },
  };
}

function metric(week, source, value) {
  var key = source + "/" + week;
  return { data: { type: "metric", key: key, status: "active", lastSeen: week, firstSeen: week, seenCount: 1, sources: ["weekly"],
    display: { week: week, source: source, value: value } } };
}

var ROWS = [metric("2026-10-26", "organic", 100), metric("2026-10-26", "paid", 50), metric("2026-11-02", "organic", 120), metric("2026-11-02", "paid", 60)];

function docs(rows, page) {
  var out = { "meta/definition": { data: definition(page) }, "meta/workspace": { data: { name: "Test workspace" } } };
  rows.forEach((r, i) => { out["entities/metric--m" + i] = r; });
  return out;
}

async function mount(hash, store, page) {
  window.history.replaceState(null, "", hash || "#/p/overview");
  var s = store || createStore("static", { docs: docs(ROWS, page) });
  render(<App store={s} config={{ store: "static", workspace: "Test workspace" }} />);
  await screen.findByRole("heading", { level: 1, name: "Overview" });
  return s;
}

beforeEach(() => { force.poison = false; try { localStorage.clear(); } catch (e) { /* blocked */ } });
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, "", "#/today"); });

test("a range in the address that is not a real date leaves the page up", async () => {
  await mount("#/p/overview?range=2026-13-45..2026-99-99");
  expect(screen.getByRole("heading", { level: 1, name: "Overview" })).toBeTruthy();
  await waitFor(() => expect(screen.getByText("Sessions").closest("[data-block]").textContent).toContain("180"));
});

test("a block that throws while drawing shows a note and the rest of the Desk stays up", async () => {
  force.poison = true;
  await mount();
  await waitFor(() => expect(screen.getAllByText(/could not be drawn/i).length).toBeGreaterThan(0));
  expect(screen.getByRole("heading", { level: 1, name: "Overview" })).toBeTruthy();
});

test("a hand edited block with no aggregate is dropped by the client and does not crash the page", async () => {
  var bad = { id: "broken", kind: "tile", label: "Broken", query: { type: "metric", x: "week" } };
  var page = Object.assign({}, PAGE, { blocks: PAGE.blocks.concat([bad]) });
  var kept = deskPages(definition(page))[0].blocks.map((b) => b.id);
  expect(kept).toEqual(["sessions", "trend"]);
  await mount("#/p/overview", undefined, page);
  expect(screen.queryByText("Broken")).toBeNull();
});

test("the client drops a block whose window or kind the lint would refuse", () => {
  var blocks = [
    { id: "a", kind: "tile", label: "A", query: { type: "metric", x: "week", aggregate: { op: "sum", field: "value" }, window: { last: { n: 1e12, unit: "days" } } } },
    { id: "b", kind: "mystery", query: { type: "metric" } },
    { id: "c", kind: "tile", label: "C", query: { type: "metric", x: "week", aggregate: { op: "sum", field: "value" }, window: { last: { n: 4, unit: "weeks" } } } },
  ];
  var kept = deskPages(definition(Object.assign({}, PAGE, { blocks: blocks })))[0].blocks.map((b) => b.id);
  expect(kept).toEqual(["c"]);
});

test("a filter value that is not in the data is shown as All and applies no filter", async () => {
  await mount("#/p/overview?filter=zzz");
  await waitFor(() => expect(screen.getByText("Sessions").closest("[data-block]").textContent).toContain("180"));
  expect(screen.getByLabelText("Source").value).toBe("");
});

test("a tile says how many values it skipped", () => {
  var rows = [
    { id: "1", type: "metric", status: "active", f: { week: "2026-11-02", value: 10 }, a: {} },
    { id: "2", type: "metric", status: "active", f: { week: "2026-11-02", value: "12" }, a: {} },
  ];
  var block = PAGE.blocks[0];
  render(<MantineProvider><Tile block={block} rows={rows} ctx={{ now: Date.UTC(2026, 10, 10), range: null, filter: null }} /></MantineProvider>);
  expect(screen.getByText(/1 value skipped/)).toBeTruthy();
});

test("a tile with only a skipped latest week still shows the earlier number", () => {
  var rows = [
    { id: "1", type: "metric", status: "active", f: { week: "2026-11-02", value: 100 }, a: {} },
    { id: "2", type: "metric", status: "active", f: { week: "2026-11-09", value: "n/a" }, a: {} },
  ];
  render(<MantineProvider><Tile block={PAGE.blocks[0]} rows={rows} ctx={{ now: Date.UTC(2026, 10, 10), range: null, filter: null }} /></MantineProvider>);
  expect(screen.getByText("100")).toBeTruthy();
  expect(screen.queryByText(/No data yet/)).toBeNull();
});

test("a tile with a window part covered shows no change line", () => {
  var rows = ["2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09"].map((w, i) => ({ id: w, type: "metric", status: "active", f: { week: w, value: i === 0 ? 100 : 300 }, a: {} }));
  var block = { id: "s", kind: "tile", label: "S", query: { type: "metric", x: "week", aggregate: { op: "sum", field: "value" }, window: { last: { n: 3, unit: "weeks" } } } };
  render(<MantineProvider><Tile block={block} rows={rows} ctx={{ now: Date.UTC(2026, 10, 10), range: null, filter: null }} /></MantineProvider>);
  expect(screen.getByText("900")).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/%/);
  expect(document.body.textContent).toMatch(/no change data/i);
});

test("ui.block with a null record or a non-object spec draws nothing and does not throw", () => {
  expect(() => render(<MantineProvider><SpecBlock spec={PAGE.blocks[0]} records={[null, undefined, 3]} /></MantineProvider>)).not.toThrow();
  expect(() => render(<MantineProvider><SpecBlock spec={"tile"} records={[null]} /></MantineProvider>)).not.toThrow();
  expect(() => render(<MantineProvider><SpecBlock spec={null} records={null} /></MantineProvider>)).not.toThrow();
});

test("changing the filter or the range does not read the entities again", async () => {
  var store = createStore("static", { docs: docs(ROWS) });
  var list = vi.spyOn(store, "list");
  await mount("#/p/overview", store);
  await waitFor(() => expect(screen.getByText("Sessions").closest("[data-block]").textContent).toContain("180"));
  var reads = list.mock.calls.length;
  fireEvent.change(screen.getByLabelText("Source"), { target: { value: "paid" } });
  await waitFor(() => expect(within(screen.getByText("Sessions").closest("[data-block]")).getByText("60")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-11-02" } });
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-11-02" } });
  await new Promise((r) => setTimeout(r, 50));
  expect(list.mock.calls.length).toBe(reads);
});

test("while the first read is going the blocks say so and do not claim the routine has not run", async () => {
  var store = createStore("static", { docs: docs(ROWS) });
  var real = store.list.bind(store);
  var release;
  var gate = new Promise((r) => { release = r; });
  vi.spyOn(store, "list").mockImplementation((...a) => gate.then(() => real(...a)));
  await mount("#/p/overview", store);
  expect(screen.queryByText("No data yet, the routine has not run")).toBeNull();
  expect(screen.getByText(/Reading the data/i)).toBeTruthy();
  release();
  await waitFor(() => expect(screen.getByText("Sessions").closest("[data-block]").textContent).toContain("180"));
});
