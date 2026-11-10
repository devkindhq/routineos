// Who may write shared data: the store asks the platform (user.can("data.write")), canWrite turns a refusal into a
// reason the controls show, and comments follow a looser rule (a Commenter comments).
import { expect, test } from "vitest";
import { boot } from "../app/boot.js";
import { ACCESS_NOTE, READ_ONLY_NOTE, SIGN_IN_NOTE, canComment, canWrite, writable } from "../core/actions.js";
import { createStore } from "../core/store.js";

function fakeClaude(user) {
  return { use: function (name) { return Promise.resolve(name === "user" ? user : null); } };
}
function userWith(can) { return { id: function () { return Promise.resolve("u1"); }, can: can }; }
function dbOf(user) { return createStore("db", { claude: fakeClaude(user) }); }

test("canWriteShared passes the platform's true, false and null through", async () => {
  expect(await dbOf(userWith(() => Promise.resolve(true))).canWriteShared()).toBe(true);
  expect(await dbOf(userWith(() => Promise.resolve(false))).canWriteShared()).toBe(false);
  expect(await dbOf(userWith(() => Promise.resolve(null))).canWriteShared()).toBeNull();
});

test("canWriteShared asks for data.write", async () => {
  var asked = [];
  await dbOf(userWith((what) => { asked.push(what); return Promise.resolve(true); })).canWriteShared();
  expect(asked).toEqual(["data.write"]);
});

test("canWriteShared is null when the platform does not say: a throwing can, no can, no user namespace, no claude", async () => {
  expect(await dbOf(userWith(() => { throw new Error("boom"); })).canWriteShared()).toBeNull();
  expect(await dbOf(userWith(() => Promise.reject(new Error("no")))).canWriteShared()).toBeNull();
  expect(await dbOf({ id: () => Promise.resolve("u1") }).canWriteShared()).toBeNull();
  expect(await dbOf(null).canWriteShared()).toBeNull();
  expect(await createStore("db", { claude: null }).canWriteShared()).toBeNull();
});

test("canWriteShared treats a value that is not exactly true or false as not told", async () => {
  expect(await dbOf(userWith(() => Promise.resolve("yes"))).canWriteShared()).toBeNull();
  expect(await dbOf(userWith(() => Promise.resolve(undefined))).canWriteShared()).toBeNull();
});

test("a static store has no shared-write answer and stays read only", () => {
  var s = createStore("static", { docs: {} });
  expect(s.readOnly).toBe(true);
  expect(s.canWriteShared).toBeUndefined();
});

test("canWrite: read only first, then no viewer, then a refused shared write", () => {
  var store = { readOnly: false };
  expect(canWrite({ store: { readOnly: true }, viewer: "u1", canWriteShared: false })).toEqual({ ok: false, reason: READ_ONLY_NOTE });
  expect(canWrite({ store: store, viewer: null, canWriteShared: false })).toEqual({ ok: false, reason: SIGN_IN_NOTE });
  var w = canWrite({ store: store, viewer: "u1", canWriteShared: false });
  expect(w).toEqual({ ok: false, reason: ACCESS_NOTE, code: "access" });
  expect(ACCESS_NOTE).toBe("Saving needs Contributor access or above");
});

test("canWrite stays enabled when the platform says true or did not say (null, undefined)", () => {
  [true, null, undefined].forEach((v) => {
    expect(canWrite({ store: { readOnly: false }, viewer: "u1", canWriteShared: v }).ok).toBe(true);
  });
});

test("canComment follows the shared-write answer: Commenter and Viewer are refused with the access reason", () => {
  expect(canComment({ store: { readOnly: false }, viewer: "u1", canWriteShared: false })).toEqual({ ok: false, reason: ACCESS_NOTE, code: "access" });
  expect(canComment({ store: { readOnly: false }, viewer: "u1", canWriteShared: true }).ok).toBe(true);
  expect(canComment({ store: { readOnly: false }, viewer: "u1", canWriteShared: null }).ok).toBe(true);
  expect(canComment({ store: { readOnly: false }, viewer: null, canWriteShared: false })).toEqual({ ok: false, reason: SIGN_IN_NOTE });
  expect(canComment({ store: { readOnly: true }, viewer: "u1" })).toEqual({ ok: false, reason: READ_ONLY_NOTE });
});

test("writable allows the viewer's own people marker doc and no other person's", () => {
  expect(writable("people/u1", "u1")).toBe(true);
  expect(writable("people/u2", "u1")).toBe(false);
  expect(writable("people/u1", null)).toBe(false);
  expect(writable("people", "u1")).toBe(false);
});

function bootStore(answer) {
  var s = {
    readOnly: false,
    get: () => Promise.resolve({ exists: false }),
    viewer: () => Promise.resolve("u1"),
    isOwner: () => Promise.resolve(false),
  };
  if (answer !== "absent") s.canWriteShared = () => Promise.resolve(answer);
  return s;
}

test("boot puts the shared-write answer on the model, null when the store cannot tell", async () => {
  expect((await boot(bootStore(false))).canWriteShared).toBe(false);
  expect((await boot(bootStore(true))).canWriteShared).toBe(true);
  expect((await boot(bootStore("absent"))).canWriteShared).toBeNull();
  var failing = bootStore(true);
  failing.canWriteShared = () => Promise.reject(new Error("x"));
  expect((await boot(failing)).canWriteShared).toBeNull();
});

test("composer resolves the comments namespace, and null when it is missing, throws or there is no claude", async () => {
  var ns = { openComposer: () => Promise.resolve() };
  var withNs = createStore("db", { claude: { use: (name) => Promise.resolve(name === "comments" ? ns : null) } });
  expect(await withNs.composer()).toBe(ns);
  expect(await dbOf(userWith(() => Promise.resolve(true))).composer()).toBeNull();
  expect(await createStore("db", { claude: { use: () => { throw new Error("boom"); } } }).composer()).toBeNull();
  expect(await createStore("db", { claude: null }).composer()).toBeNull();
  expect(createStore("static", { docs: {} }).composer).toBeUndefined();
});
