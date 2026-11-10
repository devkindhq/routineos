// The stand-in runtime's canWrite option: user.can("data.write") answers true (default), false or null, and with false
// every write is refused, as for a Commenter or Viewer (the platform refuses a db rule below interact). That refusal is
// this harness's model, not something seen with a real Commenter.
import assert from "node:assert/strict";
import test from "node:test";
import { fakeClaude } from "./fake-claude.mjs";

async function runtime(opts) {
  globalThis.window = {};
  globalThis.fetch = async () => ({ json: async () => ({}) });
  await fakeClaude({ addInitScript: async (fn, arg) => { fn(arg); } }, Object.assign({ writable: true }, opts));
  return globalThis.window.claude;
}

test("canWrite defaults to true", async () => {
  const user = await (await runtime()).use("user");
  assert.equal(await user.can("data.write"), true);
});

test("canWrite false and null are what user.can answers", async () => {
  assert.equal(await (await (await runtime({ canWrite: false })).use("user")).can("data.write"), false);
  assert.equal(await (await (await runtime({ canWrite: null })).use("user")).can("data.write"), null);
});

test("with canWrite false every write is refused, the viewer's own comments path included", async () => {
  const c = await runtime({ canWrite: false, viewer: "u_member" });
  const db = await c.use("db");
  await assert.rejects(db.doc("views/v1").set({ name: "x" }), /permission/i);
  await assert.rejects(db.doc("people/u_owner/comments/r--1").set({ text: "x" }), /permission/i);
  await assert.rejects(db.doc("people/u_member/comments/r--1").set({ text: "hi" }), /permission/i);
  assert.deepEqual(globalThis.window.__deskWrites || [], []);
});

test("with canWrite true or null writes are not refused by the harness", async () => {
  for (const canWrite of [true, null]) {
    const db = await (await runtime({ canWrite })).use("db");
    await db.doc("views/v1").set({ name: "x" });
  }
});
