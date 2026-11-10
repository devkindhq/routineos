import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useMantineTheme } from "@mantine/core";
import { afterEach, beforeEach, expect, test } from "vitest";
import { spotlight } from "@mantine/spotlight";
import App, { DeskProviders } from "../app/App.jsx";
import { themeFor } from "../app/usePrefs.js";
import { createStore } from "../core/store.js";
import { DENSITY_KEY, MOTION_KEY } from "../core/prefs.js";

var DEFINITION = { types: { bookmarks: { plural: "Bookmarks", fields: {} }, notes: { plural: "Notes", fields: {} } }, producers: [] };

function staticStore(extra) {
  return createStore("static", { docs: Object.assign({
    "meta/definition": { data: DEFINITION },
    "meta/workspace": { data: { name: "Test workspace" } },
  }, extra || {}) });
}

function setOnline(on) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: function () { return on; } });
}

function key(k, opts) {
  fireEvent.keyDown(document, Object.assign({ key: k }, opts || {}));
}

async function mount(hash, store) {
  window.history.replaceState(null, "", hash || "#/today");
  render(<App store={store || staticStore()} config={{ store: "static", workspace: "Test workspace" }} />);
  return screen.findByRole("heading", { level: 1 });
}

beforeEach(() => {
  try { localStorage.clear(); } catch (e) { /* storage blocked */ }
  setOnline(true);
});

afterEach(() => {
  cleanup();
  spotlight.close(); // the palette's open state lives in a module-level store that outlives a test
  window.history.replaceState(null, "", "#/today");
});

test("density maps to theme.scale and motion reduce sets respectReducedMotion", () => {
  expect(themeFor({ density: "compact", motion: "system" }).scale).toBe(0.9);
  expect(themeFor({ density: "comfortable", motion: "system" }).scale).toBe(1);
  expect(themeFor({ density: "comfortable", motion: "reduce" }).respectReducedMotion).toBe(true);
  expect(themeFor({ density: "comfortable", motion: "system" }).respectReducedMotion).toBe(false);
});

test("the providers apply the stored density and motion", () => {
  localStorage.setItem(DENSITY_KEY, "compact");
  localStorage.setItem(MOTION_KEY, "reduce");
  var seen = null;
  function Probe() { seen = useMantineTheme(); return null; }
  render(<DeskProviders store={staticStore()}><Probe /></DeskProviders>);
  expect(seen.scale).toBe(0.9);
  expect(seen.respectReducedMotion).toBe(true);
});

test("the shell shows the page title for the route", async () => {
  var h1 = await mount("#/today");
  await waitFor(() => expect(h1.textContent).toBe("Today"));
  expect(h1.id).toBe("page-title");
  expect(screen.getByRole("link", { name: /Bookmarks/ })).toBeTruthy();
});

test("a store with no db shows the no-db state", async () => {
  window.history.replaceState(null, "", "#/today");
  render(<App store={createStore("db", { claude: null })} config={{}} />);
  expect(await screen.findByText("This page needs the db capability. Republish it with db declared.")).toBeTruthy();
});

test("a workspace with no definition shows not set up", async () => {
  render(<App store={createStore("static", { docs: {} })} config={{ workspace: "Empty" }} />);
  expect(await screen.findByText(/Empty is not set up yet/)).toBeTruthy();
});

test("[ toggles the navbar", async () => {
  await mount("#/today");
  var burger = await screen.findByRole("button", { name: "Toggle sidebar" });
  expect(burger.getAttribute("aria-expanded")).toBe("true");
  key("[");
  await waitFor(() => expect(burger.getAttribute("aria-expanded")).toBe("false"));
  key("[");
  await waitFor(() => expect(burger.getAttribute("aria-expanded")).toBe("true"));
});

test("g then b goes to the first type's Browse", async () => {
  await mount("#/today");
  await screen.findByRole("link", { name: /Bookmarks/ });
  key("g");
  key("b");
  await waitFor(() => expect(window.location.hash).toBe("#/browse/bookmarks"));
  await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Bookmarks"));
});

test("? opens the shortcuts modal", async () => {
  await mount("#/today");
  await screen.findByRole("link", { name: /Bookmarks/ });
  key("?");
  expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toBeTruthy();
  expect(screen.getByText("Command palette")).toBeTruthy();
});

test("Ctrl K opens the command palette", async () => {
  await mount("#/today");
  await screen.findByRole("link", { name: /Bookmarks/ });
  key("k", { ctrlKey: true });
  expect(await screen.findByPlaceholderText("Search or jump to")).toBeTruthy();
  expect(await screen.findByText("Go to Bookmarks")).toBeTruthy();
});

test("f on Browse dispatches open-filters, and not elsewhere", async () => {
  var seen = 0;
  function on() { seen++; }
  window.addEventListener("desk:open-filters", on);
  try {
    await mount("#/today");
    await screen.findByRole("link", { name: /Bookmarks/ });
    key("f");
    expect(seen).toBe(0);
    act(() => { window.location.hash = "#/browse/bookmarks"; });
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Bookmarks"));
    key("f");
    expect(seen).toBe(1);
  } finally {
    window.removeEventListener("desk:open-filters", on);
  }
});

test("old addresses redirect as core/router.js says", async () => {
  var cases = [
    ["#/inbox", "#/approvals", "Approvals"],
    ["#/suggestions", "#/approvals?kind=proposals", "Approvals"],
    ["#/views", "#/settings/views", "Settings"],
    ["#/history/r1", "#/runs/r1", "Run"],
    ["#/settings?section=members", "#/settings/members", "Settings"],
  ];
  for (var c of cases) {
    var h1 = await mount(c[0]);
    await waitFor(() => expect(h1.textContent).toBe(c[2]));
    expect(window.location.hash).toBe(c[1]);
    cleanup();
  }
});

test("going offline shows the offline alert and coming back hides it", async () => {
  await mount("#/today");
  await screen.findByRole("link", { name: /Bookmarks/ });
  expect(screen.queryByText("You are offline. Changes are paused.")).toBeNull();
  setOnline(false);
  act(() => { window.dispatchEvent(new Event("offline")); });
  expect(await screen.findByText("You are offline. Changes are paused.")).toBeTruthy();
  setOnline(true);
  act(() => { window.dispatchEvent(new Event("online")); });
  await waitFor(() => expect(screen.queryByText("You are offline. Changes are paused.")).toBeNull());
});

test("a read-only store says so once", async () => {
  await mount("#/today");
  expect(await screen.findByText(/Changes cannot be saved on this page/)).toBeTruthy();
});

test("page keys are off while the shortcuts modal is open", async () => {
  await mount("#/today");
  await screen.findByRole("link", { name: /Bookmarks/ });
  key("?");
  await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
  fireEvent.keyDown(document.body, { key: "g" });
  fireEvent.keyDown(document.body, { key: "b" });
  await new Promise((r) => setTimeout(r, 50));
  expect(window.location.hash).toBe("#/today");
});

test("page keys are off while the command palette is open", async () => {
  await mount("#/today");
  await screen.findByRole("link", { name: /Bookmarks/ });
  key("k", { ctrlKey: true });
  await screen.findByPlaceholderText("Search or jump to");
  fireEvent.keyDown(document.body, { key: "?" });
  await new Promise((r) => setTimeout(r, 50));
  expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull();
});

if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

function manyRoles(n) {
  var out = {};
  for (var i = 0; i < n; i++) {
    out["entities/bookmarks--r" + i] = { data: { type: "bookmarks", key: "r" + i, status: "active", display: { title: "Analyst " + i } } };
  }
  return out;
}

test("the palette lists Switch theme and Take the tour, and Switch theme changes the theme preference", async () => {
  await mount("#/today", staticStore({}));
  await screen.findByRole("link", { name: /Bookmarks/ });
  key("k", { ctrlKey: true });
  fireEvent.change(await screen.findByPlaceholderText("Search or jump to"), { target: { value: "theme" } });
  var item = await screen.findByText("Switch theme");
  fireEvent.click(item);
  await waitFor(() => expect(localStorage.getItem("routineos-desk-theme")).toBe("light"));
});

test("the palette offers Take the tour while the tour is available", async () => {
  window.history.replaceState(null, "", "#/today");
  render(<App store={staticStore()} config={{ store: "static", workspace: "Test workspace", tour: true }} />);
  await screen.findByRole("link", { name: /Bookmarks/ });
  key("k", { ctrlKey: true });
  fireEvent.change(await screen.findByPlaceholderText("Search or jump to"), { target: { value: "tour" } });
  expect(await screen.findByText("Take the tour")).toBeTruthy();
});

test("palette record search reads every record and says when results are capped", async () => {
  await mount("#/today", staticStore(manyRoles(25)));
  await screen.findByRole("link", { name: /Bookmarks/ });
  key("k", { ctrlKey: true });
  fireEvent.change(await screen.findByPlaceholderText("Search or jump to"), { target: { value: "analyst" } });
  expect(await screen.findByText("Results capped. Keep typing to narrow them.")).toBeTruthy();
  fireEvent.change(screen.getByPlaceholderText("Search or jump to"), { target: { value: "analyst 24" } });
  expect(await screen.findByText("r24")).toBeTruthy();
  expect(screen.queryByText("Results capped. Keep typing to narrow them.")).toBeNull();
});

function bigRead(store, mode) {
  var list = store.list, n = 0;
  store.list = function (coll, opts) {
    if (coll === "entities" && opts && opts.limit === 1 && mode !== "fail") return Promise.resolve([{ id: "bookmarks--more", data: { type: "bookmarks", key: "zzzzzzzz", status: "active" } }]);
    if (coll !== "entities" || !opts || opts.limit !== 1000) return list.apply(store, arguments);
    if (mode === "fail") return Promise.reject(new Error("read failed"));
    var rows = [];
    for (var i = 0; i < 1000; i++, n++) rows.push({ id: "bookmarks--z" + n, data: { type: "bookmarks", key: "z" + String(n).padStart(8, "0"), status: "active", display: { title: "Item " + n } } });
    return Promise.resolve(rows);
  };
  return store;
}

test("palette says results are capped when the full read hit its limit, even with few matches", async () => {
  await mount("#/today", bigRead(staticStore({})));
  await screen.findByRole("link", { name: /Bookmarks/ });
  key("k", { ctrlKey: true });
  fireEvent.change(await screen.findByPlaceholderText("Search or jump to"), { target: { value: "item 29999" } });
  expect(await screen.findByText("Results capped. Keep typing to narrow them.")).toBeTruthy();
});

test("palette says search is unavailable when the record read fails, not that nothing matches", async () => {
  await mount("#/today", bigRead(staticStore({}), "fail"));
  await screen.findByRole("link", { name: /Bookmarks/ });
  key("k", { ctrlKey: true });
  fireEvent.change(await screen.findByPlaceholderText("Search or jump to"), { target: { value: "analyst" } });
  expect(await screen.findByText("Record search is unavailable. Try again later.")).toBeTruthy();
});

test("the user menu says who is signed in and that there is no sign-out here", async () => {
  var store = staticStore({});
  store.viewer = () => Promise.resolve("u1");
  store.profiles = () => Promise.resolve({ u1: { name: "Alex Rivera" } });
  await mount("#/today", store);
  fireEvent.click(await screen.findByRole("button", { name: "Your settings" }));
  expect(await screen.findByText("Signed in as Alex Rivera")).toBeTruthy();
  expect(screen.getByText("No sign-out here")).toBeTruthy();
});

test("the user menu has no Signed in line when the name does not resolve", async () => {
  var store = staticStore({});
  store.viewer = () => Promise.resolve("u1");
  await mount("#/today", store);
  fireEvent.click(await screen.findByRole("button", { name: "Your settings" }));
  await screen.findByText("Keyboard shortcuts");
  expect(screen.queryByText(/^Signed in as/)).toBeNull();
});

test("the bell opens a side sheet with the notices", async () => {
  await mount("#/today", staticStore({}));
  var bell = document.querySelector("[data-tour=bell]");
  fireEvent.click(bell);
  var sheet = await screen.findByRole("dialog", { name: "Notifications" });
  expect(within(sheet).getByText("Nothing new this week.")).toBeTruthy();
  expect(bell.getAttribute("aria-expanded")).toBe("true");
});
