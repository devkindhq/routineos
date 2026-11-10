import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "../app/App.jsx";
import { createStore } from "../core/store.js";
import { colsKey } from "../core/viewerstate.js";

var DEFINITION = {
  types: { roles: { plural: "Roles", order: ["title", "salary", "level"], fields: {
    title: { label: "Title", type: "text", summary: true },
    salary: { label: "Salary", type: "number", summary: true },
    level: { label: "Level", type: "choice", choices: ["junior", "senior"] },
  } } },
  producers: [{ id: "scout", label: "Scout", types: ["roles"] }],
};
function entity(key, title) {
  return { data: { type: "roles", key: key, status: "active", lastSeen: "2026-11-03T00:00:00Z", firstSeen: "2026-11-01T00:00:00Z",
    sources: ["scout"], display: { title: title, salary: 100, level: "junior" } } };
}
var DOCS = {
  "meta/definition": { data: DEFINITION },
  "meta/workspace": { data: { name: "Test workspace" } },
  "entities/roles--a": entity("a", "Analyst"),
};

// A signed-in store that keeps what it is given, so a second visit reads it back.
function mem(answer) {
  var docs = Object.assign({}, DOCS);
  var store = createStore("static", { docs: docs });
  store.readOnly = false;
  store.viewer = () => Promise.resolve("u1");
  var written = {};
  store.set = vi.fn((p, d) => { written[p] = d; docs[p] = { version: 1, data: d }; return Promise.resolve(); });
  store.del = vi.fn((p) => { delete written[p]; delete docs[p]; return Promise.resolve(); });
  store.get = vi.fn((p) => Promise.resolve(docs[p] ? { path: p, exists: true, data: docs[p].data || docs[p] } : { path: p, exists: false, data: null }));
  if (answer !== undefined) store.canWriteShared = () => Promise.resolve(answer);
  store.written = written;
  return store;
}

async function mount(hash, store) {
  window.history.replaceState(null, "", hash);
  render(<App store={store} config={{ store: "static", workspace: "Test workspace" }} />);
  await screen.findByRole("link", { name: "Analyst" });
}
function headers() { return Array.from(document.querySelectorAll("th")).map((h) => h.textContent.replace(/\s+/g, " ").trim()).filter(Boolean); }
function openColumns() { fireEvent.click(screen.getByRole("button", { name: "Columns" })); }
async function toggle(name) { openColumns(); fireEvent.click(await screen.findByRole("menuitem", { name: name })); }
function go(hash) { act(() => { window.location.hash = hash; window.dispatchEvent(new HashChangeEvent("hashchange")); }); }

beforeEach(() => { try { localStorage.clear(); } catch (e) { /* blocked */ } });
afterEach(() => { cleanup(); window.history.replaceState(null, "", "#/today"); });

test("a Contributor's column choice is kept in the database and survives leaving and returning", async () => {
  var store = mem(true);
  await mount("#/browse/roles", store);
  var before = headers();
  var target = before.some((h) => /Level/.test(h)) ? "Level" : "Salary";
  var had = before.some((h) => h.indexOf(target) === 0);
  await toggle(target);
  await waitFor(() => expect(store.set).toHaveBeenCalledWith("data/users/u1/state/cols/roles", expect.objectContaining({ by: "u1", cols: expect.any(Array) })));
  var chosen = headers();
  expect(chosen.some((h) => h.indexOf(target) === 0)).toBe(!had);
  go("#/today");
  await screen.findByRole("heading", { level: 1 });
  go("#/browse/roles");
  await screen.findByRole("link", { name: "Analyst" });
  await waitFor(() => expect(headers()).toEqual(chosen));
});

test("a Commenter's choice stays on this device, with no database write", async () => {
  var store = mem(false);
  await mount("#/browse/roles", store);
  var target = headers().some((h) => h.indexOf("Salary") === 0) ? "Level" : "Salary";
  await toggle(target);
  var chosen = headers();
  await waitFor(() => expect(localStorage.getItem(colsKey("u1", "roles"))).not.toBeNull());
  expect(store.set).not.toHaveBeenCalled();
  go("#/today");
  await screen.findByRole("heading", { level: 1 });
  go("#/browse/roles");
  await screen.findByRole("link", { name: "Analyst" });
  await waitFor(() => expect(headers()).toEqual(chosen));
});

test("the address wins over the personal choice, and the personal choice wins over the defaults", async () => {
  var store = mem(false);
  localStorage.setItem(colsKey("u1", "roles"), JSON.stringify(["title", "level"]));
  await mount("#/browse/roles", store);
  await waitFor(() => expect(headers().filter((h) => /Title|Level/.test(h)).length).toBe(2));
  expect(headers().some((h) => h.indexOf("Salary") === 0)).toBe(false);
  cleanup();
  await mount("#/browse/roles?cols=title,salary", store);
  expect(headers().some((h) => h.indexOf("Salary") === 0)).toBe(true);
  expect(headers().some((h) => h.indexOf("Level") === 0)).toBe(false);
});

test("Reset columns goes back to the defaults and forgets the personal choice", async () => {
  var store = mem(false);
  var defaults = null;
  await mount("#/browse/roles", store);
  defaults = headers();
  var target = defaults.some((h) => h.indexOf("Salary") === 0) ? "Level" : "Salary";
  await toggle(target);
  await waitFor(() => expect(localStorage.getItem(colsKey("u1", "roles"))).not.toBeNull());
  expect(headers()).not.toEqual(defaults);
  if (!screen.queryByText("Reset columns")) openColumns();
  fireEvent.click(await screen.findByText("Reset columns"));
  await waitFor(() => expect(headers()).toEqual(defaults));
  expect(localStorage.getItem(colsKey("u1", "roles"))).toBeNull();
});

test("a slow load of the saved choice does not overwrite a Reset made meanwhile", async () => {
  var store = mem(false);
  var release;
  var realGet = store.get;
  store.get = vi.fn((p) => (/state\/cols\//.test(p) ? new Promise((r) => { release = () => r({ path: p, exists: true, data: { cols: ["title"] } }); }) : realGet(p)));
  await mount("#/browse/roles", store);
  var defaults = headers();
  var target = defaults.some((h) => h.indexOf("Salary") === 0) ? "Level" : "Salary";
  await toggle(target);
  if (!screen.queryByText("Reset columns")) openColumns();
  fireEvent.click(await screen.findByText("Reset columns"));
  await waitFor(() => expect(headers()).toEqual(defaults));
  await act(async () => { release(); await Promise.resolve(); await Promise.resolve(); });
  expect(headers()).toEqual(defaults);
});

test("toggling a column back to the defaults keeps no personal list", async () => {
  var store = mem(true);
  await mount("#/browse/roles", store);
  var defaults = headers();
  var target = defaults.some((h) => h.indexOf("Salary") === 0) ? "Salary" : "Level";
  await toggle(target);
  await waitFor(() => expect(store.written["data/users/u1/state/cols/roles"]).toBeTruthy());
  fireEvent.click(Array.from(document.querySelectorAll("[role=menuitem]")).find((e) => e.textContent === target));
  await waitFor(() => expect(store.written["data/users/u1/state/cols/roles"]).toBeUndefined());
  expect(headers()).toEqual(defaults);
});

test("Reset columns says so when the saved choice could not be removed", async () => {
  var store = mem(true);
  await mount("#/browse/roles", store);
  var target = headers().some((h) => h.indexOf("Salary") === 0) ? "Level" : "Salary";
  await toggle(target);
  await waitFor(() => expect(store.written["data/users/u1/state/cols/roles"]).toBeTruthy());
  store.del = vi.fn(() => Promise.reject(new Error("denied")));
  if (!screen.queryByText("Reset columns")) openColumns();
  fireEvent.click(await screen.findByText("Reset columns"));
  expect(await screen.findByText(/Not saved: denied/)).toBeTruthy();
});
