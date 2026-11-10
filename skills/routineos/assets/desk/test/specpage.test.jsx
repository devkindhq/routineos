import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "../app/App.jsx";
import { route } from "../core/router.js";
import { createStore } from "../core/store.js";

// Forces the capped flag a 30,000 row read would set, without making 30,000 documents.
var force = { capped: false };
vi.mock("../core/pages/spec-read.js", async (importOriginal) => {
  var real = await importOriginal();
  return {
    readSpecRows: (store, q) => real.readSpecRows(store, q).then((r) => (force.capped ? Object.assign({}, r, { capped: true }) : r)),
  };
});

var PAGE = {
  id: "overview",
  title: "Overview",
  controls: ["refresh", "dateRange", "filter"],
  filter: { field: "source", label: "Source" },
  blocks: [
    { id: "sessions", kind: "tile", label: "Sessions", span: { base: 12, md: 4 },
      query: { type: "metric", x: "week", aggregate: { op: "latest", field: "value" } } },
    { id: "ranged", kind: "tile", label: "In range", span: { md: 4 },
      query: { type: "metric", x: "week", window: "range", aggregate: { op: "sum", field: "value" } } },
    { id: "trend", kind: "chart", type: "line", title: "Trend", query: { type: "metric", x: "week", groupBy: "source", aggregate: { op: "sum", field: "value" } } },
    { id: "rows", kind: "table", title: "All metrics", columns: ["week", "source", "value"],
      query: { type: "metric", orderBy: ["week", "asc"] } },
    { id: "readme", kind: "text", heading: "About", text: "Numbers update **weekly**." },
  ],
};

var DEFINITION = {
  types: { metric: { plural: "Metrics", fields: { week: { type: "date" }, source: { type: "text" }, value: { type: "number" } } } },
  producers: [{ id: "weekly", label: "Weekly", types: ["metric"], schedule: "0 21 * * 0" }],
  desk: { pages: [PAGE] },
};

function metric(week, source, value) {
  var key = source + "/" + week;
  return { data: { type: "metric", key: key, status: "active", lastSeen: week, firstSeen: week, seenCount: 1, sources: ["weekly"],
    display: { week: week, source: source, value: value } } };
}

function docs(rows) {
  var out = { "meta/definition": { data: DEFINITION }, "meta/workspace": { data: { name: "Test workspace" } } };
  (rows || []).forEach((r, i) => { out["entities/metric--m" + i] = r; });
  return out;
}

var ROWS = [metric("2026-10-26", "organic", 100), metric("2026-10-26", "paid", 50), metric("2026-11-02", "organic", 120), metric("2026-11-02", "paid", 60)];

async function mount(hash, store) {
  window.history.replaceState(null, "", hash || "#/p/overview");
  var s = store || createStore("static", { docs: docs(ROWS) });
  render(<App store={s} config={{ store: "static", workspace: "Test workspace" }} />);
  await screen.findByRole("heading", { level: 1, name: "Overview" });
  return s;
}

function block(label) {
  return screen.getByText(label).closest("[data-block]");
}

beforeEach(() => {
  force.capped = false;
  try { localStorage.clear(); } catch (e) { /* storage blocked */ }
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); window.history.replaceState(null, "", "#/today"); });

test("a tile shows the latest total, the change as a number and the word up", async () => {
  await mount();
  var tile = await waitFor(() => { var t = block("Sessions"); expect(within(t).getByText("180")).toBeTruthy(); return t; });
  expect(within(tile).getByText(/20%/)).toBeTruthy();
  expect(within(tile).getByText(/\bup\b/)).toBeTruthy();
});

test("an empty store shows the empty line in every data block and never NaN", async () => {
  await mount("#/p/overview", createStore("static", { docs: docs([]) }));
  await waitFor(() => expect(screen.getAllByText("No data yet, the routine has not run").length).toBe(4));
  expect(document.body.textContent).not.toMatch(/NaN|undefined/);
});

test("a capped read shows the partial line exactly once", async () => {
  force.capped = true;
  await mount();
  await waitFor(() => expect(screen.getAllByText("Partial: the read stopped at its cap, so some data is missing").length).toBe(1));
});

test("a group value with markup is shown as text and makes no element", async () => {
  var bad = "<img src=x onerror=alert(1)>";
  await mount("#/p/overview", createStore("static", { docs: docs([metric("2026-11-02", bad, 5)]) }));
  await waitFor(() => expect(screen.getAllByText(bad).length).toBeGreaterThan(0));
  expect(document.querySelector("img")).toBeNull();
});

test("Refresh reloads the store once and reads again", async () => {
  var store = createStore("static", { docs: docs(ROWS) });
  var reload = vi.spyOn(store, "reload");
  var list = vi.spyOn(store, "list");
  await mount("#/p/overview", store);
  await waitFor(() => expect(within(block("Sessions")).getByText("180")).toBeTruthy());
  var reads = list.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(reads));
  expect(reload).toHaveBeenCalledTimes(1);
});

test("the filter control lands in the address and changes the numbers", async () => {
  await mount();
  await waitFor(() => expect(within(block("Sessions")).getByText("180")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Source"), { target: { value: "paid" } });
  await waitFor(() => expect(within(block("Sessions")).getByText("60")).toBeTruthy());
  expect(route(window.location.hash).params.query.filter).toBe("paid");
});

test("the date range control lands in the address and changes the numbers", async () => {
  await mount();
  await waitFor(() => expect(within(block("In range")).getByText("330")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-11-02" } });
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-11-02" } });
  await waitFor(() => expect(within(block("In range")).getByText("180")).toBeTruthy());
  expect(route(window.location.hash).params.query.range).toBe("2026-11-02..2026-11-02");
});

test("a range and a filter in the address are applied on load", async () => {
  await mount("#/p/overview?filter=paid&range=2026-10-26..2026-10-26");
  await waitFor(() => expect(within(block("In range")).getByText("50")).toBeTruthy());
});

test("blocks span the full width on a phone and the spec width from md", async () => {
  await mount();
  var col = (await waitFor(() => block("Sessions"))).parentElement;
  expect(col.className).toMatch(/Grid-col/);
  var cls = col.className.split(" ").find((c) => c.indexOf("__m__") === 0);
  await waitFor(() => {
    var css = [...document.querySelectorAll("style")].map((x) => x.textContent).join("");
    var rule = css.slice(css.indexOf("." + cls + "{"));
    expect(rule.slice(0, rule.indexOf("}") + 1)).toContain("--col-flex-basis:100%");
    expect(rule).toMatch(/@media\(min-width: 62em\)\{\.__m__[^{]*\{[^}]*33\.33/);
  });
  expect(document.body.innerHTML).toContain("33.33");
});

test("the table block shows cells as text in the declared order", async () => {
  await mount();
  var t = await waitFor(() => { var x = block("All metrics"); expect(within(x).getAllByRole("row").length).toBe(5); return x; });
  expect(within(t).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["week", "source", "value"]);
});

test("the text block renders its markdown", async () => {
  await mount();
  await screen.findByText("About");
  expect(within(block("About")).getByText("weekly").closest("strong")).not.toBeNull();
});

test("an unknown page id is a not found card", async () => {
  window.history.replaceState(null, "", "#/p/nope");
  render(<App store={createStore("static", { docs: docs(ROWS) })} config={{ store: "static", workspace: "Test workspace" }} />);
  expect(await screen.findByText("This page is not in this routine.")).toBeTruthy();
});

test("auto refresh waits for the next run, runs the refresh, and turning it off clears the timer", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 10, 8, 20, 0, 0)); // Sunday 20:00 UTC, the run is at 21:00
  var wait = 3600000 + 90000;
  var set = vi.spyOn(globalThis, "setTimeout");
  var clear = vi.spyOn(globalThis, "clearTimeout");
  var store = createStore("static", { docs: docs(ROWS) });
  var reload = vi.spyOn(store, "reload");
  await mount("#/p/overview", store);
  await waitFor(() => expect(set.mock.calls.some((c) => c[1] === wait)).toBe(true));
  var i = set.mock.calls.findIndex((c) => c[1] === wait);
  var id = set.mock.results[i].value;
  await act(async () => { set.mock.calls[i][0](); });
  expect(reload).toHaveBeenCalledTimes(1);
  var toggle = screen.getByRole("switch", { name: "Refresh after each run" });
  expect(toggle.checked).toBe(true);
  clear.mockClear();
  var again = set.mock.calls.length;
  fireEvent.click(toggle);
  await waitFor(() => expect(clear).toHaveBeenCalled());
  expect(toggle.checked).toBe(false);
  expect(set.mock.calls.slice(again).some((c) => c[1] === wait)).toBe(false);
  expect(id).toBeDefined();
  expect(localStorage.getItem("routineos-desk-autorefresh:overview")).toBe("off");
});

test("a chart block is drawn as a figure from the page's rows", async () => {
  await mount();
  var fig = await screen.findByRole("figure", { name: "Trend" });
  expect(within(fig).getByText("Trend: 150 to 180 over 2 points, up 20%")).toBeTruthy();
});
