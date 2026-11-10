import { expect, test } from "vitest";
import { staticStore } from "../core/store.js";

function fetchOf(bodies) {
  var calls = [];
  var fn = function (url) {
    calls.push(url);
    var body = bodies[Math.min(calls.length - 1, bodies.length - 1)];
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve(body); } });
  };
  fn.calls = calls;
  return fn;
}

var OLD = { "entities/a": { data: { type: "t", key: "a", v: 1 } } };
var NEW = { "entities/a": { data: { type: "t", key: "a", v: 2 } } };

test("reload makes the next read see the new file, and a second read does not refetch", async () => {
  var fetchFn = fetchOf([OLD, NEW]);
  var store = staticStore({ url: "snap.json", fetch: fetchFn });
  expect((await store.list("entities"))[0].data.v).toBe(1);
  expect(await store.reload()).toBe(true);
  expect((await store.list("entities"))[0].data.v).toBe(2);
  await store.list("entities");
  expect(fetchFn.calls.length).toBe(2);
});

test("reload bypasses the cache with a query value", async () => {
  var fetchFn = fetchOf([OLD, NEW]);
  var store = staticStore({ url: "snap.json", fetch: fetchFn });
  await store.list("entities");
  await store.reload();
  expect(fetchFn.calls[0]).toBe("snap.json");
  expect(fetchFn.calls[1]).toMatch(/^snap\.json\?r=\d+$/);
  var withQuery = fetchOf([OLD, NEW]);
  var s2 = staticStore({ url: "snap.json?x=1", fetch: withQuery });
  await s2.reload();
  expect(withQuery.calls[0]).toMatch(/^snap\.json\?x=1&r=\d+$/);
});

test("reload re-resolves inline docs", async () => {
  var opts = { docs: OLD };
  var store = staticStore(opts);
  expect((await store.list("entities"))[0].data.v).toBe(1);
  opts.docs = NEW;
  await store.reload();
  expect((await store.list("entities"))[0].data.v).toBe(2);
});

test("a failed reload leaves the store able to try again", async () => {
  var n = 0;
  var store = staticStore({ url: "snap.json", fetch: function () {
    n++;
    return n === 1 ? Promise.resolve({ ok: false }) : Promise.resolve({ ok: true, json: function () { return Promise.resolve(NEW); } });
  } });
  await expect(store.reload()).rejects.toThrow();
  expect((await store.list("entities"))[0].data.v).toBe(2);
});
