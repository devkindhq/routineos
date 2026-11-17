// The upsert verb (issue #32): a component may write the entity docs of a type the compiled
// definition marks shared — the one producer-shaped path a person (or an approved code page)
// writes directly. Pure functions; the store is faked like the other verb tests.
import { expect, test } from "vitest";
import { makeActions, upsertStampConflict_ } from "../core/ext.js";

var SHARED = { keyword: true };
var PLAIN = { company: true };

function ctxWith(store, viewer, definition) {
  return { store: store, viewer: viewer, canWriteShared: true, definition: definition };
}

function fakeStore(docs) {
  var saved = {};
  var store = {
    readOnly: false,
    get: function (p) { return Promise.resolve(p in docs ? { exists: true, data: docs[p] } : { exists: false }); },
    set: function (p, d) { saved[p] = d; return Promise.resolve({}); },
    list: function () { return Promise.resolve([]); },
  };
  store.saved = saved;
  return store;
}

function definitionWith(shared) {
  return { types: { keyword: { shared: true }, company: {} } };
}

test("upsert writes a new shared entity doc with fields, display and stamps", async () => {
  var store = fakeStore({});
  var actions = makeActions(ctxWith(store, "u1", definitionWith()), ["upsert"], null);
  await actions.upsert("keyword", "seo", { term: "shopify seo", score: 3 });
  var doc = store.saved["entities/keyword--seo"];
  expect(doc.type).toBe("keyword");
  expect(doc.key).toBe("seo");
  expect(doc.fields).toEqual({ term: "shopify seo", score: 3 });
  expect(doc.display).toEqual({ term: "shopify seo", score: 3 });
  expect(doc.updatedBy).toBe("u1");
  expect(typeof doc.updatedAt).toBe("string");
  expect(doc.firstSeen).toBe(doc.updatedAt);
});

test("upsert merges into an existing doc without touching producer machinery", async () => {
  var store = fakeStore({ "entities/keyword--seo": {
    type: "keyword", key: "seo", bySource: { "p1": { term: "x" } }, status: "active",
    sightings: [{ run: "r1" }], display: { term: "x", note: "from run" }, fields: { term: "x" },
  } });
  var actions = makeActions(ctxWith(store, "u2", definitionWith()), ["upsert"], null);
  await actions.upsert("keyword", "seo", { term: "shopify seo", score: 3 });
  var doc = store.saved["entities/keyword--seo"];
  expect(doc.fields).toEqual({ term: "shopify seo", score: 3 });
  expect(doc.display).toEqual({ term: "shopify seo", score: 3, note: "from run" });
  expect(doc.bySource).toEqual({ "p1": { term: "x" } });
  expect(doc.sightings).toEqual([{ run: "r1" }]);
  expect(doc.status).toBe("active");
  expect(doc.updatedBy).toBe("u2");
  expect(doc.firstSeen).toBeUndefined();
});

test("upsert refuses a type the definition does not mark shared", async () => {
  var store = fakeStore({});
  var actions = makeActions(ctxWith(store, "u1", definitionWith()), ["upsert"], null);
  await expect(actions.upsert("company", "acme", { name: "Acme" })).rejects.toThrow(/not a shared/);
  expect(store.saved["entities/company--acme"]).toBeUndefined();
});

test("upsert refuses an unknown type, a bad id and non-object fields", async () => {
  var actions = makeActions(ctxWith(fakeStore({}), "u1", definitionWith()), ["upsert"], null);
  await expect(actions.upsert("ghost", "x", { a: 1 })).rejects.toThrow(/not a shared/);
  await expect(actions.upsert("keyword", "Not A Slug", { a: 1 })).rejects.toThrow(/record id/);
  await expect(actions.upsert("keyword", "x".repeat(121), { a: 1 })).rejects.toThrow(/record id/);
  await expect(actions.upsert("keyword", "ok", "nope")).rejects.toThrow(/fields|plain/i);
  await expect(actions.upsert("keyword", "ok", { nested: { deep: 1 } })).rejects.toThrow(/plain/);
});

test("upsert refuses a visit that cannot write", async () => {
  var store = fakeStore({});
  var actions = makeActions(ctxWith(store, null, definitionWith()), ["upsert"], null);
  await expect(actions.upsert("keyword", "seo", { term: "x" })).rejects.toThrow();
  expect(store.saved).toEqual({});
});

test("upsert cuts long string values and keeps only plain types", async () => {
  var store = fakeStore({});
  var actions = makeActions(ctxWith(store, "u1", definitionWith()), ["upsert"], null);
  var long = "x".repeat(2500);
  await actions.upsert("keyword", "seo", { term: long, n: 2, b: false });
  var doc = store.saved["entities/keyword--seo"];
  expect(doc.fields.term.length).toBe(2000);
  expect(doc.fields.n).toBe(2);
  expect(doc.fields.b).toBe(false);
});

test("upsert is not on the actions object when the manifest does not declare it", () => {
  var actions = makeActions(ctxWith(fakeStore({}), "u1", definitionWith()), ["decide"], null);
  expect(actions.upsert).toBeUndefined();
});

test("upsert honours scope.types like every other verb", async () => {
  var store = fakeStore({});
  var actions = makeActions(ctxWith(store, "u1", definitionWith()), ["upsert"], { types: ["company"] });
  await expect(actions.upsert("keyword", "seo", { term: "x" })).rejects.toThrow(/kind of record/);
  expect(store.saved["entities/keyword--seo"]).toBeUndefined();
  // a scope naming the shared type, or no types list (a page), goes through
  var okSection = makeActions(ctxWith(store, "u1", definitionWith()), ["upsert"], { types: ["keyword"] });
  await okSection.upsert("keyword", "seo", { term: "x" });
  var page = makeActions(ctxWith(store, "u1", definitionWith()), ["upsert"], {});
  await page.upsert("keyword", "seo2", { term: "y" });
  expect(store.saved["entities/keyword--seo"].fields.term).toBe("x");
  expect(store.saved["entities/keyword--seo2"].fields.term).toBe("y");
});

test("upsert warns visibly when a concurrent write lands between the read and the write", async () => {
  var warnings = [];
  var orig = globalThis.console.warn;
  globalThis.console.warn = function (m) { warnings.push(m); };
  try {
    var saved = {};
    var store = {
      readOnly: false,
      get: function (p) {
        // the doc as the first read sees it, but the re-read after the save shows another writer
        return Promise.resolve({ exists: true, data: { type: "keyword", key: "seo", fields: {},
          display: {}, updatedBy: "someone-else", updatedAt: "2026-01-01T00:00:00Z" } });
      },
      set: function (p, d) { saved[p] = d; return Promise.resolve({}); },
      list: function () { return Promise.resolve([]); },
    };
    var actions = makeActions(ctxWith(store, "u1", definitionWith()), ["upsert"], null);
    await actions.upsert("keyword", "seo", { term: "x" });
    expect(saved["entities/keyword--seo"].updatedBy).toBe("u1"); // the write itself succeeded
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/someone else changed this record/);
    expect(warnings[0]).toMatch(/someone-else/);
    expect(warnings[0]).toMatch(/entities\/keyword--seo/);
  } finally {
    globalThis.console.warn = orig;
  }
});

test("upsert stays silent when the re-read shows the writer's own stamps", async () => {
  var warnings = [];
  var orig = globalThis.console.warn;
  globalThis.console.warn = function (m) { warnings.push(m); };
  try {
    var store = fakeStore({});
    var actions = makeActions(ctxWith(store, "u1", definitionWith()), ["upsert"], null);
    await actions.upsert("keyword", "seo", { term: "x" });
    expect(warnings).toEqual([]);
  } finally {
    globalThis.console.warn = orig;
  }
});

test("upsertStampConflict_ names the path and the other writer", () => {
  expect(upsertStampConflict_({ updatedBy: "u1", updatedAt: "t" }, "entities/keyword--seo", "u1", "t")).toBeNull();
  var msg = upsertStampConflict_({ updatedBy: "u2", updatedAt: "t2" }, "entities/keyword--seo", "u1", "t");
  expect(msg).toMatch(/entities\/keyword--seo/);
  expect(msg).toMatch(/u2/);
  expect(upsertStampConflict_(null, "entities/keyword--seo", "u1", "t")).toBeNull();
});
