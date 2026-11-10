import { beforeEach, expect, test, vi } from "vitest";
import { writable } from "../core/actions.js";
import { colsKey, loadCols, resetCols, saveCols } from "../core/viewerstate.js";

function memoryStore(docs, extra) {
  var d = Object.assign({}, docs || {});
  return Object.assign({
    readOnly: false,
    get: vi.fn((p) => Promise.resolve(d[p] ? { path: p, exists: true, data: d[p] } : { path: p, exists: false, data: null })),
    set: vi.fn((p, v) => { d[p] = v; return Promise.resolve(); }),
    del: vi.fn((p) => { delete d[p]; return Promise.resolve(); }),
    docs: d,
  }, extra || {});
}
var PATH = "data/users/u1/state/cols/roles";

beforeEach(() => { try { localStorage.clear(); } catch (e) { /* blocked */ } });

test("writable allows the viewer's own cols and route documents and refuses another viewer's", () => {
  expect(writable(PATH, "u1")).toBe(true);
  expect(writable("data/users/u2/state/cols/roles", "u1")).toBe(false);
  expect(writable("data/users/u1/state/route/last", "u1")).toBe(true);
  expect(writable("data/users/u2/state/route/last", "u1")).toBe(false);
});

test("a viewer who may write keeps the columns in the database, and loads them back", async () => {
  var store = memoryStore();
  var ctx = { store: store, viewer: "u1", canWriteShared: true };
  await saveCols(ctx, "roles", ["title", "level"]);
  expect(store.set).toHaveBeenCalledWith(PATH, expect.objectContaining({ cols: ["title", "level"], by: "u1" }));
  expect(localStorage.getItem(colsKey("u1", "roles"))).toBeNull();
  expect(await loadCols(ctx, "roles")).toEqual(["title", "level"]);
});

test("a null platform answer still writes the database", async () => {
  var store = memoryStore();
  await saveCols({ store: store, viewer: "u1", canWriteShared: null }, "roles", ["title"]);
  expect(store.set).toHaveBeenCalledTimes(1);
});

test("a viewer refused shared writes keeps the columns on this device and writes nothing", async () => {
  var store = memoryStore();
  var ctx = { store: store, viewer: "u1", canWriteShared: false };
  await saveCols(ctx, "roles", ["title"]);
  expect(store.set).not.toHaveBeenCalled();
  expect(JSON.parse(localStorage.getItem(colsKey("u1", "roles")))).toEqual(["title"]);
  expect(await loadCols(ctx, "roles")).toEqual(["title"]);
});

test("a refused database write falls back to this device", async () => {
  var store = memoryStore({}, { set: vi.fn(() => Promise.reject(new Error("denied"))) });
  var ctx = { store: store, viewer: "u1", canWriteShared: null };
  await saveCols(ctx, "roles", ["level"]);
  expect(await loadCols(ctx, "roles")).toEqual(["level"]);
});

test("a read-only store keeps the columns on this device", async () => {
  var store = memoryStore({}, { readOnly: true });
  var ctx = { store: store, viewer: "u1", canWriteShared: null };
  await saveCols(ctx, "roles", ["title"]);
  expect(store.set).not.toHaveBeenCalled();
  expect(await loadCols(ctx, "roles")).toEqual(["title"]);
});

test("a device copy is newer than the database document (it exists only when a database write failed); another viewer's choice is not read", async () => {
  var store = memoryStore({ [PATH]: { cols: ["a"] } });
  expect(await loadCols({ store: store, viewer: "u1" }, "roles")).toEqual(["a"]);
  localStorage.setItem(colsKey("u1", "roles"), JSON.stringify(["b"]));
  expect(await loadCols({ store: store, viewer: "u1" }, "roles")).toEqual(["b"]);
  expect(await loadCols({ store: store, viewer: "u2" }, "roles")).toBeNull();
});

test("a database write that lands removes an older device copy, so the next load reads the new choice", async () => {
  var store = memoryStore({ [PATH]: { cols: ["a"] } }, { set: vi.fn(() => Promise.reject(new Error("denied"))) });
  var ctx = { store: store, viewer: "u1", canWriteShared: null };
  await saveCols(ctx, "roles", ["b"]);
  expect(await loadCols(ctx, "roles")).toEqual(["b"]);
  store.set = vi.fn((p, v) => { store.docs[p] = v; return Promise.resolve(); });
  await saveCols(ctx, "roles", ["c"]);
  expect(localStorage.getItem(colsKey("u1", "roles"))).toBeNull();
  expect(await loadCols(ctx, "roles")).toEqual(["c"]);
});

test("resetCols reports a failed database remove instead of swallowing it, and still clears the device copy", async () => {
  var store = memoryStore({ [PATH]: { cols: ["a"] } }, { del: vi.fn(() => Promise.reject(new Error("denied"))) });
  localStorage.setItem(colsKey("u1", "roles"), JSON.stringify(["b"]));
  await expect(resetCols({ store: store, viewer: "u1", canWriteShared: true }, "roles")).rejects.toThrow(/denied/);
  expect(localStorage.getItem(colsKey("u1", "roles"))).toBeNull();
});

test("blocked storage and bad values read as no choice", async () => {
  var store = memoryStore();
  localStorage.setItem(colsKey("u1", "roles"), "not json");
  expect(await loadCols({ store: store, viewer: "u1" }, "roles")).toBeNull();
  var spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  expect(await loadCols({ store: store, viewer: "u1" }, "roles")).toBeNull();
  spy.mockRestore();
  var set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  await expect(saveCols({ store: store, viewer: "u1", canWriteShared: false }, "roles", ["title"])).resolves.toBeUndefined();
  set.mockRestore();
});

test("reset removes both the database document and the device copy", async () => {
  var store = memoryStore({ [PATH]: { cols: ["a"] } });
  localStorage.setItem(colsKey("u1", "roles"), JSON.stringify(["b"]));
  var ctx = { store: store, viewer: "u1", canWriteShared: true };
  await resetCols(ctx, "roles");
  expect(store.del).toHaveBeenCalledWith(PATH);
  expect(localStorage.getItem(colsKey("u1", "roles"))).toBeNull();
  expect(await loadCols(ctx, "roles")).toBeNull();
});

test("without a viewer id nothing is read or written in the database", async () => {
  var store = memoryStore();
  await saveCols({ store: store, viewer: null, canWriteShared: true }, "roles", ["title"]);
  expect(store.set).not.toHaveBeenCalled();
});
