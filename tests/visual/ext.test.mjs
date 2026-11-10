// node --test tests/visual/ext.test.mjs
// Desk extensions: the host verbs, their refusals, the watch disposer, the route and the nav entry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const CORE = "../../skills/routineos/assets/desk/core/";
Object.assign(globalThis, require(CORE + "shared.js"));
const { makeActions, extCtx, validId, sectionsFor, navPages, findPage, extTag, extAttr } = require(CORE + "ext.js");
const { route } = require(CORE + "router.js");
const { navModel } = require(CORE + "palette.js");

const ALL = ["decide", "comment", "saveField", "drop", "keep"];

function fakeStore(opts = {}) {
  const writes = [];
  const subs = [];
  return {
    writes, subs, readOnly: !!opts.readOnly,
    set: async (p, d) => { writes.push([p, d]); },
    del: async () => {},
    get: async () => ({ exists: false }),
    list: async () => [],
    subscribe: (c, cb) => { const s = { c, cb, off: 0 }; subs.push(s); return () => { s.off++; }; },
  };
}
const ctxOf = (store, viewer = "u_owner") => ({ store, viewer });

test("decide writes decisions/<id>~x and never the keep or drop doc", async () => {
  const store = fakeStore();
  const a = makeActions(ctxOf(store), ALL);
  assert.equal(await a.decide("role--1", "approved", "ok"), true);
  assert.equal(store.writes.length, 1);
  assert.equal(store.writes[0][0], "decisions/role--1~x");
  assert.equal(store.writes[0][1].decision, "approved");
  assert.equal(store.writes[0][1].by, "u_owner");
});

test("decide refuses reserved values, bad values and bad ids; nothing is written", async () => {
  const store = fakeStore();
  const a = makeActions(ctxOf(store), ALL);
  await assert.rejects(a.decide("role--1", "drop", ""), /drop or keep/);
  await assert.rejects(a.decide("role--1", "Has Space", ""), /decision value/);
  await assert.rejects(a.decide("../x", "approved", ""), /not a record id/);
  await assert.rejects(a.decide("a/b", "approved", ""), /not a record id/);
  assert.equal(store.writes.length, 0);
});

test("a read-only store or no viewer refuses every verb with the Desk's wording", async () => {
  const ro = fakeStore({ readOnly: true });
  await assert.rejects(makeActions(ctxOf(ro), ALL).decide("r1", "ok", ""), /read only/i);
  const anon = fakeStore();
  await assert.rejects(makeActions(ctxOf(anon, null), ALL).comment("r1", "hi"), /Sign in/);
  assert.equal(ro.writes.length + anon.writes.length, 0);
});

test("comment needs text and is capped", async () => {
  const store = fakeStore();
  const a = makeActions(ctxOf(store), ALL);
  await assert.rejects(a.comment("r1", "   "), /Write a comment/);
  await a.comment("r1", "x".repeat(9000));
  assert.match(store.writes[0][0], /^comments\/ext~[0-9a-z]+~[0-9a-f]{12}$/);
  assert.equal(store.writes[0][1].entity, "r1");
  assert.equal(store.writes[0][1].text.length, 4000);
});

test("watch accepts only listed collections and its disposer runs once", () => {
  const store = fakeStore();
  const tracked = [];
  const c = extCtx(ctxOf(store), (d) => tracked.push(d));
  assert.throws(() => c.watch("settings-secret", () => {}), /Cannot watch/);
  const off = c.watch("decisions", () => {});
  assert.equal(tracked.length, 1);
  tracked.forEach((d) => d());
  off();
  assert.equal(store.subs[0].off, 1);
});

test("the component's store handle has get and list only", () => {
  const c = extCtx(ctxOf(fakeStore()), () => {});
  assert.deepEqual(Object.keys(c.store).sort(), ["get", "list"]);
  assert.equal(c.store.set, undefined);
});

test("ids, tags and attributes", () => {
  assert.equal(validId("role--https-jobs.example:1"), true);
  assert.equal(validId("a b"), false);
  assert.equal(extTag("button"), true);
  assert.equal(extTag("script"), false);
  assert.equal(extAttr("onclick", "button", "x", () => true), false);
  assert.equal(extAttr("type", "button", "button", () => true), true);
  assert.equal(extAttr("type", "input", "file", () => true), false);
  assert.equal(extAttr("src", "img", "https://x/y.png", () => false), false);
  assert.equal(extAttr("src", "div", "x", () => true), false);
});

const REG = {
  box: { slot: "record-section", types: ["role"] },
  other: { slot: "record-section", types: ["job"] },
  pg: { slot: "page", nav: true, title: "Queue" },
  hidden: { slot: "page", nav: false },
};

test("registry lookups", () => {
  assert.deepEqual(sectionsFor(REG, "role").map((e) => e.id), ["box"]);
  assert.deepEqual(navPages(REG).map((e) => e.id), ["pg"]);
  assert.equal(findPage(REG, "hidden").id, "hidden");
  assert.equal(findPage(REG, "box"), null);
  assert.deepEqual(sectionsFor(undefined, "role"), []);
});

test("route #/x/<name> opens the ext page", () => {
  const r = route("#/x/review-page");
  assert.equal(r.page, "ext");
  assert.equal(r.params.name, "review-page");
});

test("navModel lists extension pages only when there are some", () => {
  const defn = { types: { role: { label: "Role", plural: "Roles" } } };
  const plain = JSON.stringify(navModel(defn, [], [], undefined, undefined, undefined, []));
  assert.ok(!plain.includes("#/x/"));
  const withExt = JSON.stringify(navModel(defn, [], [], undefined, undefined, undefined, [{ id: "pg", title: "Queue" }]));
  assert.ok(withExt.includes("#/x/pg"));
});

test("only the verbs the manifest declares exist on ctx.actions", async () => {
  const store = fakeStore();
  const c = extCtx(ctxOf(store), () => {}, ["comment"]);
  assert.deepEqual(Object.keys(c.actions), ["comment"]);
  assert.equal(c.actions.decide, undefined);
  assert.equal(c.actions.drop, undefined);
  assert.deepEqual(Object.keys(extCtx(ctxOf(store), () => {}).actions), []);
  assert.deepEqual(Object.keys(extCtx(ctxOf(store), () => {}, ["nope", "keep"]).actions), ["keep"]);
  assert.equal(store.writes.length, 0);
});

test("on a joined Desk a member cannot decide, drop or keep; the owner can; comment still works", async () => {
  const joined = (viewer) => ({ store: fakeStore(), viewer, join: { by: "u_owner" }, owner: { by: "u_owner" } });
  const m = joined("u_member");
  const a = makeActions(m, ALL);
  await assert.rejects(a.decide("r1", "approved", ""), /owner/);
  await assert.rejects(a.drop("r1", "spam"), /owner/);
  await assert.rejects(a.keep("r1"), /owner/);
  assert.equal(await a.comment("r1", "hello"), true);
  assert.deepEqual(m.store.writes.map((w) => w[0].split("/")[0]), ["comments"]);
  const o = joined("u_owner");
  const b = makeActions(o, ALL);
  assert.equal(await b.keep("r1"), true);
  assert.equal(await b.decide("r1", "approved", ""), true);
  assert.equal(o.store.writes.length, 2);
});

test("an extension image carries its bytes: https is not an image source", () => {
  const { extImageSrc } = require(CORE + "ext.js");
  assert.equal(extImageSrc("https://e.example/?d=secret"), false);
  assert.equal(extImageSrc("http://e.example/x.png"), false);
  assert.equal(extImageSrc("data:image/png;base64,AAAA"), true);
  assert.equal(extImageSrc("blob:https://x/abc"), true);
  assert.equal(extImageSrc("data:text/html,x"), false);
  assert.equal(extAttr("src", "img", "https://e.example/x.png", extImageSrc), false);
  assert.equal(extAttr("src", "img", "data:image/png;base64,AAAA", extImageSrc), true);
});

test("a custom decision never lands on a built-in decisions doc, and comment ids are opaque and distinct", async () => {
  const store = fakeStore();
  const a = makeActions(ctxOf(store), ALL);
  await a.decide("role--a", "approved", "");
  assert.equal(store.writes[0][0], "decisions/role--a~x");
  assert.equal(validId("role--a--x~x"), false);
  await a.comment("role--a--u9--zz", "one");
  await a.comment("role--a--u9--zz", "two");
  assert.notEqual(store.writes[1][0], store.writes[2][0]);
  assert.doesNotMatch(store.writes[1][0], /role--a/);
});

test("dot ids are not record ids", () => {
  assert.equal(validId(".."), false);
  assert.equal(validId("."), false);
  assert.equal(validId("a.b"), true);
});

test("with a scope the record must exist and be of a declared type; nothing is written otherwise", async () => {
  const store = fakeStore();
  store.get = async (p) => p === "entities/role--1" ? { exists: true, data: { type: "role" } }
    : p === "entities/co--1" ? { exists: true, data: { type: "company" } } : { exists: false };
  const a = makeActions(ctxOf(store), ALL, { types: ["role"] });
  await assert.rejects(a.drop("co--1", "x"), /kind of record/);
  await assert.rejects(a.keep("nope--1"), /does not exist/);
  await assert.rejects(a.comment("co--1", "hi"), /kind of record/);
  await assert.rejects(a.saveField("co--1", "f", "v"), /kind of record/);
  await assert.rejects(a.decide("co--1", "ok", ""), /kind of record/);
  assert.equal(store.writes.length, 0);
  assert.equal(await a.keep("role--1"), true);
  assert.equal(store.writes.length, 1);
  const any = makeActions(ctxOf(store), ALL, { types: null });
  assert.equal(await any.comment("co--1", "hi"), true);
});
