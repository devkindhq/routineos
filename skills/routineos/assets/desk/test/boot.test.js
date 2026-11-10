import { expect, test } from "vitest";
import { boot } from "../app/boot.js";
import { createStore } from "../core/store.js";

// A store that records every call in order and keeps what it is given.
function recordingStore(docs, opts) {
  opts = opts || {};
  var calls = [];
  function doc(path) {
    var d = docs[path];
    return { id: path.split("/").pop(), path: path, exists: !!d, data: d ? d.data : undefined };
  }
  return {
    calls: calls,
    readOnly: false,
    get: function (path) { calls.push(path); return Promise.resolve(doc(path)); },
    viewer: function () { calls.push("viewer"); return Promise.resolve(opts.viewer || null); },
    isOwner: function () { calls.push("isOwner"); return Promise.resolve(opts.owner === true); },
    set: function (path, data) { calls.push("set " + path); docs[path] = { data: data }; return Promise.resolve(); },
  };
}

var BASE = ["meta/definition", "meta/workspace", "viewer", "meta/join", "meta/owner", "meta/lock", "settings/workspace"];

test("boot reads in the base order, then ensureOwner", async () => {
  var store = recordingStore({ "meta/definition": { data: { types: {} } } }, { viewer: "u1", owner: true });
  var model = await boot(store, { workspace: "W" });
  expect(store.calls.slice(0, BASE.length)).toEqual(BASE);
  expect(store.calls.slice(BASE.length)).toEqual(["isOwner", "meta/owner", "set meta/owner", "meta/owner"]);
  expect(model.viewer).toBe("u1");
  expect(model.owner.by).toBe("u1");
  expect(model.definition).toEqual({ types: {} });
  expect(model.failed).toBeNull();
});

test("boot keeps the config workspace name when meta/workspace is missing, and reads the lock, join and tour", async () => {
  var lock = { algo: "PBKDF2-SHA-256", salt: "00112233445566778899aabbccddeeff", hash: "a".repeat(64), iterations: 200000 };
  var store = recordingStore({
    "meta/definition": { data: { types: {} } }, "meta/join": { data: { lanes: [] } }, "meta/lock": { data: lock },
    "settings/workspace": { data: { values: { tour: false } } },
  });
  var model = await boot(store, { workspace: "Config name", tour: true });
  expect(model.workspace).toEqual({ name: "Config name" });
  expect(model.join).toEqual({ lanes: [] });
  expect(model.lock).toEqual(lock);
  expect(model.tour).toBe(true);
  expect(model.tourOff).toBe(true);
  expect(model.viewer).toBeNull();
});

test("a malformed lock never locks anyone out", async () => {
  var store = recordingStore({ "meta/lock": { data: { algo: "md5" } } });
  expect((await boot(store, {})).lock).toBeNull();
});

test("a store with no db boots to the no-db state", async () => {
  var model = await boot(createStore("db", { claude: null }), {});
  expect(model.failed).toBe("no-db");
});

test("a read that fails boots to the read-error state with its message", async () => {
  var store = recordingStore({});
  store.get = function () { return Promise.reject(new Error("boom")); };
  var model = await boot(store, {});
  expect(model.failed).toBe("read-error");
  expect(model.failError).toBe("boom");
});
