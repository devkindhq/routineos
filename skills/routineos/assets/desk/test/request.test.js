import { expect, test } from "vitest";
import { request } from "../core/actions.js";
import { createStore } from "../core/store.js";

var DEFN = { producers: [{ id: "scout" }, { id: "other" }] };

function ctxWith(docs) {
  docs = docs || {};
  var store = createStore("static", { docs: docs });
  store.readOnly = false;
  store.set = (p, d) => { docs[p] = { version: 1, data: JSON.parse(JSON.stringify(d)) }; return Promise.resolve(); };
  return { store: store, viewer: "u1", definition: DEFN };
}

function countRequests(ctx) {
  return ctx.store.list("requests").then((rows) => rows.length);
}

test("asking twice for the same run writes one request and hands back the queued one", async () => {
  var ctx = ctxWith();
  var first = await request(ctx, "run-now", { routine: "scout" });
  var second = await request(ctx, "run-now", { routine: "scout" });
  expect(second.id).toBe(first.id);
  expect(await countRequests(ctx)).toBe(1);
});

test("a flood of 50 identical asks leaves one pending request", async () => {
  var ctx = ctxWith();
  for (var i = 0; i < 50; i++) await request(ctx, "run-now", { routine: "scout" });
  expect(await countRequests(ctx)).toBe(1);
});

test("a different kind or a different routine is its own request", async () => {
  var ctx = ctxWith();
  await request(ctx, "run-now", { routine: "scout" });
  await request(ctx, "retry", { routine: "scout" });
  await request(ctx, "run-now", { routine: "other" });
  expect(await countRequests(ctx)).toBe(3);
});

test("a request a run already reported on no longer blocks a new one", async () => {
  var ctx = ctxWith();
  var first = await request(ctx, "run-now", { routine: "scout" });
  await ctx.store.set("runs/scout-20261109", { producer: "scout", startedAt: "2026-11-09T06:00:00Z", status: "ok",
    processed: [{ request: first.id, outcome: "applied" }] });
  var again = await request(ctx, "run-now", { routine: "scout" });
  expect(again.id).not.toBe(first.id);
  expect(await countRequests(ctx)).toBe(2);
});

test("a handled request (status not pending) does not block a new one", async () => {
  var ctx = ctxWith({ "requests/old": { data: { kind: "run-now", routine: "scout", status: "refused", createdAt: "2026-11-01T00:00:00Z", by: "u2", note: "" } } });
  var out = await request(ctx, "run-now", { routine: "scout" });
  expect(out.id).not.toBe("old");
  expect(await countRequests(ctx)).toBe(2);
});

test("two asks started together write one request", async () => {
  var ctx = ctxWith();
  var both = await Promise.all([request(ctx, "run-now", { routine: "scout" }), request(ctx, "run-now", { routine: "scout" })]);
  expect(both[1].id).toBe(both[0].id);
  expect(await countRequests(ctx)).toBe(1);
});

test("a request that failed to write does not block the next ask", async () => {
  var ctx = ctxWith();
  var set = ctx.store.set;
  ctx.store.set = () => Promise.reject(new Error("nope"));
  await expect(request(ctx, "run-now", { routine: "scout" })).rejects.toThrow("nope");
  ctx.store.set = set;
  await request(ctx, "run-now", { routine: "scout" });
  expect(await countRequests(ctx)).toBe(1);
});
