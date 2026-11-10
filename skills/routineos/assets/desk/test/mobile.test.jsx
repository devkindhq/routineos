// Phone and narrow-screen behaviour in jsdom (spec docs/superpowers/specs/2026-11-09-desk-mobile-ux-design.md).
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { notifications } from "@mantine/notifications";
import { spotlight } from "@mantine/spotlight";
import App from "../app/App.jsx";
import { tourTarget } from "../app/Tour.jsx";
import { themeFor } from "../app/usePrefs.js";
import { createStore } from "../core/store.js";

var DEFINITION = { types: {
  roles: { label: "Role", plural: "Roles", fields: { title: { label: "Title", type: "text", summary: true } } },
  notes: { label: "Note", plural: "Notes", fields: {} },
}, producers: [] };

function staticStore(extra) {
  return createStore("static", { docs: Object.assign({
    "meta/definition": { data: DEFINITION },
    "meta/workspace": { data: { name: "Test workspace" } },
    "views/open": { data: { type: "roles", name: "Open roles" } },
  }, extra || {}) });
}

async function mount(hash, store) {
  window.history.replaceState(null, "", hash || "#/today");
  render(<App store={store || staticStore()} config={{ store: "static", workspace: "Test workspace" }} />);
  return screen.findByRole("heading", { level: 1 });
}

beforeEach(() => { try { localStorage.clear(); } catch (e) { /* storage blocked */ } notifications.clean(); });
afterEach(() => {
  cleanup();
  spotlight.close();
  window.history.replaceState(null, "", "#/today");
});

function inputVars(theme, props) {
  var c = theme.components && theme.components.Input;
  return c && c.vars ? (c.vars(theme, props || {}).wrapper || {}) : {};
}

test("touch sets 16px fields at every size and density; a mouse keeps Mantine's sizes", () => {
  var touch = themeFor({ density: "compact", motion: "system" }, { touch: true });
  expect(inputVars(touch, { size: "xs" })["--input-fz"]).toBe("16px");
  expect(inputVars(touch, {})["--input-fz"]).toBe("16px");
  var mouse = themeFor({ density: "comfortable", motion: "system" });
  expect(inputVars(mouse, { size: "xs" })["--input-fz"]).toBeUndefined();
});

test("touch makes buttons and icons 44px; a mouse keeps Mantine's sizes", () => {
  var touch = themeFor({ density: "compact", motion: "system" }, { touch: true });
  expect(touch.components.ActionIcon.vars(touch, { size: "xs" }).root["--ai-size"]).toBe("44px");
  expect(touch.components.Button.vars(touch, { size: "xs" }).root["--button-height"]).toBe("44px");
  var mouse = themeFor({ density: "comfortable", motion: "system" });
  expect(mouse.components.ActionIcon).toBeUndefined();
  expect(mouse.components.Button).toBeUndefined();
});

test("a sidebar parent navigates; its chevron shows and hides the saved views", async () => {
  await mount("#/today");
  var desk = screen.getByRole("navigation", { name: "Desk" });
  var view = await waitFor(() => { var l = desk.querySelector("a[href='#/browse/roles?view=open']"); expect(l).toBeTruthy(); return l; });
  expect(view.textContent).toContain("Open roles");
  var roles = Array.from(desk.querySelectorAll("a")).find((a) => a.getAttribute("href") === "#/browse/roles");
  fireEvent.click(roles);
  await waitFor(() => expect(window.location.hash).toBe("#/browse/roles"));
  var chevron = screen.getByRole("button", { name: "Hide Roles views" });
  expect(chevron.getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(chevron);
  expect(desk.querySelector("a[href='#/browse/roles?view=open']")).toBeNull();
  expect(window.location.hash).toBe("#/browse/roles");
  expect(screen.getByRole("button", { name: "Show Roles views" }).getAttribute("aria-expanded")).toBe("false");
  // A type with no saved views has no chevron.
  expect(screen.queryByRole("button", { name: /Notes views/ })).toBeNull();
});

test("Today shows a failed records read with Try again, not an all-good hero", async () => {
  var defn = Object.assign({}, DEFINITION, {
    producers: [{ id: "scout", label: "Scout", types: ["roles"], schedule: "0 6 * * *" }],
    desk: { health: { roles: { field: "title", red: ["a"], yellow: [], green: ["b"] } } },
  });
  var now = new Date().toISOString();
  var store = createStore("static", { docs: {
    "meta/definition": { data: defn },
    "meta/workspace": { data: { name: "Test workspace" } },
    "runs/scout-1": { data: { producer: "scout", startedAt: now, endedAt: now, status: "ok", counts: { new: 1 } } },
    "entities/roles--b": { data: { type: "roles", key: "b", status: "active", display: { title: "b" } } },
  } });
  var down = true, list = store.list.bind(store);
  store.list = (coll, q) => (coll === "entities" && down ? Promise.reject(new Error("read failed")) : list(coll, q));
  await mount("#/today", store);
  var alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("Could not read");
  expect(screen.queryByRole("region", { name: "Roles by health" })).toBeNull();
  expect(screen.queryByText("All good")).toBeNull();
  down = false;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("region", { name: "Roles by health" })).toBeTruthy();
});

function writable(store) {
  store.readOnly = false;
  store.viewer = () => Promise.resolve("u1");
  store.set = vi.fn(() => Promise.resolve());
  store.del = vi.fn(() => Promise.resolve());
  return store;
}

var RUN_NOW = new Date().toISOString();
var SCOUT = Object.assign({}, DEFINITION, { producers: [{ id: "scout", label: "Scout", types: ["roles"], schedule: "0 6 * * *" }] });
function runStore() {
  return writable(createStore("static", { docs: {
    "meta/definition": { data: SCOUT },
    "meta/workspace": { data: { name: "Test workspace" } },
    "runs/scout-1": { data: { producer: "scout", startedAt: RUN_NOW, endedAt: RUN_NOW, status: "ok", counts: { new: 1 } } },
    "inbox/m1": { data: { kind: "match", title: "A new match", createdAt: RUN_NOW } },
  } }));
}

test("Mark reviewed offers Undo, which deletes the same doc and brings the item back", async () => {
  var store = runStore();
  await mount("#/today", store);
  fireEvent.click(await screen.findByRole("button", { name: "Mark reviewed" }));
  await waitFor(() => expect(screen.queryByText("A new match")).toBeNull());
  var path = store.set.mock.calls[0][0];
  expect(path).toBe("data/users/u1/state/done/m1");
  fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
  await waitFor(() => expect(store.del).toHaveBeenCalledWith(path));
  expect(await screen.findByText("A new match")).toBeTruthy();
  expect(store.set).toHaveBeenCalledTimes(1);
});

test("Mark seen offers Undo, which deletes the same doc and brings the button back", async () => {
  var store = runStore();
  window.history.replaceState(null, "", "#/runs/scout-1");
  render(<App store={store} config={{ store: "static", workspace: "Test workspace" }} />);
  fireEvent.click(await screen.findByRole("button", { name: "Mark seen" }));
  expect(await screen.findByText("You marked this run seen.")).toBeTruthy();
  var path = store.set.mock.calls[0][0];
  expect(path).toBe("data/users/u1/state/ack/scout-1");
  fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
  await waitFor(() => expect(store.del).toHaveBeenCalledWith(path));
  expect(await screen.findByRole("button", { name: "Mark seen" })).toBeTruthy();
});

test("a saved export shows a toast naming the file; a refused one keeps its inline reason", async () => {
  var role = { data: { type: "roles", key: "a", status: "active", lastSeen: RUN_NOW, firstSeen: RUN_NOW, seenCount: 1, sources: ["scout"], display: { title: "Analyst" } } };
  var store = staticStore({ "entities/role--a": role });
  store.canDownload = () => Promise.resolve(true);
  store.saveFile = vi.fn(() => Promise.resolve());
  await mount("#/browse/roles", store);
  await screen.findByRole("link", { name: "Analyst" });
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  var dialog = await screen.findByRole("dialog", { name: "Export Roles" });
  fireEvent.click(await within(dialog).findByRole("button", { name: "Download" }));
  await waitFor(() => expect(store.saveFile).toHaveBeenCalledTimes(1));
  var name = store.saveFile.mock.calls[0][0];
  var notes = await waitFor(() => { var n = document.querySelectorAll(".mantine-Notification-root"); expect(n.length).toBe(1); return n; });
  expect(notes[0].textContent).toContain("Saved " + name + ".");

  store.saveFile = vi.fn(() => Promise.reject({ code: "declined", message: "no" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Download" }));
  expect(await within(dialog).findByText("Not saved.")).toBeTruthy();
  var texts = Array.from(document.querySelectorAll(".mantine-Notification-root")).map((n) => n.textContent);
  expect(texts.filter((t) => /Not saved/.test(t))).toEqual([]);
  expect(texts.filter((t) => /^Saved /.test(t)).length).toBeLessThanOrEqual(1);
});

test("tourTarget skips a match outside the viewport and falls back to the page title", () => {
  var doc = document.implementation.createHTMLDocument("t");
  doc.body.innerHTML = '<a href="#/today" id="off">Today</a><h1 id="page-title">Today</h1><a href="#/today" id="on">Today</a>';
  var rects = { off: { left: -300, right: -40, top: 10, bottom: 50, width: 260, height: 40 },
    "page-title": { left: 16, right: 300, top: 80, bottom: 120, width: 284, height: 40 },
    on: { left: 16, right: 200, top: 200, bottom: 240, width: 184, height: 40 } };
  doc.querySelectorAll("[id]").forEach((n) => { n.getBoundingClientRect = () => rects[n.id]; });
  expect(tourTarget({ target: 'a[href="#/today"]' }, doc).id).toBe("on");
  doc.getElementById("on").remove();
  expect(tourTarget({ target: 'a[href="#/today"]' }, doc).id).toBe("page-title");
});

test("the bell button carries aria-haspopup and aria-expanded; no plain wrapper does", async () => {
  await mount("#/today");
  var bell = document.querySelector("[data-tour=bell]");
  expect(bell.tagName).toBe("BUTTON");
  expect(bell.getAttribute("aria-haspopup")).toBe("dialog");
  expect(bell.getAttribute("aria-expanded")).toBe("false");
  var stray = Array.from(document.querySelectorAll("[aria-expanded]"))
    .filter((n) => n.tagName !== "BUTTON" && n.tagName !== "A" && n.tagName !== "INPUT" && !n.getAttribute("role"));
  expect(stray.map((n) => n.outerHTML.slice(0, 80))).toEqual([]);
  fireEvent.click(bell);
  await waitFor(() => expect(bell.getAttribute("aria-expanded")).toBe("true"));
});
