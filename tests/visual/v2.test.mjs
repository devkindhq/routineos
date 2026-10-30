// node --test tests/visual/v2.test.mjs  (built-in runner, no packages)
// Desk v2 logic: write paths, routes, paging, overlay, bulk, views, inbox, approvals, notifications,
// history, settings history, export.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const SRC = "../../skills/routineos/assets/desk/src/";
const actions = require(SRC + "actions.js");

const doc = (id, data) => ({ id, data });

// A recording fake store with the static store's sort and filter semantics.
function fakeStore(docs, opts = {}) {
  const data = new Map(Object.entries(docs || {}));
  const log = [];
  const cmp = (a, b, f) => {
    const x = a.data[f], y = b.data[f];
    if (x === undefined && y === undefined) return 0;
    if (x === undefined) return 1;
    if (y === undefined) return -1;
    return x < y ? -1 : x > y ? 1 : 0;
  };
  const ops = {
    "==": (a, b) => a === b, "!=": (a, b) => a !== b, "<": (a, b) => a < b, "<=": (a, b) => a <= b,
    ">": (a, b) => a > b, ">=": (a, b) => a >= b, "in": (a, b) => b.includes(a), "not-in": (a, b) => !b.includes(a),
  };
  return {
    kind: opts.kind || "db", readOnly: !!opts.readOnly, log,
    reads: 0,
    list(coll, q = {}) {
      this.reads++;
      let rows = [...data].filter(([p]) => p.startsWith(coll + "/") && p.split("/").length === coll.split("/").length + 1)
        .map(([p, d]) => ({ id: p.slice(coll.length + 1), path: p, data: d }));
      for (const [f, op, v] of q.where || []) rows = rows.filter((r) => r.data[f] !== undefined && ops[op](r.data[f], v));
      if (q.orderBy) {
        const [f, dir] = q.orderBy;
        rows.sort((a, b) => {
          const c = cmp(a, b, f);
          if (c) return dir === "desc" && a.data[f] !== undefined && b.data[f] !== undefined ? -c : c;
          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        });
      }
      if (q.limit) rows = rows.slice(0, q.limit);
      return Promise.resolve(rows);
    },
    get(p) { return Promise.resolve({ id: p.split("/").pop(), path: p, exists: data.has(p), data: data.get(p) }); },
    set(p, d) {
      if (opts.fail && opts.fail(p)) return Promise.reject(opts.error || new Error("refused"));
      log.push(["set", p, d]); data.set(p, d); return Promise.resolve();
    },
    del(p) {
      if (opts.failDel && opts.failDel(p)) return Promise.reject(new Error("refused"));
      log.push(["del", p]); data.delete(p); return Promise.resolve();
    },
    data,
  };
}

// ---------- Task 1: write paths, viewer guard, quota ----------

test("v2 people paths: settings history, snooze and pin", () => {
  assert.equal(actions.writable("settingsHistory/h1", "u_1"), true);
  assert.equal(actions.writable("data/users/u_1/state/snooze/r1--1", "u_1"), true);
  assert.equal(actions.writable("data/users/u_1/state/pin/v1", "u_1"), true);
  assert.equal(actions.writable("data/users/u_2/state/pin/v1", "u_1"), false);
  assert.equal(actions.writable("data/users/u_1/state/other/v1", "u_1"), false);
});

test("canWrite says why a write control is off", () => {
  assert.deepEqual(actions.canWrite({ store: { readOnly: false }, viewer: "u_1" }), { ok: true, reason: "" });
  assert.deepEqual(actions.canWrite({ store: { readOnly: false }, viewer: null }), { ok: false, reason: "Sign in to make changes" });
  assert.deepEqual(actions.canWrite({ store: { readOnly: true }, viewer: null }), { ok: false, reason: "Demo data, read only" });
});

test("a full store gets the plain quota message", () => {
  const note = "The Desk is full (25,000 records). Ask the routine owner to clear old records.";
  assert.equal(actions.writeMessage({ code: "quota_exceeded", message: "x" }), note);
  assert.equal(actions.writeMessage(new Error("quota_exceeded: documents")), note);
  assert.equal(actions.writeMessage(new Error("nope")), "Not saved: nope");
});

export { fakeStore, doc };

// ---------- Task 2: routes ----------

const { route } = require(SRC + "router.js");

test("v2 routes: approvals, history modes, run detail under history", () => {
  assert.deepEqual(route("#/approvals"), { page: "approvals", params: {} });
  assert.deepEqual(route("#/history"), { page: "history", params: {} });
  assert.deepEqual(route("#/history?mode=cal"), { page: "history", params: { query: { mode: "cal" } } });
  assert.deepEqual(route("#/history/r1"), { page: "run", params: { id: "r1" } });
  assert.deepEqual(route("#/suggestions"), { page: "suggestions", params: {} });
  assert.deepEqual(route("#/inbox?tab=suggestions"), { page: "inbox", params: { query: { tab: "suggestions" } } });
});

test("old run routes redirect to their History equivalents", () => {
  assert.deepEqual(route("#/runs"), { page: "history", params: {}, redirect: "#/history" });
  assert.deepEqual(route("#/runs/r1"), { page: "run", params: { id: "r1" }, redirect: "#/history/r1" });
});

// ---------- Task 3: hybrid paging ----------

const paging = require(SRC + "paging.js");

function entities(n, valueOf) {
  const out = {};
  for (let i = 0; i < n; i++) {
    const key = "k" + String(i).padStart(5, "0");
    out["entities/role--" + key] = { type: "role", key, status: "active", lastSeen: valueOf(i), seenCount: 1 };
  }
  return out;
}

async function walk(store, sort, base = { where: [["type", "==", "role"]] }) {
  const seen = [];
  let after = null, done = false, guard = 0;
  while (!done && guard++ < 200) {
    const page = await paging.nextPage(store, "entities", base, sort, after);
    seen.push(...page.rows.map((r) => r.id));
    after = page.after; done = page.done;
  }
  return seen;
}

test("paging: ties straddling a page boundary are neither skipped nor repeated", async () => {
  // 250 rows; rows 40..159 share one lastSeen, so the first boundary (row 100) falls inside the tie.
  const store = fakeStore(entities(250, (i) => i >= 40 && i < 160 ? "2026-10-20" : "2026-10-" + String(i < 40 ? 29 - (i % 5) : 10 - (i % 5)).padStart(2, "0")));
  const ids = await walk(store, { field: "lastSeen", dir: "desc" });
  assert.equal(ids.length, 250);
  assert.equal(new Set(ids).size, 250);
  const vals = ids.map((id) => store.data.get("entities/" + id).lastSeen);
  for (let i = 1; i < vals.length; i++) assert.ok(vals[i - 1] >= vals[i], "newest first at " + i);
});

test("paging: one value shared by more rows than a read returns still walks every row once", async () => {
  const store = fakeStore(entities(2300, (i) => i < 2100 ? "2026-10-20" : "2026-10-0" + (i % 9 + 1)));
  const ids = await walk(store, { field: "lastSeen", dir: "desc" });
  assert.equal(ids.length, 2300);
  assert.equal(new Set(ids).size, 2300);
});

test("paging: ascending order and a first page that is short says done", async () => {
  const store = fakeStore(entities(30, (i) => i % 3));
  const page = await paging.nextPage(store, "entities", { where: [] }, { field: "lastSeen", dir: "asc" }, null);
  assert.equal(page.rows.length, 30);
  assert.equal(page.done, true);
  const ids = await walk(fakeStore(entities(330, (i) => i % 4)), { field: "lastSeen", dir: "asc" });
  assert.equal(new Set(ids).size, 330);
  assert.equal(ids.length, 330);
});

test("paging: page queries stay inside the store limits", async () => {
  const store = fakeStore(entities(500, () => "same"));
  const seenQ = [];
  const list = store.list.bind(store);
  store.list = (c, q) => { seenQ.push(q); return list(c, q); };
  await walk(store, { field: "lastSeen", dir: "desc" });
  for (const q of seenQ) {
    assert.ok(q.limit >= 1 && q.limit <= 1000, "limit " + q.limit);
    assert.ok((q.where || []).length <= 10);
    assert.equal(q.orderBy.length, 2);
  }
});

test("fullRead reads past 1,000 rows with no cursor and no duplicates", async () => {
  const store = fakeStore(entities(2500, (i) => i % 7));
  const rows = await paging.fullRead(store, "entities", { where: [["type", "==", "role"]] });
  assert.equal(rows.length, 2500);
  assert.equal(new Set(rows.map((r) => r.id)).size, 2500);
  assert.equal(store.reads, 3);
});

// db.d.ts: one orderBy, limit applied after the sort, tie order unspecified. This store shuffles every run of
// equal sort values on every read, so paging may not lean on ties coming back in id order.
function unorderedTies(store, seed = 7) {
  let s = seed;
  const rand = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const list = store.list.bind(store);
  store.list = async (coll, q = {}) => {
    const rows = await list(coll, { ...q, limit: undefined });
    if (q.orderBy) {
      const f = q.orderBy[0];
      for (let i = 0; i < rows.length;) {
        let j = i;
        while (j < rows.length && rows[j].data[f] === rows[i].data[f]) j++;
        for (let k = j - 1; k > i; k--) { const r = i + Math.floor(rand() * (k - i + 1)); [rows[k], rows[r]] = [rows[r], rows[k]]; }
        i = j;
      }
    }
    return q.limit ? rows.slice(0, q.limit) : rows;
  };
  return store;
}

test("paging: shuffled tie order on every read still walks every row once, in order", async () => {
  for (const [n, valueOf] of [[1200, (i) => "2026-10-0" + (i % 6 + 1)], [2300, (i) => i < 2100 ? "2026-10-20" : "2026-10-0" + (i % 9 + 1)], [450, (i) => i % 250]]) {
    for (const dir of ["desc", "asc"]) {
      const store = unorderedTies(fakeStore(entities(n, valueOf)));
      const ids = await walk(store, { field: "lastSeen", dir });
      assert.equal(new Set(ids).size, n, n + " " + dir + " unique");
      assert.equal(ids.length, n, n + " " + dir + " complete");
      const vals = ids.map((id) => store.data.get("entities/" + id).lastSeen);
      for (let i = 1; i < vals.length; i++) assert.ok(dir === "desc" ? vals[i - 1] >= vals[i] : vals[i - 1] <= vals[i], dir + " order at " + i);
    }
  }
});

test("paging: fillPage over shuffled ties with hidden rows keeps 100 to 199 a page, skipping and repeating none", async () => {
  const n = 1500;
  const store = unorderedTies(fakeStore(entities(n, (i) => "2026-10-" + String(10 + (i % 4)))));
  const keep = (r) => Number(r.data.key.slice(1)) % 10 >= 7; // the overlay hides seven rows in ten
  const shown = [];
  let after = null, done = false, guard = 0;
  while (!done && guard++ < 100) {
    const page = await browse.fillPage(() => paging.nextPage(store, "entities", { where: [] }, { field: "lastSeen", dir: "desc" }, after)
      .then((p) => { after = p.after; return p; }), keep, 100);
    assert.ok(page.rows.length < 200, "page of " + page.rows.length);
    if (!page.done) assert.ok(page.rows.length >= 100, "short page before the end: " + page.rows.length);
    shown.push(...page.rows.map((r) => r.id));
    done = page.done;
  }
  assert.equal(shown.length, n * 0.3);
  assert.equal(new Set(shown).size, n * 0.3);
});

// ---------- Task 4: drop overlay, refill, restore ----------

const browse = require(SRC + "pages/browse.js");

test("overlayStatus puts a person's drop on top of the stored status until the next run", () => {
  assert.equal(browse.overlayStatus("active", null), "active");
  assert.equal(browse.overlayStatus("active", { decision: "drop" }), "drop-pending");
  assert.equal(browse.overlayStatus("dropped", { decision: "drop" }), "dropped");
  assert.equal(browse.overlayStatus("dropped", { decision: "keep" }), "kept-pending");
  assert.equal(browse.overlayStatus("active", { decision: "keep" }), "active");
  assert.equal(browse.overlayStatus("dropped", null), "dropped");
});

test("fillPage keeps reading until the overlay leaves a full page or the store runs out", async () => {
  let calls = 0;
  const pages = [0, 1, 2, 3].map((p) => Array.from({ length: 100 }, (_, i) => ({ id: "r" + (p * 100 + i) })));
  const fetch = () => { const rows = pages[calls] || []; calls++; return Promise.resolve({ rows, done: calls >= pages.length }); };
  const hidden = (r) => Number(r.id.slice(1)) % 100 >= 40; // the overlay hides 60 of each 100
  const got = await browse.fillPage(fetch, (r) => !hidden(r), 100);
  assert.equal(calls, 3);
  assert.equal(got.rows.length, 120);
  assert.equal(got.done, false);
  calls = 0;
  const all = await browse.fillPage(fetch, () => false, 100);
  assert.equal(all.rows.length, 0);
  assert.equal(all.done, true);
  assert.equal(calls, 4);
});

test("needsFullRead: meta filters page from the store, field, text, tag and star filters read everything", () => {
  const fs = (q) => browse.readFilterState(q);
  assert.equal(browse.needsFullRead(fs({})), false);
  assert.equal(browse.needsFullRead(fs({ status: "dropped", reason: "excluded company" })), false);
  assert.equal(browse.needsFullRead(fs({ window: "week" })), false);
  assert.equal(browse.needsFullRead(fs({ sort: "seenCount:desc" })), false);
  for (const q of [{ q: "shop" }, { tag: "x" }, { starred: "1" }, { "f.country": "AU" }, { sort: "title:asc" }, { source: "jobs-watch" }, { window: "week", sort: "firstSeen:desc" }]) {
    assert.equal(browse.needsFullRead(fs(q)), true, JSON.stringify(q));
  }
});

test("pagedBase turns status, reason and date windows into store filters", () => {
  const now = "2026-10-30T12:00:00Z";
  assert.deepEqual(browse.pagedBase("role", browse.readFilterState({}), now).where, [["type", "==", "role"], ["status", "==", "active"]]);
  const w = browse.pagedBase("role", browse.readFilterState({ status: "dropped", reason: "r", window: "last-month" }), now).where;
  assert.deepEqual(w, [["type", "==", "role"], ["status", "==", "dropped"], ["dropReason", "==", "r"],
    ["lastSeen", ">=", "2026-09-01T00:00:00.000Z"], ["lastSeen", "<", "2026-10-01T00:00:00.000Z"]]);
  assert.deepEqual(browse.pagedBase("role", browse.readFilterState({ status: "all", window: "week" }), now).where,
    [["type", "==", "role"], ["lastSeen", ">=", "2026-10-23T12:00:00.000Z"], ["lastSeen", "<=", "2026-10-30T12:00:00.000Z"]]);
});

test("drop writes a decision with reason; restore undoes a person's drop and keeps a routine's drop", async () => {
  const store = fakeStore({});
  const ctx = { store, viewer: "u_1" };
  await actions.dropRecord(ctx, "role--a", "too junior");
  const [op, path, d] = store.log[0];
  assert.equal(op, "set"); assert.equal(path, "decisions/role--a");
  assert.equal(d.decision, "drop"); assert.equal(d.reason, "too junior"); assert.equal(d.by, "u_1"); assert.ok(d.at);
  await actions.restoreRecord(ctx, "role--a", { decision: "drop" });
  assert.deepEqual(store.log[1], ["del", "decisions/role--a"]);
  await actions.restoreRecord(ctx, "role--b", null);
  assert.equal(store.log[2][1], "decisions/role--b");
  assert.equal(store.log[2][2].decision, "keep");
  await assert.rejects(() => actions.dropRecord(ctx, "role--c", "  "), /reason/);
});

// ---------- Task 6: merge field choices ----------

const entity = require(SRC + "pages/entity.js");

test("mergeChoices lists only the declared fields whose values differ, defaulting to the kept record", () => {
  const t = { fields: { title: { label: "Title" }, country: { label: "Country" }, pay: { label: "Pay" } }, order: ["title", "country", "pay"] };
  const from = { display: { title: "Staff engineer", country: "AU", pay: 100 } };
  const into = { display: { title: "Staff Engineer", country: "AU" } };
  const rows = entity.mergeChoices(t, from, into);
  assert.deepEqual(rows.map((r) => [r.field, r.label, r.from, r.into, r.pick]),
    [["title", "Title", "Staff engineer", "Staff Engineer", "into"], ["pay", "Pay", 100, undefined, "into"]]);
});

test("mergeDoc stores only the fields picked from the merged-away record", () => {
  const rows = [{ field: "title", from: "A", into: "B", pick: "from" }, { field: "pay", from: 1, into: 2, pick: "into" }];
  assert.deepEqual(entity.mergeDoc("role--b", rows, { at: "t", by: "u_1" }), { into: "role--b", at: "t", by: "u_1", fields: { title: "A" } });
  assert.deepEqual(entity.mergeDoc("role--b", [], { at: "t", by: "u_1" }), { into: "role--b", at: "t", by: "u_1" });
});

test("keepState reads a person's drop decision: pending until the run, then dropped by a person", () => {
  const DROP = { decision: "drop", reason: "too junior" };
  assert.equal(entity.keepState({ status: "active", sightings: [] }, DROP), "person-drop-pending");
  assert.equal(entity.keepState({ status: "dropped", sightings: [] }, DROP), "person-dropped");
});

// ---------- Task 7: bulk actions ----------

// bulk.js reads isQuota and QUOTA_NOTE as page globals, as the bundle provides them.
Object.assign(globalThis, { isQuota: actions.isQuota, QUOTA_NOTE: actions.QUOTA_NOTE });
const bulk = require(SRC + "bulk.js");

test("checkScope refuses more than 1,000 records with the reason, and nothing", () => {
  assert.equal(bulk.BULK_CAP, 1000);
  assert.equal(bulk.UNDO_MS, 10000);
  assert.deepEqual(bulk.checkScope(1000), { ok: true, reason: null });
  const over = bulk.checkScope(1001);
  assert.equal(over.ok, false);
  assert.match(over.reason, /1,001 records.*1,000/);
  assert.equal(bulk.checkScope(0).ok, false);
});

test("runBulk writes one at a time, reports which failed, and counts a quota error as failed", async () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ id: "r" + i, name: "Role " + i }));
  let active = 0, peak = 0;
  const progress = [];
  const res = await bulk.runBulk(items, async (it) => {
    active++; peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 1));
    active--;
    if (it.id === "r3") throw new Error("version conflict");
    if (it.id === "r7") { const e = new Error("full"); e.code = "quota_exceeded"; throw e; }
  }, (n, total) => progress.push([n, total]));
  assert.equal(peak, 1);
  assert.deepEqual(res.done, ["r0", "r1", "r2", "r4", "r5", "r6", "r8", "r9"]);
  assert.deepEqual(res.failed.map((f) => f.id), ["r3", "r7"]);
  assert.equal(res.failed[1].message, actions.QUOTA_NOTE);
  assert.deepEqual(progress.at(-1), [10, 10]);
  const s = bulk.bulkSummary(res, items);
  assert.equal(s, "Done 8, failed 2: Role 3, Role 7.");
  assert.equal(bulk.bulkSummary({ done: ["r0"], failed: [] }, items), "Done 1.");
});

test("undoBulk reverts only the ids that succeeded and reports an undo that fails", async () => {
  const reverted = [];
  const res = await bulk.undoBulk(["r0", "r2", "r4"], async (id) => {
    if (id === "r2") throw new Error("gone");
    reverted.push(id);
  });
  assert.deepEqual(reverted, ["r0", "r4"]);
  assert.deepEqual(res.failed.map((f) => f.id), ["r2"]);
});

test("rangeSelect selects every id between the anchor and the target, either direction", () => {
  const ids = ["a", "b", "c", "d", "e"];
  assert.deepEqual([...bulk.rangeSelect(ids, "b", "d", new Set())].sort(), ["b", "c", "d"]);
  assert.deepEqual([...bulk.rangeSelect(ids, "e", "c", new Set(["a"]))].sort(), ["a", "c", "d", "e"]);
  assert.deepEqual([...bulk.rangeSelect(ids, null, "c", new Set())], ["c"]);
});

// ---------- Task 8: views ownership, duplicate, pin, modified ----------

const views = require(SRC + "pages/views.js");

test("canEditView: the creator, or anyone for agent, definition and pre-v2 views", () => {
  assert.equal(views.canEditView({ madeBy: "u_1" }, "u_1"), true);
  assert.equal(views.canEditView({ madeBy: "u_1" }, "u_2"), false);
  assert.equal(views.canEditView({ madeBy: "u_1" }, null), false);
  for (const madeBy of ["agent", "definition", "human", undefined]) assert.equal(views.canEditView({ madeBy }, "u_2"), true, String(madeBy));
});

test("a new view records its creator's viewer id; saving over keeps the creator", () => {
  const fs = views.viewToFilterState({ filters: { status: "active" } });
  const fresh = views.viewDoc(fs, { type: "role", name: "Mine", at: "t1", by: "u_1" });
  assert.equal(fresh.madeBy, "u_1");
  assert.equal(fresh.createdAt, "t1");
  const over = views.viewDoc(fs, { type: "role", name: "Mine 2", base: fresh, at: "t2", by: "u_1" });
  assert.equal(over.madeBy, "u_1");
});

test("duplicateView makes a view the duplicator owns, never a proposal, without the producer", () => {
  const src = { name: "Hiring", type: "role", madeBy: "agent", producer: "jobs-watch", state: "proposed", filters: { status: "active" }, sort: { field: "lastSeen", dir: "desc" } };
  const d = views.duplicateView(src, "u_2", "t3");
  assert.equal(d.name, "Hiring (copy)");
  assert.equal(d.madeBy, "u_2");
  assert.equal(d.state, "kept");
  assert.equal("producer" in d, false);
  assert.equal(d.createdAt, "t3");
  assert.deepEqual(d.filters, { status: "active" });
  assert.deepEqual(src.filters, { status: "active" });
});

test("isModified is true only when the filters differ from the saved view", () => {
  const v = { filters: { status: "active" }, window: "all", sort: { field: "lastSeen", dir: "desc" }, group: "", columns: null };
  const fs = views.viewToFilterState(v);
  assert.equal(views.isModified(v, fs), false);
  assert.equal(views.isModified(v, Object.assign({}, fs, { status: "dropped" })), true);
  assert.equal(views.isModified(v, Object.assign({}, fs, { sort: { field: "seenCount", dir: "desc" } })), true);
  assert.equal(views.isModified(null, fs), false);
});

test("pinnedFirst puts the viewer's pinned views first, each group kept in its order", () => {
  const vs = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  assert.deepEqual(views.pinnedFirst(vs, new Set(["c", "a"])).map((v) => v.id), ["a", "c", "b", "d"]);
  assert.deepEqual(views.pinnedFirst(vs, new Set()).map((v) => v.id), ["a", "b", "c", "d"]);
});

test("a pin is per viewer under data/users/<viewer>/state/pin/<viewId>", () => {
  assert.equal(actions.viewerPath("u_1", "pin", "v-1"), "data/users/u_1/state/pin/v-1");
});

// ---------- Task 9: inbox snooze, mark all read, Suggestions tab ----------

const inbox = require(SRC + "pages/inbox.js");

test("snoozeUntil: 1, 3 and 7 days from now, or the start of a chosen local date", () => {
  const now = new Date("2026-10-30T09:00:00Z");
  assert.equal(inbox.snoozeUntil("1d", now), "2026-10-31T09:00:00.000Z");
  assert.equal(inbox.snoozeUntil("3d", now), "2026-11-02T09:00:00.000Z");
  assert.equal(inbox.snoozeUntil("7d", now), "2026-11-06T09:00:00.000Z");
  assert.equal(inbox.snoozeUntil("2026-11-10", now), new Date(2026, 10, 10).toISOString());
  assert.equal(inbox.snoozeUntil("2026-10-01", now), null);
  assert.equal(inbox.snoozeUntil("soon", now), null);
});

test("snoozeItem writes the viewer's snooze doc {until, at, by}", async () => {
  const store = fakeStore({});
  const ctx = { store, viewer: "u_1", now: () => "2026-10-30T09:00:00Z" };
  await actions.snoozeItem(ctx, "r6--1", "2026-10-31T09:00:00.000Z");
  const d = store.data.get("data/users/u_1/state/snooze/r6--1");
  assert.equal(d.until, "2026-10-31T09:00:00.000Z");
  assert.equal(d.by, "u_1");
  assert.ok(d.at);
});

test("inboxList hides items snoozed into the future, shows them under Snoozed, and brings them back once due", () => {
  const msgs = [doc("m1", { createdAt: "2026-10-03" }), doc("m2", { createdAt: "2026-10-02" }), doc("m3", { createdAt: "2026-10-01" })];
  const st = { read: new Set(), done: new Set(), snooze: new Map([["m1", "2026-10-31T00:00:00Z"], ["m2", "2026-10-29T00:00:00Z"]]) };
  const now = "2026-10-30T09:00:00Z";
  assert.deepEqual(inbox.inboxList(msgs, st, "all", now).map((m) => m.id), ["m2", "m3"]);
  assert.deepEqual(inbox.inboxList(msgs, st, "unread", now).map((m) => m.id), ["m2", "m3"]);
  assert.deepEqual(inbox.inboxList(msgs, st, "snoozed", now).map((m) => m.id), ["m1"]);
  assert.deepEqual(inbox.inboxList(msgs, null, "all", now).map((m) => m.id), ["m1", "m2", "m3"]);
});

test("unreadIds lists what Mark all read would write: shown, not read, not done", () => {
  const shown = [doc("m1", {}), doc("m2", {}), doc("m3", {})];
  assert.deepEqual(inbox.unreadIds(shown, { read: new Set(["m2"]), done: new Set(["m3"]) }), ["m1"]);
});

test("the inbox route reads its tab from the query", () => {
  assert.equal(inbox.inboxTab({ query: { tab: "suggestions" } }), "suggestions");
  assert.equal(inbox.inboxTab({}), "inbox");
  assert.equal(inbox.inboxTab({ query: { tab: "nope" } }), "inbox");
});

// ---------- Task 10: approvals ----------

Object.assign(globalThis, { decide: actions.decide });
const approvals = require(SRC + "pages/approvals.js");

test("timeLeft counts down from createdAt plus timeoutHours", () => {
  const g = { createdAt: "2026-10-30T00:00:00Z", timeoutHours: 48 };
  assert.deepEqual(approvals.timeLeft(g, Date.parse("2026-10-30T09:30:00Z")), { hours: 38.5, label: "38h 30m left" });
  assert.equal(approvals.timeLeft(g, Date.parse("2026-11-01T00:00:00Z")).label, "Expired");
  assert.equal(approvals.timeLeft(g, Date.parse("2026-10-31T23:15:00Z")).label, "45m left");
  assert.equal(approvals.timeLeft({ createdAt: "2026-10-30T00:00:00Z" }, 0).label, "No timeout");
});

test("approvalLists: pending gates without a decision wait, soonest timeout first; the rest are decided, newest first", () => {
  const pending = [
    doc("r1--g1", { status: "pending", createdAt: "2026-10-28T00:00:00Z", timeoutHours: 48 }),
    doc("r2--g1", { status: "pending", createdAt: "2026-10-29T00:00:00Z", timeoutHours: 12 }),
    doc("r3--g1", { status: "pending", createdAt: "2026-10-27T00:00:00Z", timeoutHours: 48 }),
    doc("r0--g1", { status: "approved", outcome: "approve", createdAt: "2026-10-20T00:00:00Z" }),
  ];
  const decisions = { "r3--g1": { decision: "reject", reason: "Too early", at: "2026-10-28T10:00:00Z", by: "u_2" } };
  const l = approvals.approvalLists(pending, decisions, Date.parse("2026-10-29T06:00:00Z"));
  assert.deepEqual(l.waiting.map((g) => g.id), ["r2--g1", "r1--g1"]);
  assert.deepEqual(l.decided.map((g) => g.id), ["r3--g1", "r0--g1"]);
  assert.equal(l.decided[0].decision.reason, "Too early");
});

test("approveGate records the edited draft only when it differs from the gate's own", async () => {
  const store = fakeStore({});
  const ctx = { store, viewer: "u_1" };
  const gate = { draft: { subject: "Intro", body: "Hello" } };
  await approvals.approveGate(ctx, "r1--g1", gate, { subject: "Intro", body: "Hello" });
  assert.equal("draft" in store.data.get("decisions/r1--g1"), false);
  await approvals.approveGate(ctx, "r1--g2", gate, { subject: "Intro", body: "Hello there" });
  const d = store.data.get("decisions/r1--g2");
  assert.equal(d.decision, "approve");
  assert.deepEqual(d.draft, { subject: "Intro", body: "Hello there" });
  assert.equal(d.by, "u_1");
});

test("approveGate refuses a gate that timed out after the card was drawn", async () => {
  const store = fakeStore({});
  const ctx = { store, viewer: "u_1" };
  const gate = { createdAt: "2020-01-01T00:00:00Z", timeoutHours: 1 };
  await assert.rejects(approvals.approveGate(ctx, "r1--g1", gate, null), /timed out/);
  assert.equal(store.data.has("decisions/r1--g1"), false);
});

test("id-keyed maps: a doc called __proto__ or constructor is just a doc", () => {
  const map = actions.byId([{ id: "__proto__", data: { decision: "drop" } }, { id: "r1", data: { decision: "keep" } }]);
  assert.equal(map.r2, undefined);
  assert.equal(map.constructor, undefined);
  assert.deepEqual(map.__proto__, { decision: "drop" });
  assert.equal(map.r1.decision, "keep");
});

test("rejectGate needs a reason and records it", async () => {
  const store = fakeStore({});
  const ctx = { store, viewer: "u_1" };
  await assert.rejects(approvals.rejectGate(ctx, "r1--g1", "  "), /reason/);
  await approvals.rejectGate(ctx, "r1--g1", "Too early");
  assert.equal(store.data.get("decisions/r1--g1").reason, "Too early");
  assert.equal(store.data.get("decisions/r1--g1").decision, "reject");
});

test("recipientLine shows roles only", () => {
  assert.equal(approvals.recipientLine([{ role: "Head of Ecommerce" }, { role: "CTO" }]), "To: Head of Ecommerce, CTO (by role)");
  assert.equal(approvals.recipientLine(undefined), "");
});

// ---------- Task 11: notifications ----------

const runsPage = require(SRC + "pages/runs.js");
Object.assign(globalThis, { isLate: runsPage.isLate, timeLeft: approvals.timeLeft });
const notify = require(SRC + "notify.js");
const NOW = Date.parse("2026-10-30T12:00:00Z");

test("notifications: new inbox items, unread from the viewer's read state, older than the window left out", () => {
  const items = notify.deriveNotifications({
    inbox: [doc("r1--1", { kind: "match", title: "Role A", createdAt: "2026-10-30T10:00:00Z" }),
      doc("r1--2", { kind: "alert", title: "Feed down", createdAt: "2026-10-29T10:00:00Z" }),
      doc("r0--1", { kind: "match", title: "Old", createdAt: "2026-10-01T10:00:00Z" })],
    read: new Set(["r1--2"]), now: NOW,
  });
  assert.deepEqual(items.map((n) => [n.kind, n.readId, n.unread]), [["inbox", "r1--1", true], ["inbox", "r1--2", false]]);
  assert.equal(items[0].title, "Role A");
  assert.equal(items[0].href, "#/inbox");
});

test("notifications: a waiting gate, a gate under 6 hours is gate-soon, decided and expired gates left out", () => {
  const pending = [
    doc("r1--g1", { status: "pending", title: "Send digest", createdAt: "2026-10-30T00:00:00Z", timeoutHours: 48 }),
    doc("r1--g2", { status: "pending", title: "Send now", createdAt: "2026-10-29T14:00:00Z", timeoutHours: 24 }),
    doc("r1--g3", { status: "pending", title: "Decided", createdAt: "2026-10-30T00:00:00Z" }),
    doc("r1--g4", { status: "pending", title: "Expired", createdAt: "2026-10-20T00:00:00Z", timeoutHours: 1 }),
    doc("r1--g5", { status: "expired", title: "Closed", createdAt: "2026-10-30T00:00:00Z" }),
  ];
  const items = notify.deriveNotifications({ pending, decisions: new Set(["r1--g3"]), now: NOW });
  const byId = Object.fromEntries(items.map((n) => [n.readId, n]));
  assert.deepEqual(Object.keys(byId).sort(), ["r1--g1", "soon--r1--g2"]);
  assert.equal(byId["r1--g1"].kind, "gate");
  assert.equal(byId["soon--r1--g2"].kind, "gate-soon");
  assert.match(byId["soon--r1--g2"].title, /2h 00m left/);
  assert.equal(byId["r1--g1"].href, "#/approvals");
});

test("notifications: failed runs, a late producer and a run that hit the inbox cap", () => {
  const runs = [
    doc("r3", { producer: "a", status: "failed", startedAt: "2026-10-30T06:00:00Z" }),
    doc("r2", { producer: "a", status: "ok", startedAt: "2026-10-29T06:00:00Z", inboxSuppressed: 4 }),
    doc("b1", { producer: "b", status: "ok", startedAt: "2026-10-20T06:00:00Z" }),
  ];
  const producers = [{ id: "a", label: "Jobs", schedule: "0 6 * * *" }, { id: "b", label: "Feeds", schedule: "0 6 * * *" }];
  const items = notify.deriveNotifications({ runs, producers, read: new Set(["run--r3"]), now: NOW });
  const kinds = items.map((n) => n.kind + ":" + n.readId);
  assert.ok(kinds.includes("run-failed:run--r3"), kinds.join());
  assert.ok(kinds.includes("cap:cap--r2"), kinds.join());
  assert.ok(kinds.includes("run-late:late--b1"), kinds.join());
  assert.ok(!kinds.some((k) => k.startsWith("run-late:late--r3")), "producer a is on time");
  assert.equal(items.find((n) => n.kind === "run-failed").unread, false);
  assert.match(items.find((n) => n.kind === "cap").title, /4 messages held back/);
  assert.equal(items.find((n) => n.kind === "run-failed").href, "#/history/r3");
});

test("notifications: newest first, unread count and the unread tab", () => {
  const items = notify.deriveNotifications({
    inbox: [doc("i1", { title: "One", createdAt: "2026-10-29T00:00:00Z" }), doc("i2", { title: "Two", createdAt: "2026-10-30T00:00:00Z" })],
    read: new Set(["i2"]), now: NOW,
  });
  assert.deepEqual(items.map((n) => n.readId), ["i2", "i1"]);
  assert.equal(notify.unreadCount(items), 1);
  assert.deepEqual(notify.notifTab(items, "unread").map((n) => n.readId), ["i1"]);
  assert.equal(notify.notifTab(items, "all").length, 2);
  assert.equal(notify.deriveNotifications({ now: NOW }).length, 0);
});

// ---------- Task 12: history and activity ----------

const ui = require(SRC + "ui.js");
Object.assign(globalThis, { entityHash: ui.entityHash });
const history = require(SRC + "pages/history.js");

test("history: runs grouped by UTC day, newest run first within a day", () => {
  const days = history.runsByDay([
    doc("a", { startedAt: "2026-10-29T06:00:00Z" }), doc("b", { startedAt: "2026-10-30T23:30:00Z" }),
    doc("c", { startedAt: "2026-10-30T06:00:00Z" }), doc("d", {}),
  ]);
  assert.deepEqual(Object.keys(days).sort(), ["2026-10-29", "2026-10-30"]);
  assert.deepEqual(days["2026-10-30"].map((r) => r.id), ["b", "c"]);
});

test("history: mode comes from ?mode, list by default, anything else is list", () => {
  assert.equal(history.historyMode({}), "list");
  assert.equal(history.historyMode({ query: { mode: "cal" } }), "cal");
  assert.equal(history.historyMode({ query: { mode: "health" } }), "health");
  assert.equal(history.historyMode({ query: { mode: "activity" } }), "activity");
  assert.equal(history.historyMode({ query: { mode: "x" } }), "list");
});

test("history: calendar weeks run Monday to Sunday and end with the week holding today", () => {
  const weeks = history.calendarWeeks(Date.parse("2026-10-30T12:00:00Z"), 5);
  assert.equal(weeks.length, 5);
  assert.equal(weeks[4][0], "2026-10-26");
  assert.equal(weeks[4][6], "2026-11-01");
  assert.equal(weeks[0][0], "2026-09-28");
});

test("activity: people writes from decisions, settings history, merges and views, newest first", () => {
  const items = history.activityStream({
    decisions: [doc("r1--g1", { decision: "approve", at: "2026-10-30T03:00:00Z", by: "u_1" }),
      doc("role--a1", { decision: "drop", at: "2026-10-30T05:00:00Z", by: "u_2", reason: "Too senior" }),
      doc("r1--3", { decision: "dismiss", at: "2026-10-29T05:00:00Z", by: "u_1" }),
      doc("old", { decision: "keep" })],
    settingsHistory: [doc("h1", { producer: "jobs", before: { a: 1, b: 2 }, after: { a: 1, b: 3 }, at: "2026-10-30T04:00:00Z", by: "u_1" })],
    merges: [doc("role--b", { into: "role--c", at: "2026-10-30T06:00:00Z", by: "u_2" })],
    views: [doc("v1", { name: "Remote", madeBy: "u_1", createdAt: "2026-10-30T01:00:00Z" }), doc("v2", { name: "Agent", madeBy: "agent", createdAt: "2026-10-30T02:00:00Z" })],
  });
  assert.deepEqual(items.map((i) => i.kind), ["merge", "decision", "settings", "decision", "view", "decision"]);
  assert.deepEqual(items.map((i) => i.by), ["u_2", "u_2", "u_1", "u_1", "u_1", "u_1"]);
  assert.equal(items[0].text, "Merged role--b into role--c");
  assert.equal(items[0].href, "#/entity/role/c");
  assert.equal(items[1].text, "Dropped role--a1: Too senior");
  assert.equal(items[2].text, "Changed jobs settings: b");
  assert.equal(items[2].href, "#/settings");
  assert.equal(items[3].text, "Approved r1--g1");
  assert.equal(items[3].href, "#/approvals");
  assert.equal(items[4].text, "Saved view Remote");
  assert.equal(items[5].href, "#/inbox");
});

test("activity: filter by person and by kind", () => {
  const items = [{ by: "u_1", kind: "view" }, { by: "u_2", kind: "view" }, { by: "u_1", kind: "merge" }];
  assert.equal(history.filterActivity(items, {}).length, 3);
  assert.equal(history.filterActivity(items, { by: "u_1" }).length, 2);
  assert.deepEqual(history.filterActivity(items, { by: "u_1", kind: "merge" }), [{ by: "u_1", kind: "merge" }]);
});

test("activity: names come from profiles, never the id; unresolved is Someone, the viewer is you", () => {
  const ctx = { viewer: "u_1" };
  assert.equal(history.personLabel(ctx, { u_2: { name: "Sam" } }, "u_2"), "Sam");
  assert.equal(history.personLabel(ctx, { u_2: { name: "" } }, "u_2"), "Someone");
  assert.equal(history.personLabel(ctx, {}, "u_1"), "you");
  // a forged `by` naming an Object.prototype key is not a profile
  assert.equal(history.personLabel(ctx, {}, "constructor"), "Someone");
  assert.equal(history.personLabel(ctx, {}, "__proto__"), "Someone");
});

// ---------- Task 13: settings history, revert, inline suggestions ----------

test("settings save records {producer, before, after, at, by} after the settings write", async () => {
  const store = fakeStore({ "settings/jobs": { values: { a: 1, b: [1] } } });
  const ctx = { store, viewer: "u_1", definition: { producers: [{ id: "jobs", settings: [{ name: "c", default: 5 }] }] } };
  await actions.writeSettings(ctx, "settings/jobs", { b: [1, 2], c: 6 });
  assert.equal(store.log[0][1], "settings/jobs");
  assert.match(store.log[1][1], /^settingsHistory\/jobs--\d{17}$/);
  const h = store.log[1][2];
  assert.deepEqual([h.producer, h.before, h.after, h.by], ["jobs", { b: [1], c: 5 }, { b: [1, 2], c: 6 }, "u_1"]);
  assert.ok(h.at);
});

test("settings history for the workspace doc uses producer workspace and null for an unset value", async () => {
  const store = fakeStore({});
  await actions.writeSettings({ store, viewer: "u_1", definition: null }, "settings/workspace", { quietHours: { from: "22:00", to: "07:00" } });
  const h = store.log[1][2];
  assert.equal(h.producer, "workspace");
  assert.deepEqual(h.before, { quietHours: null });
});

test("settings history keeps the newest 50 per producer and prunes the rest after a save", async () => {
  const docs = { "settings/jobs": { values: {} } };
  for (let i = 0; i < 52; i++) docs["settingsHistory/jobs--" + String(i).padStart(3, "0")] = { producer: "jobs", at: "2026-10-01T00:00:" + String(i).padStart(2, "0") + ".000Z" };
  docs["settingsHistory/other--1"] = { producer: "other", at: "2026-01-01T00:00:00.000Z" };
  const store = fakeStore(docs);
  await actions.writeSettings({ store, viewer: "u_1", definition: null }, "settings/jobs", { a: 1 });
  const dels = store.log.filter((l) => l[0] === "del").map((l) => l[1]).sort();
  assert.deepEqual(dels, ["settingsHistory/jobs--000", "settingsHistory/jobs--001", "settingsHistory/jobs--002"]);
  assert.equal(actions.HISTORY_CAP, 50);
});

test("historyToPrune returns the ids past the cap, oldest last kept", () => {
  const e = [doc("x", { at: "2026-10-03" }), doc("y", { at: "2026-10-01" }), doc("z", { at: "2026-10-02" })];
  assert.deepEqual(actions.historyToPrune(e, 2), ["y"]);
  assert.deepEqual(actions.historyToPrune(e, 5), []);
});

test("revertChange gives back the before values for the keys the change touched", () => {
  assert.deepEqual(actions.revertChange({ before: { b: [1], c: 5 }, after: { b: [1, 2], c: 6 } }), { b: [1], c: 5 });
  assert.deepEqual(actions.revertChange({ before: {}, after: { a: 1 } }), { a: null });
});

test("a history write that fails after the settings saved says the settings were saved", async () => {
  const store = fakeStore({}, { fail: (p) => p.startsWith("settingsHistory/") });
  await assert.rejects(() => actions.writeSettings({ store, viewer: "u_1", definition: null }, "settings/jobs", { a: 1 }), /Saved\. The change was not added to the settings history/);
  assert.deepEqual(store.data.get("settings/jobs").values, { a: 1 });
});

test("settingSuggestions: open L1 proposals for one setting of one producer", () => {
  const settings = require(SRC + "pages/settings.js");
  const msgs = [
    doc("r1--1", { kind: "proposal", producer: "jobs", proposal: { setting: "title_keywords", op: "add", value: "x" } }),
    doc("r1--2", { kind: "proposal", producer: "jobs", proposal: { setting: "markets", op: "add", value: "NZ" } }),
    doc("r1--3", { kind: "proposal", producer: "other", proposal: { setting: "title_keywords", op: "add", value: "y" } }),
    doc("r1--4", { kind: "match", producer: "jobs" }),
    doc("r1--5", { kind: "proposal", producer: "jobs", proposal: { setting: "title_keywords", op: "add", value: "z" } }),
  ];
  const got = settings.settingSuggestions(msgs, "jobs", "title_keywords", { "r1--5": { decision: "reject" } }, Date.now());
  assert.deepEqual(got.map((m) => m.id), ["r1--1"]);
});

test("a partial save's message is shown as is, not as Not saved", () => {
  const e = new Error("Saved. The change was not added to the settings history: refused"); e.partial = true;
  assert.equal(actions.writeMessage(e), e.message);
});

// Task 15: export
Object.assign(globalThis, { toCsv: require(SRC + "pages/browse.js").toCsv });
const exporter = require(SRC + "exporter.js");

test("exportName: <workspace>-<type plural>-<local YYYY-MM-DD>.<ext>, slugged", () => {
  const d = new Date(2026, 0, 5, 23, 30); // local time
  assert.equal(exporter.exportName("Jobs watch", "Roles", d), "jobs-watch-roles-2026-01-05.csv");
  assert.equal(exporter.exportName("Ops & Sales!", "Hiring Companies", d, "json"), "ops-sales-hiring-companies-2026-01-05.json");
  assert.equal(exporter.exportName("", "", d), "desk-records-2026-01-05.csv");
});

test("exportData: CSV keeps the spreadsheet-safe cells; JSON keys rows by field", () => {
  const cols = [{ key: "title", label: "Title" }, { key: "n", label: "Seen" }];
  const rows = [{ title: "=HYPERLINK(1)", n: 3 }, { title: "a, b", n: null }];
  assert.equal(exporter.exportData(rows, cols, "csv"), "Title,Seen\r\n'=HYPERLINK(1),3\r\n\"a, b\",\r\n");
  assert.deepEqual(JSON.parse(exporter.exportData(rows, cols, "json")), [{ title: "=HYPERLINK(1)", n: 3 }, { title: "a, b", n: null }]);
  assert.throws(() => exporter.exportData(rows, cols, "xml"), /csv or json/);
});

test("downloadToast: declined is quiet; rate limit, too large and unavailable each say what to do", () => {
  assert.deepEqual(exporter.downloadToast({ code: "declined" }), { tone: "quiet", text: "Not saved." });
  assert.match(exporter.downloadToast({ code: "rate_limited" }).text, /Wait a moment/);
  assert.match(exporter.downloadToast({ code: "too_large" }).text, /too large/);
  const off = exporter.downloadToast({ code: "capability_removed" });
  assert.equal(off.hide, true);
  assert.match(off.text, /Copy/);
  assert.equal(exporter.downloadToast({ code: "something_new" }).hide, true);
  assert.equal(exporter.EXPORT_HINT, "You'll be asked to confirm before the file saves.");
});

test("exportScope: the selection when there is one, else the rows on the view", () => {
  const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(exporter.exportScope(rows, new Set(["c", "a"])), { rows: [rows[0], rows[2]], label: "2 selected" });
  assert.deepEqual(exporter.exportScope(rows, new Set()), { rows, label: "3 in this view" });
});

test("canDownload: false without the downloads capability, true with it, false on an error", async () => {
  const { createStore } = require(SRC + "store.js");
  assert.equal(await createStore("static", { docs: [] }).canDownload(), false);
  const mk = (ns) => createStore("db", { claude: { use: (n) => (n === "downloads" ? (ns instanceof Error ? Promise.reject(ns) : Promise.resolve(ns)) : Promise.resolve(null)) } });
  assert.equal(await mk(null).canDownload(), false);
  assert.equal(await mk({ save() {} }).canDownload(), true);
  assert.equal(await mk(new Error("x")).canDownload(), false);
});

// ---------- List page: overlay rows, bulk docs, filter chips, count line ----------

Object.assign(globalThis, { shownReason: actions.shownReason });

test("overlayRow: a pending drop moves an active row to Dropped, a pending keep stays in Dropped", () => {
  const r = browse.toRow(doc("role--a", { key: "a", status: "active" }), {});
  const dropped = browse.overlayRow(r, { decision: "drop", reason: "too junior" });
  assert.equal(dropped.overlay, "drop-pending");
  assert.equal(dropped.status, "dropped");
  assert.equal(dropped.dropReason, "too junior");
  assert.equal(r.status, "active", "the input row is not changed");
  assert.equal(browse.overlayRow(r, null).status, "active");
  const kept = browse.overlayRow(browse.toRow(doc("role--b", { key: "b", status: "dropped", dropReason: "closed" }), {}), { decision: "keep" });
  assert.deepEqual([kept.overlay, kept.status, kept.dropReason], ["kept-pending", "dropped", "closed"]);
  // read straight from decisions/ until the next run, so capped as the contract will cap it
  assert.equal(browse.overlayRow(r, { decision: "drop", reason: "y".repeat(10000) }).dropReason.length, 200);
});

test("userstateAfter: tag, untag, star and unstar change one key and keep the rest", () => {
  const cur = { note: "n", tags: ["a"], star: false };
  assert.deepEqual(browse.userstateAfter(cur, "tag", "b"), { note: "n", tags: ["a", "b"], star: false });
  assert.deepEqual(browse.userstateAfter(cur, "tag", "a").tags, ["a"]);
  assert.deepEqual(browse.userstateAfter(cur, "untag", "a").tags, []);
  assert.equal(browse.userstateAfter(cur, "star").star, true);
  assert.equal(browse.userstateAfter({ star: true }, "unstar").star, false);
  assert.deepEqual(browse.userstateAfter(undefined, "tag", "x"), { tags: ["x"] });
  assert.deepEqual(cur.tags, ["a"], "the input doc is not changed");
  assert.throws(() => browse.userstateAfter(cur, "paint"), /unknown bulk change/);
});

test("filterChips names each active filter and removeChip clears just that one", () => {
  const t = { fields: { market: { label: "Market", type: "choice" } } };
  const fs = browse.readFilterState({ q: "shop", status: "dropped", tag: "hot", window: "week", "f.market": "NZ", starred: "1" });
  const chips = browse.filterChips(fs, t);
  assert.deepEqual(chips.map((c) => c.label), ["Search: shop", "Starred", "Tag: hot", "Last seen: Past 7 days", "Market: NZ"]);
  const less = browse.removeChip(fs, chips.find((c) => c.label === "Market: NZ").key);
  assert.deepEqual(less.fields, {});
  assert.equal(less.q, "shop");
  assert.deepEqual(fs.fields, { market: "NZ" }, "the input state is not changed");
  assert.equal(browse.removeChip(fs, "q").q, "");
  assert.equal(browse.removeChip(fs, "window").window, "all");
  assert.deepEqual(browse.filterChips(browse.readFilterState({}), t), []);
});

test("countLine: a full read counts matches; a paged list says how many are shown and whether more exist", () => {
  assert.equal(browse.countLine({ full: true, shown: 100, matching: 240, total: 400 }, "Roles"), "Showing 100 of 240 matching Roles (400 in all)");
  assert.equal(browse.countLine({ full: false, shown: 100, done: false }, "Roles"), "Showing the first 100 Roles");
  assert.equal(browse.countLine({ full: false, shown: 37, done: true }, "Roles"), "Showing all 37 Roles");
  assert.equal(browse.countLine({ full: false, shown: 1, done: true }, "Roles"), "Showing all 1 Roles");
});
