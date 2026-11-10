import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "../app/App.jsx";
import { createStore } from "../core/store.js";

var REASON = "Saving needs Contributor access or above";
var DOCS = {
  "meta/definition": { data: { types: { roles: { label: "Role", plural: "Roles", fields: { title: { label: "Title", type: "text", summary: true } } } },
    producers: [{ id: "scout", label: "Scout", types: ["roles"] }] } },
  "meta/workspace": { data: { name: "Test workspace" } },
  "entities/roles--a": { data: { type: "roles", key: "a", status: "active", lastSeen: "2026-11-03T00:00:00Z", firstSeen: "2026-11-01T00:00:00Z",
    sources: ["scout"], display: { title: "Data Analyst" }, sightings: [] } },
};

function storeWith(answer, readOnly) {
  var store = createStore("static", { docs: DOCS });
  store.readOnly = readOnly === true;
  store.viewer = () => Promise.resolve("u1");
  store.set = vi.fn(() => Promise.resolve());
  store.canWriteShared = () => Promise.resolve(answer);
  store.composer = () => Promise.resolve(globalThis.claude.use("comments"));
  return store;
}

async function mount(store) {
  window.history.replaceState(null, "", "#/entity/roles/a");
  render(<App store={store} config={{ store: "static", workspace: "Test workspace" }} />);
  return screen.findByRole("heading", { level: 1, name: "Data Analyst" });
}

var use;
beforeEach(() => { try { localStorage.clear(); } catch (e) { /* blocked */ } use = vi.fn(); globalThis.claude = { use }; });
afterEach(() => { cleanup(); delete globalThis.claude; window.history.replaceState(null, "", "#/today"); });

test("a viewer who cannot write the db gets a Comment button that opens the platform composer once", async () => {
  var openComposer = vi.fn(() => Promise.resolve());
  use.mockImplementation((name) => Promise.resolve(name === "comments" ? { openComposer } : null));
  await mount(storeWith(false));
  var btn = await screen.findByRole("button", { name: "Comment" });
  expect(screen.queryByRole("textbox", { name: "Comment" })).toBeNull();
  fireEvent.click(btn);
  await waitFor(() => expect(openComposer).toHaveBeenCalledTimes(1));
  var arg = openComposer.mock.calls[0][0];
  expect(arg.element instanceof HTMLElement).toBe(true);
});

test("a viewer who can write the db keeps the db textarea and never asks for the comments namespace", async () => {
  use.mockImplementation(() => Promise.resolve(null));
  await mount(storeWith(true));
  expect(await screen.findByRole("textbox", { name: "Comment" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Comment" })).toBeNull();
  expect(use.mock.calls.filter((c) => c[0] === "comments")).toHaveLength(0);
});

test("without a comments namespace the Commenter keeps the disabled box and the reason", async () => {
  use.mockImplementation(() => Promise.resolve(null));
  await mount(storeWith(false));
  var box = await screen.findByRole("textbox", { name: "Comment" });
  await waitFor(() => expect(box.matches(":disabled")).toBe(true));
  expect(box.closest("fieldset[disabled]").getAttribute("title")).toBe(REASON);
  expect(screen.queryByRole("button", { name: "Comment" })).toBeNull();
});

test("a read-only (static) store never offers the platform composer", async () => {
  use.mockImplementation((name) => Promise.resolve(name === "comments" ? { openComposer: vi.fn() } : null));
  await mount(storeWith(false, true));
  await screen.findByText("No comments yet.");
  expect(screen.queryByRole("button", { name: "Comment" })).toBeNull();
  expect(use.mock.calls.filter((c) => c[0] === "comments")).toHaveLength(0);
});
