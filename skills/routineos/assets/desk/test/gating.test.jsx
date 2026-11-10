import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "../app/App.jsx";
import { createStore } from "../core/store.js";

var REASON = "Saving needs Contributor access or above";
var DEFINITION = {
  types: { roles: { label: "Role", plural: "Roles", fields: { title: { label: "Title", type: "text", summary: true } } } },
  producers: [{ id: "scout", label: "Scout", types: ["roles"], schedule: "0 6 * * *" }],
};
var NOW = new Date().toISOString();
var DOCS = {
  "meta/definition": { data: DEFINITION },
  "meta/workspace": { data: { name: "Test workspace" } },
  "entities/roles--a": { data: { type: "roles", key: "a", status: "active", lastSeen: "2026-11-03T00:00:00Z", firstSeen: "2026-11-01T00:00:00Z",
    sources: ["scout"], display: { title: "Data Analyst" }, sightings: [] } },
  "views/senior": { data: { madeBy: "agent", producer: "scout", state: "proposed", name: "Senior roles", type: "roles", createdAt: "2026-11-05T00:00:00Z" } },
  "runs/scout-1": { data: { producer: "scout", startedAt: NOW, endedAt: NOW, status: "ok", counts: { new: 1 } } },
  "inbox/m1": { data: { kind: "match", title: "A new match", createdAt: NOW } },
  "pending/g1": { data: { producer: "scout", title: "Send the weekly note", createdAt: "2026-11-05T00:00:00Z", status: "pending" } },
};

// A signed-in store whose platform answer to "may this viewer write shared data" is the given value.
function storeWith(answer) {
  var store = createStore("static", { docs: DOCS });
  store.readOnly = false;
  store.viewer = () => Promise.resolve("u1");
  store.set = vi.fn(() => Promise.resolve());
  store.del = vi.fn(() => Promise.resolve());
  if (answer !== undefined) store.canWriteShared = () => Promise.resolve(answer);
  return store;
}

async function mount(hash, store, heading) {
  window.history.replaceState(null, "", hash);
  render(<App store={store} config={{ store: "static", workspace: "Test workspace" }} />);
  return screen.findByRole("heading", Object.assign({ level: 1 }, heading || {}));
}

function gated(el) { return el.closest("fieldset[disabled]"); }

beforeEach(() => { try { localStorage.clear(); } catch (e) { /* blocked */ } });
afterEach(() => { cleanup(); window.history.replaceState(null, "", "#/today"); });

test("Save view is disabled with the reason when the platform says the viewer cannot write", async () => {
  await mount("#/browse/roles", storeWith(false));
  var btn = await screen.findByRole("button", { name: "Save view" });
  expect(gated(btn)).toBeTruthy();
  expect(gated(btn).getAttribute("title")).toBe(REASON);
  expect(btn.matches(":disabled")).toBe(true);
});

test.each([[true], [null]])("Save view stays enabled when the platform answer is %s", async (answer) => {
  await mount("#/browse/roles", storeWith(answer));
  var btn = await screen.findByRole("button", { name: "Save view" });
  expect(gated(btn)).toBeNull();
  expect(btn.matches(":disabled")).toBe(false);
});

test("Save view is still absent on a read-only store", async () => {
  await mount("#/browse/roles", createStore("static", { docs: DOCS }));
  await screen.findByRole("link", { name: "Data Analyst" });
  expect(screen.queryByRole("button", { name: "Save view" })).toBeNull();
});

test("Approve and Decline are disabled with the reason when writes are refused by access", async () => {
  await mount("#/approvals", storeWith(false), { name: "Approvals" });
  await screen.findByText("Send the weekly note");
  var buttons = [].concat(screen.getAllByRole("button", { name: "Approve" }), screen.getAllByRole("button", { name: "Decline" }));
  expect(buttons.length).toBeGreaterThan(1);
  buttons.forEach((b) => {
    expect(b.matches(":disabled")).toBe(true);
    expect(gated(b).getAttribute("title")).toBe(REASON);
  });
});

test("Approve is enabled when the platform answer is null", async () => {
  await mount("#/approvals", storeWith(null), { name: "Approvals" });
  await screen.findByText("Send the weekly note");
  screen.getAllByRole("button", { name: "Approve" }).forEach((b) => expect(b.matches(":disabled")).toBe(false));
});

test("the Decision control on a record is disabled with the reason", async () => {
  await mount("#/entity/roles/a", storeWith(false));
  var radio = await screen.findByRole("radio", { name: "Keep" });
  expect(gated(radio)).toBeTruthy();
  expect(gated(radio).getAttribute("title")).toBe(REASON);
});

test("the Decision control is enabled when the platform answer is true", async () => {
  await mount("#/entity/roles/a", storeWith(true));
  var radio = await screen.findByRole("radio", { name: "Keep" });
  expect(gated(radio)).toBeNull();
});

test("Today: Mark reviewed and Remind me tomorrow are disabled with the reason, enabled for null", async () => {
  await mount("#/today", storeWith(false));
  var mark = await screen.findByRole("button", { name: "Mark reviewed" });
  expect(mark.matches(":disabled")).toBe(true);
  expect(gated(mark).getAttribute("title")).toBe(REASON);
  expect(screen.getByRole("button", { name: "Remind me tomorrow" }).matches(":disabled")).toBe(true);
  cleanup();
  await mount("#/today", storeWith(null));
  expect((await screen.findByRole("button", { name: "Mark reviewed" })).matches(":disabled")).toBe(false);
});

test("Runs: Run now is disabled with the reason, enabled for true", async () => {
  await mount("#/runs", storeWith(false), { name: "Runs" });
  var run = await screen.findByRole("button", { name: "Run now: Scout" });
  expect(run.matches(":disabled")).toBe(true);
  expect(gated(run).getAttribute("title")).toBe(REASON);
  cleanup();
  await mount("#/runs", storeWith(true), { name: "Runs" });
  expect((await screen.findByRole("button", { name: "Run now: Scout" })).matches(":disabled")).toBe(false);
});

test("a viewer refused shared writes sees the comment box disabled with the reason, and no write happens", async () => {
  var ts = Date.now().toString(36);
  var docs = {
    ["people/u1/comments/roles--a--" + ts]: { data: { at: new Date().toISOString(), text: "My note" } },
    ["comments/roles--a--u1--" + ts]: { data: { entity: "roles--a", by: "u1", at: new Date().toISOString(), text: "Old flat note" } },
  };
  var store = createStore("static", { docs: Object.assign({}, DOCS, docs) });
  store.readOnly = false;
  store.viewer = () => Promise.resolve("u1");
  store.set = vi.fn(() => Promise.resolve());
  store.canWriteShared = () => Promise.resolve(false);
  await mount("#/entity/roles/a", store);
  var box = await screen.findByRole("textbox", { name: "Comment" });
  await waitFor(() => expect(box.matches(":disabled")).toBe(true));
  expect(gated(box).getAttribute("title")).toBe(REASON);
  expect(screen.getByText(/Old flat note/)).toBeTruthy();
  expect(store.set).not.toHaveBeenCalled();
});

test("a Contributor comments as themselves and a comment also writes the people marker doc", async () => {
  var ts = Date.now().toString(36);
  var docs = {
    ["people/u1/comments/roles--a--" + ts]: { data: { at: new Date().toISOString(), text: "My note" } },
    ["people/u2/comments/roles--a--" + ts]: { data: { by: "u1", at: new Date().toISOString(), text: "Their note, body claims u1" } },
  };
  var store = createStore("static", { docs: Object.assign({}, DOCS, docs) });
  store.readOnly = false;
  store.viewer = () => Promise.resolve("u1");
  store.set = vi.fn(() => Promise.resolve());
  store.canWriteShared = () => Promise.resolve(true);
  await mount("#/entity/roles/a", store);
  var box = await screen.findByRole("textbox", { name: "Comment" });
  expect(box.disabled).toBe(false);
  expect(screen.getAllByRole("button", { name: "Edit comment" }).length).toBe(1);
  fireEvent.change(box, { target: { value: "Hello" } });
  fireEvent.click(screen.getByRole("button", { name: "Post comment" }));
  await waitFor(() => expect(store.set).toHaveBeenCalledTimes(2));
  var paths = store.set.mock.calls.map((c) => c[0]);
  expect(paths.filter((p) => /^people\/u1\/comments\/roles--a--[a-z0-9]+$/.test(p)).length).toBe(1);
  expect(paths).toContain("people/u1");
});

test("Star and the record notes are disabled with the reason when access refuses shared writes", async () => {
  await mount("#/entity/roles/a", storeWith(false));
  var star = await screen.findByRole("button", { name: "Star Data Analyst" });
  expect(star.matches(":disabled")).toBe(true);
  expect(gated(star).getAttribute("title")).toBe(REASON);
});

test("Browse row Star is disabled with the reason, not hidden, when access refuses shared writes", async () => {
  await mount("#/browse/roles", storeWith(false));
  var star = await screen.findByRole("button", { name: /^Star / });
  expect(star.matches(":disabled")).toBe(true);
  expect(gated(star).getAttribute("title")).toBe(REASON);
  cleanup();
  await mount("#/browse/roles", storeWith(true));
  expect((await screen.findByRole("button", { name: /^Star / })).matches(":disabled")).toBe(false);
});
