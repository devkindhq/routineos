import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "../app/App.jsx";
import { go, inFrame, replaceAddress, replaceParams, useRestoreRoute, useRoute } from "../app/useRoute.js";
import { toFrameHash } from "../core/router.js";
import { createStore } from "../core/store.js";
import { loadRoute, routeKey, saveRoute } from "../core/viewerstate.js";

// Plain tab: the Desk routes by the address hash. These pin what already works so it cannot regress.
function fire() { act(() => { window.dispatchEvent(new HashChangeEvent("hashchange")); }); }
function at(hash) { window.history.replaceState(null, "", hash || "/"); }
// The last route is for a Desk shown in a frame (a published artifact); a plain tab never saves or restores one.
var realTop = Object.getOwnPropertyDescriptor(window, "top");
function asFrame() { Object.defineProperty(window, "top", { configurable: true, value: {} }); }
function asTab() { if (realTop) Object.defineProperty(window, "top", realTop); else delete window.top; }
beforeEach(() => { try { localStorage.clear(); } catch (e) { /* blocked */ } at("#/today"); asFrame(); });
afterEach(() => { cleanup(); vi.useRealTimers(); asTab(); at("#/today"); });

test("go changes the address hash and the route follows", () => {
  asTab();
  const { result } = renderHook(() => useRoute());
  act(() => { go("#/browse/roles"); });
  fire();
  expect(window.location.hash).toBe("#/browse/roles");
  expect(result.current.page).toBe("browse");
  expect(result.current.params.type).toBe("roles");
});

test("replaceParams changes the address without adding a history entry", () => {
  asTab();
  at("#/browse/roles");
  const { result } = renderHook(() => useRoute());
  var before = window.history.length;
  act(() => { replaceParams({ status: "dropped", q: "ana" }); });
  expect(window.location.hash).toMatch(/^#\/browse\/roles\?/);
  expect(result.current.params.query).toEqual({ status: "dropped", q: "ana" });
  expect(window.history.length).toBe(before);
  act(() => { replaceParams({ status: null }); });
  expect(result.current.params.query).toEqual({ q: "ana" });
  expect(window.history.length).toBe(before);
});

test("a direct load of a list, a record and a filtered list reads the route from the address", () => {
  [["#/browse/roles", "browse", { type: "roles" }], ["#/entity/roles/a", "entity", { type: "roles", key: "a" }],
    ["#/browse/roles?status=dropped", "browse", { type: "roles", query: { status: "dropped" } }]].forEach(([hash, page, params]) => {
    at(hash);
    const { result, unmount } = renderHook(() => useRoute());
    expect(result.current.page).toBe(page);
    expect(result.current.params).toEqual(params);
    unmount();
  });
});

test("back and forward re-render the route", async () => {
  const { result } = renderHook(() => useRoute());
  act(() => { window.location.hash = "#/browse/roles"; });
  await waitFor(() => expect(result.current.page).toBe("browse"));
  act(() => { window.location.hash = "#/entity/roles/a"; });
  await waitFor(() => expect(result.current.page).toBe("entity"));
  act(() => { window.history.back(); });
  await waitFor(() => expect(result.current.page).toBe("browse"));
  act(() => { window.history.forward(); });
  await waitFor(() => expect(result.current.page).toBe("entity"));
});

// The last route, for a viewer whose host does not show the Desk's own address (a published artifact in a frame).
function ctxOf(over) {
  var docs = {};
  var store = { readOnly: false, docs: docs,
    get: vi.fn((p) => Promise.resolve(docs[p] ? { path: p, exists: true, data: docs[p] } : { path: p, exists: false, data: null })),
    set: vi.fn((p, d) => { docs[p] = d; return Promise.resolve(); }),
    del: vi.fn((p) => { delete docs[p]; return Promise.resolve(); }) };
  return Object.assign({ store: store, viewer: "u1", canWriteShared: true }, over || {});
}

test("the last route is saved once the route has been still for 1.5 seconds", async () => {
  vi.useFakeTimers();
  var ctx = ctxOf();
  const { rerender } = renderHook(({ hash }) => useRestoreRoute(ctx, hash), { initialProps: { hash: "#/browse/roles" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(ctx.store.set).not.toHaveBeenCalled();
  rerender({ hash: "#/entity/roles/a" });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(ctx.store.set).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  expect(ctx.store.set).toHaveBeenCalledTimes(1);
  expect(ctx.store.set.mock.calls[0][0]).toBe("data/users/u1/state/route/last");
  expect(ctx.store.set.mock.calls[0][1]).toMatchObject({ hash: "#/entity/roles/a", by: "u1" });
});

test("a viewer refused shared writes keeps the last route on this device, with no database write", async () => {
  vi.useFakeTimers();
  var ctx = ctxOf({ canWriteShared: false });
  renderHook(() => useRestoreRoute(ctx, "#/browse/roles"));
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(ctx.store.set).not.toHaveBeenCalled();
  expect(JSON.parse(localStorage.getItem(routeKey("u1")))).toBe("#/browse/roles");
});

test("opening with no address restores the last route; opening with an address does not", async () => {
  var ctx = ctxOf();
  ctx.store.docs["entities/roles--a"] = { type: "roles" };
  await saveRoute(ctx, "#/entity/roles/a");
  at("/");
  renderHook(() => useRestoreRoute(ctx, window.location.hash));
  await waitFor(() => expect(window.location.hash).toBe("#/entity/roles/a"));
  cleanup();
  at("#/browse/roles");
  renderHook(() => useRestoreRoute(ctx, window.location.hash));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(window.location.hash).toBe("#/browse/roles");
});

test("a restored route adds no history entry", async () => {
  var ctx = ctxOf();
  await saveRoute(ctx, "#/browse/roles");
  at("/");
  var before = window.history.length;
  renderHook(() => useRestoreRoute(ctx, window.location.hash));
  await waitFor(() => expect(window.location.hash).toBe("#/browse/roles"));
  expect(window.history.length).toBe(before);
});

test("a saved value that is not a #/ address, or is too long, is ignored", async () => {
  for (var bad of ["https://example.com/x", "javascript:alert(1)", "#browse", "#/" + "a".repeat(500), 5, null]) {
    var ctx = ctxOf();
    ctx.store.docs["data/users/u1/state/route/last"] = { hash: bad };
    at("/");
    const { unmount } = renderHook(() => useRestoreRoute(ctx, window.location.hash));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(window.location.hash).toBe("");
    unmount();
  }
  expect(await loadRoute(ctxOf())).toBeNull();
});

test("the Desk opens on the last route when the address is empty", async () => {
  var DEF = { types: { roles: { plural: "Roles", order: ["title"], fields: { title: { label: "Title", type: "text", summary: true } } } },
    producers: [{ id: "scout", label: "Scout", types: ["roles"] }] };
  var docs = {
    "meta/definition": { data: DEF }, "meta/workspace": { data: { name: "Test workspace" } },
    "entities/roles--a": { data: { type: "roles", key: "a", status: "active", lastSeen: "2026-11-03T00:00:00Z", firstSeen: "2026-11-01T00:00:00Z", sources: ["scout"], display: { title: "Analyst" } } },
    "data/users/u1/state/route/last": { data: { hash: "#/browse/roles" } },
  };
  var store = createStore("static", { docs: docs });
  store.readOnly = false;
  store.viewer = () => Promise.resolve("u1");
  at("/");
  render(<App store={store} config={{ store: "static", workspace: "Test workspace" }} />);
  expect(await screen.findByRole("link", { name: "Analyst" })).toBeTruthy();
  expect(window.location.hash).toBe("#/browse/roles");
});

test("inFrame is true when this window is not the top window", () => {
  asTab();
  expect(inFrame()).toBe(false);
  var real = Object.getOwnPropertyDescriptor(window, "top");
  Object.defineProperty(window, "top", { configurable: true, value: {} });
  expect(inFrame()).toBe(true);
  if (real) Object.defineProperty(window, "top", real); else delete window.top;
});

test("a plain tab neither restores nor saves the last route", async () => {
  asTab();
  vi.useFakeTimers();
  var ctx = ctxOf();
  await saveRoute(ctx, "#/entity/roles/a");
  ctx.store.set.mockClear();
  at("/");
  renderHook(() => useRestoreRoute(ctx, window.location.hash));
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(window.location.hash).toBe("");
  renderHook(() => useRestoreRoute(ctx, "#/browse/roles"));
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(ctx.store.set).not.toHaveBeenCalled();
});

test("a saved record that no longer exists falls back to the default instead of a not-found page", async () => {
  var ctx = ctxOf();
  ctx.store.docs["entities/roles--a"] = { type: "roles" };
  await saveRoute(ctx, "#/entity/roles/gone");
  at("/");
  renderHook(() => useRestoreRoute(ctx, window.location.hash));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  expect(window.location.hash).toBe("");
  cleanup();
  await saveRoute(ctx, "#/entity/roles/a");
  renderHook(() => useRestoreRoute(ctx, window.location.hash));
  await waitFor(() => expect(window.location.hash).toBe("#/entity/roles/a"));
});

test("a route too long to save clears the stale saved one", async () => {
  vi.useFakeTimers();
  var ctx = ctxOf();
  await saveRoute(ctx, "#/browse/roles");
  renderHook(() => useRestoreRoute(ctx, "#/browse/roles?q=" + "a".repeat(600)));
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(await loadRoute(ctx)).toBeNull();
});

test("a route equal to the one already saved is not written again", async () => {
  vi.useFakeTimers();
  var ctx = ctxOf();
  await saveRoute(ctx, "#/browse/roles");
  ctx.store.set.mockClear();
  at("#/browse/roles");
  const { rerender } = renderHook(({ hash }) => useRestoreRoute(ctx, hash), { initialProps: { hash: "#/browse/roles" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(ctx.store.set).not.toHaveBeenCalled();
  rerender({ hash: "#/browse/roles?q=x" });
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(ctx.store.set).toHaveBeenCalledTimes(1);
  rerender({ hash: "#/browse/roles" });
  rerender({ hash: "#/browse/roles?q=x" });
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(ctx.store.set).toHaveBeenCalledTimes(1);
});

test("in a frame go() sets the slash-free address, and the route follows it", () => {
  const { result } = renderHook(() => useRoute());
  act(() => { go("#/entity/roles/a"); });
  fire();
  expect(window.location.hash).toBe("#d--entity--roles--a");
  expect(result.current.page).toBe("entity");
  expect(result.current.params).toMatchObject({ type: "roles", key: "a" });
});

test("in a plain tab go() keeps the #/ address", () => {
  asTab();
  act(() => { go("#/entity/roles/a"); });
  expect(window.location.hash).toBe("#/entity/roles/a");
});

test("an explicit slash-free address wins over the saved last route, and a #/ one still works", async () => {
  var ctx = ctxOf();
  ctx.store.docs["entities/roles--a"] = { type: "roles" };
  await saveRoute(ctx, "#/browse/roles");
  at("#d--entity--roles--a");
  renderHook(() => useRestoreRoute(ctx, window.location.hash));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  expect(window.location.hash).toBe("#d--entity--roles--a");
  cleanup();
  at("#/entity/roles/a");
  const { result } = renderHook(() => useRoute());
  expect(result.current.page).toBe("entity");
});

test("the last route is saved in the #/ form even when the address is the slash-free one", async () => {
  vi.useFakeTimers();
  var ctx = ctxOf();
  at("#d--entity--roles--a");
  renderHook(() => useRestoreRoute(ctx, window.location.hash));
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  vi.useRealTimers();
  expect(await loadRoute(ctx)).toBe("#/entity/roles/a");
});

test("replaceParams on a slash-free address keeps the route and adds the query", () => {
  at("#d--browse--roles");
  const { result } = renderHook(() => useRoute());
  act(() => { replaceParams({ q: "ana" }); });
  expect(result.current.page).toBe("browse");
  expect(result.current.params.type).toBe("roles");
  expect(result.current.params.query).toEqual({ q: "ana" });
});

test("in a frame replaceAddress and an old-address redirect write the slash-free form; in a tab they write #/", () => {
  const { result } = renderHook(() => useRoute());
  act(() => { replaceAddress("#/browse/roles?q=a"); });
  expect(window.location.hash).toBe("#d--browse--roles----q-3da");
  expect(result.current.page).toBe("browse");
  at("#/views");
  renderHook(() => useRoute());
  expect(window.location.hash).toBe(toFrameHash("#/settings/views"));
  asTab();
  act(() => { replaceAddress("#/entity/roles/a"); });
  expect(window.location.hash).toBe("#/entity/roles/a");
});

test("the p route draws a spec page title and a missing page says not found", async () => {
  asTab();
  const DEF = { types: { metric: { plural: "Metrics", fields: { week: { type: "date" }, value: { type: "number" } } } },
    producers: [{ id: "m", label: "M", types: ["metric"] }],
    desk: { pages: [{ id: "overview", title: "Weekly overview", blocks: [] }] } };
  const docs = { "meta/definition": { data: DEF }, "meta/workspace": { data: { name: "Test workspace" } } };
  const config = { store: "static", workspace: "Test workspace" };
  at("#/p/overview");
  const view = render(<App store={createStore("static", { docs: docs })} config={config} />);
  expect(await screen.findByRole("heading", { level: 1, name: "Weekly overview" })).toBeTruthy();
  view.unmount();
  at("#/p/missing");
  render(<App store={createStore("static", { docs: docs })} config={config} />);
  expect(await screen.findByRole("heading", { level: 1, name: "Not found" })).toBeTruthy();
});
