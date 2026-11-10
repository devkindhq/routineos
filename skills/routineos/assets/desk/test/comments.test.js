import { expect, test } from "vitest";
import { writable } from "../core/actions.js";
import { MAX_AUTHORS, candidateAuthors, commentPath, listComments, watchComments } from "../core/comments.js";
import { deriveMembers, ownerOf } from "../core/members.js";
import { commentView, recordEvents } from "../core/record.js";
import { historyEvents } from "../core/pages/history.js";
import { createStore } from "../core/store.js";

var TS = Date.now().toString(36);
function ctxOver(docs, viewer, owner) {
  return { store: createStore("static", { docs: docs }), viewer: viewer || "u1", owner: owner || null };
}

test("a viewer writes comments only under their own people path", () => {
  expect(writable("people/u1/comments/roles--a--" + TS, "u1")).toBe(true);
  expect(writable("people/u2/comments/roles--a--" + TS, "u1")).toBe(false);
  expect(writable("people/u1/comments/x/y", "u1")).toBe(false);
  expect(writable("people/u1/comments/roles--a--" + TS, null)).toBe(false);
  expect(writable("comments/roles--a--u1--" + TS, "u1")).toBe(false); // new comments never go to the flat collection
  expect(commentPath("u1", "roles--a", TS)).toBe("people/u1/comments/roles--a--" + TS);
});

test("the author is the path owner, whatever the body says", async () => {
  var docs = {
    ["people/u2/comments/roles--a--" + TS]: { data: { entity: "roles--zzz", by: "u9", at: "2026-11-01T00:00:00Z", text: "I am u9" } },
  };
  var list = await listComments(ctxOver(docs, "u2"));
  expect(list.length).toBe(1);
  expect(list[0].data.by).toBe("u2");
  expect(list[0].data.entity).toBe("roles--a");
  expect(list[0].verified).toBe(true);
  var shown = commentView(list, "u2", Date.now());
  expect(shown.map((c) => c.by)).toEqual(["u2"]);
  expect(shown[0].canEdit).toBe(true);
  expect(commentView(list, "u9", Date.now())[0].canEdit).toBe(false);
});

test("an old flat comment still renders, marked unverified", async () => {
  var docs = { ["comments/roles--a--u3--" + TS]: { data: { entity: "roles--a", by: "u3", at: "2026-11-01T00:00:00Z", text: "old" } } };
  var list = await listComments(ctxOver(docs, "u1"), "roles--a");
  expect(list.length).toBe(1);
  expect(list[0].verified).toBe(false);
  expect(commentView(list, "u1", Date.now())[0]).toMatchObject({ text: "old", verified: false });
});

test("comments are read for the viewer, the owner and people named elsewhere, and filtered by record", async () => {
  var docs = {
    ["people/u1/comments/roles--a--" + TS]: { data: { at: "2026-11-01T00:00:00Z", text: "mine" } },
    ["people/uo/comments/roles--a--" + TS]: { data: { at: "2026-11-02T00:00:00Z", text: "owner's" } },
    ["people/ud/comments/roles--b--" + TS]: { data: { at: "2026-11-03T00:00:00Z", text: "decider's, other record" } },
    "decisions/roles--a": { data: { by: "ud", decision: "keep" } },
  };
  var list = await listComments(ctxOver(docs, "u1", { by: "uo" }), "roles--a");
  expect(list.map((c) => c.data.text).sort()).toEqual(["mine", "owner's"]);
});

test("another person's edit of a comment is ignored, so a comment cannot be rewritten or removed by someone else", async () => {
  var orig = "roles--a--u1--" + TS;
  var docs = {
    ["people/u1/comments/roles--a--" + TS]: { data: { at: "2026-11-01T00:00:00Z", text: "mine" } },
    ["people/u2/comments/roles--a--" + (Date.now() + 1).toString(36)]: { data: { at: "2026-11-01T00:01:00Z", edits: orig, deleted: true } },
  };
  var list = await listComments(ctxOver(docs, "u1", { by: "u2" }), "roles--a");
  var shown = commentView(list, "u1", Date.now());
  expect(shown.map((c) => c.text)).toEqual(["mine"]);
});

test("comments grant no membership and no ownership", () => {
  var docs = {
    ["people/u7/comments/roles--a--" + TS]: { data: { by: "u7", at: "2026-11-01T00:00:00Z" } },
    "comments/roles--a--u8--x": { data: { by: "u8", at: "2026-11-01T00:00:00Z" } },
  };
  expect(deriveMembers(docs, null, null)).toEqual([]);
  var comments = [{ verified: true, data: { entity: "roles--a", by: "u7", at: "2026-11-01T00:00:00Z" } }];
  expect(ownerOf("roles--a", {}, comments)).toBeNull();
});

test("watchComments answers once every source has, then with the merged, attributed list", async () => {
  var docs = {
    ["people/u1/comments/roles--a--" + TS]: { data: { by: "uX", at: "2026-11-01T00:00:00Z", text: "hi" } },
    ["comments/roles--a--u3--" + TS]: { data: { entity: "roles--a", by: "u3", at: "2026-11-01T00:00:00Z", text: "old" } },
  };
  var got = await new Promise((resolve, reject) => {
    var stop = watchComments(ctxOver(docs, "u1"), (list) => { resolve(list); }, reject);
    setTimeout(stop, 0);
  });
  expect(got.map((c) => [c.data.by, c.verified]).sort()).toEqual([["u1", true], ["u3", false]]);
});

test("an old flat doc cannot edit or delete a verified comment, and an old comment is not editable", async () => {
  var t0 = Date.now() - 60000, ts = t0.toString(36), later = (t0 + 1000).toString(36);
  var docs = {
    ["people/u1/comments/roles--a--" + ts]: { data: { at: new Date(t0).toISOString(), text: "mine" } },
    ["comments/roles--a--u1--" + later]: { data: { entity: "roles--a", by: "u1", at: new Date(t0 + 1000).toISOString(), edits: "roles--a--u1--" + ts, deleted: true } },
    ["comments/roles--a--u1--" + (t0 + 2000).toString(36)]: { data: { entity: "roles--a", by: "u1", at: new Date(t0 + 2000).toISOString(), text: "flat" } },
  };
  var shown = commentView(await listComments(ctxOver(docs, "u1"), "roles--a"), "u1", Date.now());
  expect(shown.map((c) => [c.text, c.verified, c.canEdit])).toEqual([["mine", true, true], ["flat", false, false]]);
});

test("nextTs36 never repeats, so comments posted in one millisecond keep separate paths", async () => {
  const { nextTs36 } = await import("../core/comments.js");
  var seen = new Set();
  for (var i = 0; i < 50; i++) seen.add(nextTs36());
  expect(seen.size).toBe(50);
});

var LEGACY = { id: "roles--a--u_owner--" + TS, path: "comments/x", verified: false,
  data: { entity: "roles--a", by: "u_owner", at: "2026-11-01T00:00:00Z", text: "approved by me" } };
var PATHED = { id: "roles--a--u2--" + TS, path: "people/u2/comments/x", verified: true,
  data: { entity: "roles--a", by: "u2", at: "2026-11-01T00:01:00Z", text: "real" } };

test("History does not attribute a legacy comment to the person its by names", () => {
  var ev = historyEvents({ comments: [LEGACY, PATHED], definition: {} });
  var legacy = ev.find((e) => /approved by me/.test(e.text));
  expect(legacy.by).toBeNull();
  expect(legacy.unverified).toBe(true);
  expect(legacy.text).toMatch(/^Unverified comment/);
  var real = ev.find((e) => /real/.test(e.text));
  expect(real.by).toBe("u2");
  expect(real.unverified).toBeUndefined();
});

test("the record activity does not attribute a legacy comment to the person its by names", () => {
  var ev = recordEvents({ type: "role", key: "k", sightings: [] }, { id: "roles--a", comments: [LEGACY, PATHED], definition: {} })
    .filter((e) => e.kind === "comment");
  var legacy = ev.find((e) => e.at === LEGACY.data.at);
  expect(legacy.by).toBeUndefined();
  expect(JSON.stringify(legacy.parts)).toMatch(/unverified/i);
  expect(JSON.stringify(legacy.parts)).not.toMatch(/u_owner/);
  expect(ev.find((e) => e.at === PATHED.data.at).by).toBe("u2");
});

test("a legacy comment's by never widens the people paths that are read", async () => {
  var docs = { "comments/roles--a--zz--x": { data: { by: "u_evil", entity: "roles--a", text: "t" } } };
  var ctx = ctxOver(docs, "u1");
  var listed = [];
  var real = ctx.store.list;
  ctx.store.list = (c, q) => { listed.push(c); return real.call(ctx.store, c, q); };
  await listComments(ctx);
  expect(listed).not.toContain("people/u_evil/comments");
});

test("2000 invented by values open at most MAX_AUTHORS people paths, and the viewer, owner and real people come first", async () => {
  var docs = { "people/u_real": { data: { at: "x" } } };
  for (var i = 0; i < 2000; i++) docs["decisions/d" + i] = { data: { by: "fake" + i } };
  var ctx = ctxOver(docs, "u1", { by: "u_owner" });
  var ids = await candidateAuthors(ctx);
  expect(ids.length).toBe(MAX_AUTHORS);
  expect(ids.slice(0, 3)).toEqual(["u1", "u_owner", "u_real"]);
  var again = await candidateAuthors(ctxOver(docs, "u1", { by: "u_owner" }));
  expect(again).toEqual(ids);
  var subs = [];
  var real = ctx.store.subscribe;
  ctx.store.subscribe = (c, cb, o) => { subs.push(c); return real.call(ctx.store, c, cb, o); };
  var stop = watchComments(ctx, () => {});
  await new Promise((r) => setTimeout(r, 20));
  stop();
  expect(subs.length).toBe(MAX_AUTHORS + 1);
});
