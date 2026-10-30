// node --test tests/visual/shell.test.mjs  (built-in runner, no packages)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const SRC = "../../skills/routineos/assets/desk/src/";
const { createStore, ReadOnlyError, NoDbError } = require(SRC + "store.js");
const { route } = require(SRC + "router.js");

const SNAPSHOT = {
  "meta/definition": { version: 1, data: { version: "v1", types: {} } },
  "runs/r1": { version: 1, data: { producer: "a", startedAt: "2026-10-01T00:00:00Z", status: "ok", tags: ["x"] } },
  "runs/r2": { version: 1, data: { producer: "b", startedAt: "2026-10-03T00:00:00Z", status: "partial", tags: ["y"] } },
  "runs/r3": { version: 2, data: { producer: "a", startedAt: "2026-10-02T00:00:00Z", status: "ok", tags: ["x", "y"] } },
  "inbox/r1--1": { version: 1, data: { title: "t" } },
};

test("static get returns exists and data, and a miss is not an error", async () => {
  const s = createStore("static", { docs: SNAPSHOT });
  const hit = await s.get("runs/r1");
  assert.equal(hit.exists, true);
  assert.equal(hit.data.producer, "a");
  const miss = await s.get("runs/nope");
  assert.deepEqual(miss, { id: "nope", path: "runs/nope", exists: false, data: undefined });
});

test("static list filters, orders and limits one collection only", async () => {
  const s = createStore("static", { docs: SNAPSHOT });
  const all = await s.list("runs");
  assert.deepEqual(all.map((d) => d.id), ["r1", "r2", "r3"]);
  const a = await s.list("runs", { where: [["producer", "==", "a"]], orderBy: ["startedAt", "desc"] });
  assert.deepEqual(a.map((d) => d.id), ["r3", "r1"]);
  const lim = await s.list("runs", { orderBy: ["startedAt", "asc"], limit: 2 });
  assert.deepEqual(lim.map((d) => d.id), ["r1", "r3"]);
  const tagged = await s.list("runs", { where: [["tags", "array-contains", "y"]] });
  assert.deepEqual(tagged.map((d) => d.id), ["r2", "r3"]);
  const inList = await s.list("runs", { where: [["status", "in", ["partial"]]] });
  assert.deepEqual(inList.map((d) => d.id), ["r2"]);
  assert.equal((await s.list("inbox")).length, 1);
});

test("static subscribe delivers once and returns an unsubscribe", async () => {
  const s = createStore("static", { docs: SNAPSHOT });
  const seen = [];
  const unsub = await new Promise((resolve) => {
    const u = s.subscribe("runs", (docs) => { seen.push(docs.length); resolve(u); });
  });
  assert.equal(typeof unsub, "function");
  assert.deepEqual(seen, [3]);
});

test("static adapter is read only with a typed error", async () => {
  const s = createStore("static", { docs: SNAPSHOT });
  assert.equal(s.readOnly, true);
  await assert.rejects(() => s.set("userstate/x", { star: true }), ReadOnlyError);
  await assert.rejects(() => s.del("runs/r1"), ReadOnlyError);
  assert.equal(await s.viewer(), null);
});

test("static adapter loads a snapshot by url through the given fetch", async () => {
  const urls = [];
  const fetchFn = async (u) => { urls.push(u); return { ok: true, json: async () => SNAPSHOT }; };
  const s = createStore("static", { url: "desk-demo.json", fetch: fetchFn });
  assert.equal((await s.get("runs/r2")).data.status, "partial");
  await s.list("runs");
  assert.deepEqual(urls, ["desk-demo.json"]);
});

test("static adapter fetches again after a failed load, so Try again can recover", async () => {
  let calls = 0;
  const fetchFn = async () => { calls++; return calls === 1 ? { ok: false } : { ok: true, json: async () => SNAPSHOT }; };
  const s = createStore("static", { url: "desk-demo.json", fetch: fetchFn });
  await assert.rejects(() => s.get("runs/r2"));
  assert.equal((await s.get("runs/r2")).data.status, "partial");
  assert.equal(calls, 2);
});

// A fake of the platform namespace, shaped like db.d.ts and user.d.ts (contract 0.2.92).
function fakeClaude({ db = true, userId = "u_1" } = {}) {
  const calls = [];
  const snap = (path, body) => ({ id: path.split("/").pop(), exists: body !== undefined, data: () => body, metadata: {} });
  const query = (coll, ops = []) => ({
    where: (f, op, v) => query(coll, ops.concat([["where", f, op, v]])),
    orderBy: (f, dir) => query(coll, ops.concat([["orderBy", f, dir]])),
    limit: (n) => query(coll, ops.concat([["limit", n]])),
    get: async () => { calls.push(["query", coll, ops]); return { docs: [snap(coll + "/d1", { n: 1 })] }; },
    onSnapshot: (next) => { calls.push(["sub", coll, ops]); next({ docs: [snap(coll + "/d1", { n: 1 })] }); return () => calls.push(["unsub", coll]); },
  });
  const dbNs = {
    doc: (path) => ({
      get: async () => { calls.push(["get", path]); return snap(path, path === "meta/workspace" ? { name: "W" } : undefined); },
      set: async (body) => { calls.push(["set", path, body]); },
      delete: async () => { calls.push(["delete", path]); },
    }),
    collection: (path) => query(path),
  };
  const userNs = { id: async () => userId };
  return { calls, claude: { use: async (name) => (name === "db" ? (db ? dbNs : null) : name === "user" ? userNs : null) } };
}

test("db adapter maps get, list, subscribe, set and del onto the namespace", async () => {
  const { calls, claude } = fakeClaude();
  const s = createStore("db", { claude });
  assert.equal(s.readOnly, false);
  assert.equal((await s.get("meta/workspace")).data.name, "W");
  assert.equal((await s.get("meta/definition")).exists, false);
  const rows = await s.list("runs", { where: [["status", "==", "ok"]], orderBy: ["startedAt", "desc"], limit: 5 });
  assert.deepEqual(rows, [{ id: "d1", path: "runs/d1", exists: true, data: { n: 1 } }]);
  const got = [];
  const unsub = s.subscribe("inbox", (docs) => got.push(docs.length));
  await new Promise((r) => setTimeout(r, 0));
  unsub();
  await s.set("userstate/x", { star: true });
  await s.del("userstate/x");
  assert.deepEqual(got, [1]);
  assert.deepEqual(calls.find((c) => c[0] === "query"), ["query", "runs", [["where", "status", "==", "ok"], ["orderBy", "startedAt", "desc"], ["limit", 5]]]);
  assert.ok(calls.some((c) => c[0] === "unsub" && c[1] === "inbox"));
  assert.ok(calls.some((c) => c[0] === "set" && c[1] === "userstate/x"));
  assert.ok(calls.some((c) => c[0] === "delete" && c[1] === "userstate/x"));
});

test("db adapter has no version pin on the page side", async () => {
  const { claude } = fakeClaude();
  const s = createStore("db", { claude });
  await assert.rejects(() => s.set("settings/a", {}, { ifVersion: 3 }), TypeError);
});

test("db adapter with no db namespace rejects with NoDbError", async () => {
  const { claude } = fakeClaude({ db: false });
  const s = createStore("db", { claude });
  await assert.rejects(() => s.get("meta/definition"), NoDbError);
  const none = createStore("db", {});
  await assert.rejects(() => none.list("runs"), NoDbError);
});

test("saveFile offers the file through downloads, else rejects as unavailable", async () => {
  const saved = [];
  const downloads = { save: async (req) => { saved.push(req); return { status: "saved" }; } };
  const claude = { use: async (name) => (name === "downloads" ? downloads : null) };
  assert.deepEqual(await createStore("db", { claude }).saveFile("roles.csv", "a\r\n"), { status: "saved" });
  assert.deepEqual(saved, [{ filename: "roles.csv", data: "a\r\n" }]);
  const none = createStore("db", { claude: { use: async () => null } });
  await assert.rejects(() => none.saveFile("roles.csv", "a"), (e) => e.code === "unavailable");
  await assert.rejects(() => createStore("static", { docs: SNAPSHOT }).saveFile("roles.csv", "a"), (e) => e.code === "unavailable");
});

test("viewer is the awaited user id, or null that disables per-viewer state", async () => {
  assert.equal(await createStore("db", { claude: fakeClaude().claude }).viewer(), "u_1");
  assert.equal(await createStore("db", { claude: fakeClaude({ userId: null }).claude }).viewer(), null);
  assert.equal(await createStore("db", {}).viewer(), null);
});

test("router parses the spec s8 hash routes", () => {
  assert.deepEqual(route(""), { page: "today", params: {} });
  assert.deepEqual(route("#/today"), { page: "today", params: {} });
  assert.deepEqual(route("#/inbox"), { page: "inbox", params: {} });
  assert.deepEqual(route("#/browse/company"), { page: "browse", params: { type: "company" } });
  assert.deepEqual(route("#/entity/company/acme-co"), { page: "entity", params: { type: "company", key: "acme-co" } });
  assert.deepEqual(route("#/views"), { page: "views", params: {} });
  assert.deepEqual(route("#/runs"), { page: "history", params: {}, redirect: "#/history" });
  assert.deepEqual(route("#/runs/r%201"), { page: "run", params: { id: "r 1" }, redirect: "#/history/r%201" });
  assert.deepEqual(route("#/settings"), { page: "settings", params: {} });
  assert.deepEqual(route("#/nowhere"), { page: "today", params: {} });
  assert.deepEqual(route("#/browse"), { page: "today", params: {} });
});

test("router keeps query state for filters", () => {
  assert.deepEqual(route("#/browse/role?status=dropped&reason=excluded%20company"), {
    page: "browse", params: { type: "role", query: { status: "dropped", reason: "excluded company" } },
  });
});

test("profiles: the static store and a null user namespace resolve {}, a live one passes the ids through", async () => {
  assert.deepEqual(await createStore("static", { docs: SNAPSHOT }).profiles(["u_1"]), {});
  const none = createStore("db", { claude: { use: async () => null } });
  assert.deepEqual(await none.profiles(["u_1"]), {});
  let asked = null;
  const live = createStore("db", { claude: { use: async (n) => (n === "user" ? { profiles: async (ids) => { asked = ids; return { u_1: { id: "u_1", name: "Sam" } }; } } : null) } });
  assert.equal((await live.profiles(["u_1"])).u_1.name, "Sam");
  assert.deepEqual(asked, ["u_1"]);
});

// Task 16: the sidebar model, keyboard shortcuts and the command palette (src/palette.js).
const { navModel, bottomModel, shortcutFor, isTyping, paletteCommands, matchCommands } = require(SRC + "palette.js");

const NAV_DEF = {
  types: { role: { label: "Role", plural: "Roles" }, company: { label: "Company", plural: "Companies" }, contact: { label: "Contact", plural: "Contacts" } },
  views: [{ id: "au-roles", type: "role", name: "AU roles" }],
};
const NAV_VIEWS = [
  { id: "v-zed", data: { type: "role", name: "Zed roles" } },
  { id: "v-big", data: { type: "company", name: "Big companies" } },
  { id: "v-new", data: { type: "role", name: "Proposed one", state: "proposed" } },
];

test("navModel: Today, Inbox, Approvals, one entry per type with its views, then History and Settings", () => {
  const nav = navModel(NAV_DEF, NAV_VIEWS, new Set(["v-zed"]));
  assert.deepEqual(nav.map((n) => n.id), ["today", "inbox", "approvals", "type:company", "type:contact", "type:role", "history", "settings"]);
  const role = nav.find((n) => n.id === "type:role");
  assert.equal(role.label, "Roles");
  assert.equal(role.href, "#/browse/role");
  // pinned first, then by name; a proposed view is not in the sidebar
  assert.deepEqual(role.children.map((c) => c.label), ["Zed roles", "AU roles"]);
  assert.deepEqual(role.children.map((c) => c.pinned), [true, false]);
  assert.equal(role.children[1].href, "#/browse/role?view=au-roles");
  assert.equal(nav.find((n) => n.id === "type:contact").children.length, 0);
  assert.equal(nav[0].href, "#/today");
  assert.equal(nav[6].href, "#/history");
});

test("navModel copes with no definition, no views and no pins", () => {
  assert.deepEqual(navModel(null, null, null).map((n) => n.id), ["today", "inbox", "approvals", "history", "settings"]);
});

test("navModel survives a shared view whose name is not a string", () => {
  const forged = [{ id: "v-num", data: { type: "role", name: 7 } }, { id: "v-obj", data: { type: "role", name: { x: 1 } } }];
  const role = navModel(NAV_DEF, NAV_VIEWS.concat(forged), null).find((n) => n.id === "type:role");
  assert.equal(role.children.length, 4);
  role.children.forEach((c) => assert.equal(typeof c.label, "string"));
});

test("navModel: page icons, list and dot defaults, and a named icon only when the icon set has it", () => {
  const plain = navModel(NAV_DEF, NAV_VIEWS, null);
  assert.deepEqual(plain.map((n) => n.icon), ["house", "inbox", "badge-check", "list", "list", "list", "history", "settings"]);
  plain.find((n) => n.id === "type:role").children.forEach((c) => assert.equal(c.icon, "dot"));
  const def = { types: { role: { label: "Role", plural: "Roles", icon: "briefcase" }, company: { label: "Company", plural: "Companies", icon: "sparkles" } },
    views: [{ id: "au-roles", type: "role", name: "AU roles", icon: "globe" }] };
  const views = [{ id: "v-x", data: { type: "role", name: "X", icon: 7 } }];
  globalThis.ICONS = { briefcase: [], globe: [] };
  try {
    const nav = navModel(def, views, null);
    const role = nav.find((n) => n.id === "type:role");
    assert.equal(role.icon, "briefcase");
    // an icon the bundle does not carry falls back, so a stale or forged definition never breaks the rail
    assert.equal(nav.find((n) => n.id === "type:company").icon, "list");
    assert.deepEqual(role.children.map((c) => [c.label, c.icon]), [["AU roles", "globe"], ["X", "dot"]]);
  } finally {
    delete globalThis.ICONS;
  }
});

test("bottomModel: Today, Inbox, the first type, History, Settings; no type leaves four", () => {
  assert.deepEqual(bottomModel(navModel(NAV_DEF, [], null)).map((n) => n.label), ["Today", "Inbox", "Companies", "History", "Settings"]);
  assert.deepEqual(bottomModel(navModel(null, [], null)).map((n) => n.label), ["Today", "Inbox", "History", "Settings"]);
});

test("shortcutFor: g sequences go to pages and to types whose first letter is unambiguous", () => {
  const types = [{ id: "role", plural: "Roles" }, { id: "company", plural: "Companies" }, { id: "contact", plural: "Contacts" }, { id: "thing", plural: "Things" }];
  assert.deepEqual(shortcutFor(["g"], types), { pending: true });
  assert.deepEqual(shortcutFor(["g", "t"], types), { go: "#/today" });
  assert.deepEqual(shortcutFor(["g", "i"], types), { go: "#/inbox" });
  assert.deepEqual(shortcutFor(["g", "a"], types), { go: "#/approvals" });
  assert.deepEqual(shortcutFor(["g", "h"], types), { go: "#/history" });
  assert.deepEqual(shortcutFor(["g", "s"], types), { go: "#/settings" });
  assert.deepEqual(shortcutFor(["g", "r"], types), { go: "#/browse/role" });
  // Companies and Contacts share c; Things would take t, which Today owns
  assert.equal(shortcutFor(["g", "c"], types), null);
  assert.deepEqual(shortcutFor(["g", "t"], types), { go: "#/today" });
  assert.equal(shortcutFor(["g", "z"], types), null);
});

test("shortcutFor: single keys", () => {
  assert.deepEqual(shortcutFor(["/"], []), { run: "search" });
  assert.deepEqual(shortcutFor(["f"], []), { run: "filters" });
  assert.deepEqual(shortcutFor(["n"], []), { run: "notifications" });
  assert.deepEqual(shortcutFor(["["], []), { run: "sidebar" });
  assert.deepEqual(shortcutFor(["?"], []), { run: "help" });
  assert.equal(shortcutFor(["x"], []), null);
  assert.equal(shortcutFor([], []), null);
});

test("isTyping: text fields and editable content, not checkboxes or buttons", () => {
  assert.equal(isTyping({ tagName: "INPUT", type: "text" }), true);
  assert.equal(isTyping({ tagName: "INPUT", type: "search" }), true);
  assert.equal(isTyping({ tagName: "TEXTAREA" }), true);
  assert.equal(isTyping({ tagName: "SELECT" }), true);
  assert.equal(isTyping({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(isTyping({ tagName: "INPUT", type: "checkbox" }), false);
  assert.equal(isTyping({ tagName: "BUTTON" }), false);
  assert.equal(isTyping(null), false);
});

test("paletteCommands lists pages, types and views, then the extra commands; matchCommands needs every word", () => {
  const cmds = paletteCommands(navModel(NAV_DEF, NAV_VIEWS, null), [{ id: "theme", label: "Toggle theme", run: () => {} }]);
  const labels = cmds.map((c) => c.label);
  assert.equal(labels[0], "Go to Today");
  assert.ok(labels.includes("Go to Roles"));
  assert.ok(labels.includes("Open view AU roles (Roles)"));
  assert.equal(labels[labels.length - 1], "Toggle theme");
  assert.equal(cmds.find((c) => c.label === "Go to Roles").href, "#/browse/role");
  assert.deepEqual(matchCommands(cmds, "go rol").map((c) => c.label), ["Go to Roles"]);
  assert.deepEqual(matchCommands(cmds, "  THEME ").map((c) => c.label), ["Toggle theme"]);
  assert.equal(matchCommands(cmds, "").length, cmds.length);
  assert.deepEqual(matchCommands(cmds, "nothing like this"), []);
});
