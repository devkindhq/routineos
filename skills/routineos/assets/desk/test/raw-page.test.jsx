// T-M2, T-M3, T-M4: a raw React page (window.DESK_PAGES thunk) mounted by ExtHost through RawPageHost.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useComputedColorScheme } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DeskProviders } from "../app/App.jsx";
import ExtHost from "../app/ExtHost.jsx";
import RawPageHost from "../app/RawPageHost.jsx";
import { ModelProvider } from "../app/StoreContext.jsx";
import { SpecBlock } from "../app/pages/spec/blocks.jsx";
import { declaredExtension, extCtx, snapshotExtensions } from "../core/ext.js";
import { readSpecRows } from "../core/pages/spec-read.js";
import { evalQuery, tableRows } from "../core/pages/spec-query.js";
import { createStore } from "../core/store.js";

var DEFINITION = {
  types: { metric: { plural: "Metrics", fields: { week: { type: "date" }, source: { type: "text" }, value: { type: "number" } } } },
  producers: [],
};

function metric(week, source, value) {
  var key = source + "/" + week;
  return { data: { type: "metric", key: key, status: "active", lastSeen: week, firstSeen: week, seenCount: 1, sources: ["weekly"],
    display: { week: week, source: source, value: value } } };
}

var ROWS = [metric("2026-10-26", "organic", 100), metric("2026-10-26", "paid", 50), metric("2026-11-02", "organic", 120), metric("2026-11-02", "paid", 60)];

function staticStore() {
  var docs = { "meta/definition": { data: DEFINITION }, "meta/workspace": { data: { name: "Test workspace" } } };
  ROWS.forEach((r, i) => { docs["entities/metric--m" + i] = r; });
  return createStore("static", { docs: docs });
}

var TILE = { id: "sessions", kind: "tile", label: "Sessions", query: { type: "metric", x: "week", aggregate: { op: "latest", field: "value" } } };
var CHART_QUERY = { type: "metric", x: "week", groupBy: "source", aggregate: { op: "sum", field: "value" } };

function register(id, thunk, extra) {
  window.DESK_EXTENSIONS = { [id]: Object.assign({ slot: "page", verbs: [], raw: true }, extra || {}) };
  window.DESK_PAGES = {};
  if (thunk) window.DESK_PAGES[id] = thunk;
  snapshotExtensions(window.DESK_EXTENSIONS);
}

function Desk({ store, children }) {
  return (
    <DeskProviders store={store || staticStore()}>
      <ModelProvider model={{ viewer: "u1", definition: DEFINITION, join: null, owner: "u1" }}>{children}</ModelProvider>
    </DeskProviders>
  );
}

function redCalls(spy) {
  return spy.mock.calls.filter((c) => c[0] && c[0].color === "red").length;
}

var show;
beforeEach(() => {
  try { localStorage.clear(); } catch (e) { /* storage blocked */ }
  show = vi.spyOn(notifications, "show");
});

afterEach(() => {
  cleanup();
  notifications.clean();
  vi.restoreAllMocks();
  delete window.DESK_EXTENSIONS;
  window.DESK_PAGES = {};
  window.history.replaceState(null, "", "#/today");
});

test("snapshotExtensions keeps raw: true and nothing else truthy", () => {
  snapshotExtensions({ a: { slot: "page", raw: true }, b: { slot: "page", raw: "yes" }, c: { slot: "page" } });
  expect(declaredExtension("a").raw).toBe(true);
  expect(declaredExtension("b").raw).toBeUndefined();
  expect(declaredExtension("c").raw).toBeUndefined();
});

test("T-M2: a raw page uses the Desk's theme, hooks, Modal and notifications", async () => {
  var seen = {};
  register("dash", function (DESK_LIB) {
    var h = DESK_LIB.react.createElement;
    var M = DESK_LIB["@mantine/core"];
    var useDisclosure = DESK_LIB["@mantine/hooks"].useDisclosure;
    var notes = DESK_LIB["@mantine/notifications"].notifications;
    return function Page({ ctx, ui, props }) {
      var theme = M.useMantineTheme();
      seen.scheme = M.useComputedColorScheme("light");
      seen.primary = theme.primaryColor;
      seen.ctx = ctx;
      seen.ui = ui;
      seen.props = props;
      var [opened, d] = useDisclosure(false);
      return h(DESK_LIB.react.Fragment, null,
        h(M.Button, { onClick: () => { d.open(); notes.show({ title: "Saved", message: "Raw page note" }); } }, "Open"),
        h(M.Modal, { opened: opened, onClose: d.close, title: "Details" }, h(M.Text, null, "Modal body")));
    };
  });
  var desk = {};
  function Probe() { desk.scheme = useComputedColorScheme("light"); return null; }
  var r = render(<Desk><Probe /><ExtHost id="dash" props={{ args: [], params: {} }} fallback="FALLBACK" /></Desk>);
  expect(r.container.querySelector('[data-ext="dash"][data-raw]')).not.toBeNull();
  expect(seen.scheme).toBe(desk.scheme);
  expect(typeof seen.primary).toBe("string");
  expect(seen.props).toEqual({ args: [], params: {} });
  expect(typeof seen.ctx.read).toBe("function");
  expect(typeof seen.ctx.query).toBe("function");
  expect(Object.keys(seen.ui).sort()).toEqual(["block", "navigate"]);
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  expect(await screen.findByText("Modal body")).toBeTruthy();
  expect(await screen.findByText("Raw page note")).toBeTruthy();
});

function thrower(flag) {
  return function (DESK_LIB) {
    var h = DESK_LIB.react.createElement;
    return function Page() {
      if (flag.on) throw new Error("boom");
      return h("p", null, "Page is fine");
    };
  };
}

test("T-M3: a page that throws in render shows the stop note, notifies once, keeps siblings, and Try again recovers", async () => {
  var flag = { on: true };
  register("bad", thrower(flag));
  var quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  render(<Desk><p>Sibling stays</p><ExtHost id="bad" props={{ args: [], params: {} }} fallback="FALLBACK" /></Desk>);
  expect(screen.getByText("This page stopped. Details are in the browser console.")).toBeTruthy();
  expect(screen.getByText("Sibling stays")).toBeTruthy();
  expect(redCalls(show)).toBe(1);
  expect(quiet).toHaveBeenCalled();
  flag.on = false;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Page is fine")).toBeTruthy();
  expect(screen.queryByText("This page stopped. Details are in the browser console.")).toBeNull();
  expect(screen.getByText("Sibling stays")).toBeTruthy();
  expect(redCalls(show)).toBe(1);
});

test("T-M4: a missing DESK_PAGES entry shows the fallback passed in, or plain text when none is", () => {
  register("gone", null);
  var a = render(<Desk><RawPageHost id="gone" props={{}} fallback={<p>Host fallback</p>} /></Desk>);
  expect(screen.getByText("Host fallback")).toBeTruthy();
  expect(redCalls(show)).toBe(1);
  a.unmount();
  render(<Desk><RawPageHost id="gone" props={{}} /></Desk>);
  expect(screen.getByText("This page could not load.")).toBeTruthy();
});

test("T-M4: a thunk that throws shows the fallback and notifies once", () => {
  var calls = 0;
  register("broken", function () { calls++; throw new Error("bad thunk"); });
  var quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  var r = render(<Desk><ExtHost id="broken" props={{}} fallback={<p>Host fallback</p>} /></Desk>);
  expect(screen.getByText("Host fallback")).toBeTruthy();
  expect(redCalls(show)).toBe(1);
  expect(quiet).toHaveBeenCalled();
  r.rerender(<Desk><ExtHost id="broken" props={{ again: 1 }} fallback={<p>Host fallback</p>} /></Desk>);
  expect(calls).toBe(1);
  expect(redCalls(show)).toBe(1);
});

test("a thunk that returns something that is not a component shows the fallback", () => {
  register("odd", function () { return 42; });
  vi.spyOn(console, "error").mockImplementation(() => {});
  render(<Desk><ExtHost id="odd" props={{}} /></Desk>);
  expect(screen.getByText("This page could not load.")).toBeTruthy();
  expect(redCalls(show)).toBe(1);
});

test("ui.navigate changes location.hash and ui.block draws the same text a spec tile draws", async () => {
  window.history.replaceState(null, "", "#/browse/metric");
  var held = {};
  register("nav", function (DESK_LIB) {
    var h = DESK_LIB.react.createElement;
    return function Page({ ui }) {
      held.ui = ui;
      return h("div", { "data-testid": "raw" }, h(ui.block, { spec: TILE, records: ROWS.map((d, i) => ({ id: "metric--m" + i, data: d.data })) }));
    };
  });
  render(<Desk><ExtHost id="nav" props={{}} /></Desk>);
  held.ui.navigate("#/today");
  expect(window.location.hash).toBe("#/today");
  var direct = render(<Desk><SpecBlock spec={TILE} records={ROWS.map((d, i) => ({ id: "metric--m" + i, data: d.data }))} /></Desk>);
  var raw = screen.getByTestId("raw");
  expect(raw.textContent).toContain("Sessions");
  expect(raw.textContent).toContain("180");
  expect(raw.textContent).toBe(direct.container.querySelector('[data-block="sessions"]').textContent);
});

test("ctx.query returns the rows evalQuery gives, a tile value, and table rows for a query without aggregate", async () => {
  var store = staticStore();
  var held = {};
  register("q", function (DESK_LIB) {
    return function Page({ ctx }) { held.ctx = ctx; return DESK_LIB.react.createElement("p", null, "q"); };
  });
  render(<Desk store={store}><ExtHost id="q" props={{}} /></Desk>);
  var read = (await readSpecRows(store, { type: "metric" })).rows;
  var now = { now: Date.now(), range: null, filter: null };

  var chart = await held.ctx.query(CHART_QUERY);
  expect(chart.rows).toEqual(evalQuery(read, CHART_QUERY, now).points);
  expect(chart.rows.length).toBe(4);
  expect(chart.value).toBeNull();

  var tile = await held.ctx.query(TILE.query);
  expect(tile.rows).toEqual(evalQuery(read, TILE.query, now).points);
  expect(tile.value).toBe(180);

  var tq = { type: "metric", orderBy: ["week", "asc"], limit: 3 };
  var table = await held.ctx.query(tq);
  expect(table.rows).toEqual(tableRows(read, tq, now));
  expect(table.value).toBeNull();

  await expect(held.ctx.query({})).rejects.toThrow(/type/);
});

test("ctx.query is on a raw page's ctx and not on a factory component's ctx", () => {
  var base = { store: staticStore(), viewer: "u1" };
  var factory = extCtx(base, () => {}, [], { types: null }, { id: "plain", slot: "page" });
  var raw = extCtx(base, () => {}, [], { types: null }, { id: "rawp", slot: "page", raw: true });
  expect("query" in factory).toBe(false);
  expect(typeof raw.query).toBe("function");
});

test("a stopped page resets when the record it shows changes", async () => {
  var flag = { on: true };
  register("sec", thrower(flag), { slot: "record-section" });
  var quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  var store = staticStore();
  var view = (id) => <Desk store={store}><ExtHost id="sec" props={{ type: "metric", id: id, record: {} }} /></Desk>;
  var r = render(view("a"));
  expect(screen.getByText("This page stopped. Details are in the browser console.")).toBeTruthy();
  flag.on = false;
  r.rerender(view("b"));
  expect(await screen.findByText("Page is fine")).toBeTruthy();
  expect(quiet).toHaveBeenCalled();
});
