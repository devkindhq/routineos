// node --test tests/visual/v2.test.mjs  (built-in runner, no packages)
// Desk v2 logic: write paths, routes, paging, overlay, bulk, views, inbox, approvals, notifications,
// history, settings history, export.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const CORE = "../../skills/routineos/assets/desk/core/";
const actions = require(CORE + "actions.js");

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

const { route } = require(CORE + "router.js");

test("v2 routes: approvals, history modes, runs and the per-run page", () => {
  assert.deepEqual(route("#/approvals"), { page: "approvals", params: {} });
  assert.deepEqual(route("#/history"), { page: "history", params: {} });
  assert.deepEqual(route("#/history?mode=cal"), { page: "history", params: { query: { mode: "cal" } } });
  assert.deepEqual(route("#/runs"), { page: "runs", params: {} });
  assert.deepEqual(route("#/runs/r1"), { page: "run", params: { id: "r1" } });
  assert.deepEqual(route("#/runs/r%201?x=1"), { page: "run", params: { id: "r 1", query: { x: "1" } } });
});

// Package 2 (spec 4.4 and Review Focus 5): one row per redirect, queries kept, path-form settings.
test("old addresses redirect to the v2 routes and keep their queries", () => {
  const rows = [
    ["#/inbox", "#/approvals", "approvals"],
    ["#/inbox?tab=suggestions", "#/approvals?kind=proposals", "approvals"],
    ["#/inbox?tab=suggestions&r=x1", "#/approvals?kind=proposals&r=x1", "approvals"],
    ["#/suggestions", "#/approvals?kind=proposals", "approvals"],
    ["#/views", "#/settings/views", "settings"],
    ["#/history/jobs-watch-20261027", "#/runs/jobs-watch-20261027", "run"],
    ["#/history/jobs-watch-20261027?x=1", "#/runs/jobs-watch-20261027?x=1", "run"],
    ["#/settings?section=routine", "#/settings/routine", "settings"],
    ["#/settings?section=notifications&x=2", "#/settings/notifications?x=2", "settings"],
  ];
  for (const [from, to, page] of rows) {
    const r = route(from);
    assert.equal(r.redirect, to, from);
    assert.equal(r.page, page, from);
    // the target itself is final: no second redirect
    assert.equal(route(to).redirect, undefined, to);
  }
  assert.deepEqual(route("#/history/jobs-watch-20261027?x=1").params, { id: "jobs-watch-20261027", query: { x: "1" } });
});

test("settings sections are path form; unknown and missing sections are appearance", () => {
  assert.deepEqual(route("#/settings"), { page: "settings", params: { section: "appearance" } });
  assert.deepEqual(route("#/settings/members"), { page: "settings", params: { section: "members" } });
  assert.deepEqual(route("#/settings/nope"), { page: "settings", params: { section: "appearance" } });
  assert.equal(route("#/settings/nope").redirect, undefined);
  const { SETTINGS_SECTIONS } = require(CORE + "router.js");
  assert.deepEqual(SETTINGS_SECTIONS, ["appearance", "notifications", "shortcuts", "routine", "routine-notifications", "members",
    "modules", "views", "tour", "lock", "export", "history", "about"]);
  for (const s of SETTINGS_SECTIONS) assert.equal(route("#/settings/" + s).params.section, s);
});

test("approvals: ?t= is an alias of ?tab=, and ?tab= wins when both are given", () => {
  assert.equal(route("#/approvals?t=queued").params.query.tab, "queued");
  assert.equal(route("#/approvals?t=queued&tab=done").params.query.tab, "done");
  assert.equal(route("#/approvals?t=queued").redirect, undefined);
});

// ---------- Task 3: hybrid paging ----------

const paging = require(CORE + "paging.js");

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

const browse = require(CORE + "pages/browse.js");

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

const entity = require(CORE + "pages/entity.js");
// entity.js calls the record helpers that moved to shared.js (spec 7.3) as globals, as in the bundle.
Object.assign(globalThis, require(CORE + "shared.js"));

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
const bulk = require(CORE + "bulk.js");

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

const views = require(CORE + "pages/settings.js");

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


test("snoozeItem writes the viewer's snooze doc {until, at, by}", async () => {
  const store = fakeStore({});
  const ctx = { store, viewer: "u_1", now: () => "2026-10-30T09:00:00Z" };
  await actions.snoozeItem(ctx, "r6--1", "2026-10-31T09:00:00.000Z");
  const d = store.data.get("data/users/u_1/state/snooze/r6--1");
  assert.equal(d.until, "2026-10-31T09:00:00.000Z");
  assert.equal(d.by, "u_1");
  assert.ok(d.at);
});

// ---------- Task 10: approvals ----------

Object.assign(globalThis, { decide: actions.decide });
const approvals = require(CORE + "pages/approvals.js");

test("timeLeft counts down from createdAt plus timeoutHours", () => {
  const g = { createdAt: "2026-10-30T00:00:00Z", timeoutHours: 48 };
  assert.deepEqual(approvals.timeLeft(g, Date.parse("2026-10-30T09:30:00Z")), { hours: 38.5, label: "38h 30m left" });
  assert.equal(approvals.timeLeft(g, Date.parse("2026-11-01T00:00:00Z")).label, "Expired");
  assert.equal(approvals.timeLeft(g, Date.parse("2026-10-31T23:15:00Z")).label, "45m left");
  assert.equal(approvals.timeLeft({ createdAt: "2026-10-30T00:00:00Z" }, 0).label, "No timeout");
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

test("rejectGate takes an optional reason and records it as the reason and the note", async () => {
  const store = fakeStore({});
  const ctx = { store, viewer: "u_1" };
  await approvals.rejectGate(ctx, "r1--g1", "  ");
  assert.equal(store.data.get("decisions/r1--g1").decision, "reject");
  assert.equal("reason" in store.data.get("decisions/r1--g1"), false);
  assert.equal("note" in store.data.get("decisions/r1--g1"), false);
  await approvals.rejectGate(ctx, "r1--g2", " Too early ");
  assert.equal(store.data.get("decisions/r1--g2").reason, "Too early");
  assert.equal(store.data.get("decisions/r1--g2").note, "Too early");
});

test("approveGate records the person's note, trimmed and capped at 2000 characters", async () => {
  const store = fakeStore({});
  const ctx = { store, viewer: "u_1" };
  await approvals.approveGate(ctx, "r1--g1", {}, null, "  Send after nine  ");
  assert.equal(store.data.get("decisions/r1--g1").note, "Send after nine");
  await approvals.approveGate(ctx, "r1--g2", {}, null, "");
  assert.equal("note" in store.data.get("decisions/r1--g2"), false);
  await approvals.approveGate(ctx, "r1--g3", {}, null, "x".repeat(2100));
  assert.equal(store.data.get("decisions/r1--g3").note.length, 2000);
});

test("recipientLine shows roles only", () => {
  assert.equal(approvals.recipientLine([{ role: "Head of Ecommerce" }, { role: "CTO" }]), "To: Head of Ecommerce, CTO (by role)");
  assert.equal(approvals.recipientLine(undefined), "");
});

// ---------- Task 11: notifications ----------

const scheduleJs = require(CORE + "schedule.js");
Object.assign(globalThis, { isLate: scheduleJs.isLate, timeLeft: approvals.timeLeft }, require(CORE + "requests.js"));
const notify = require(CORE + "notify.js");
const NOW = Date.parse("2026-10-30T12:00:00Z");

test("notifications: match and alert messages, unread from the viewer's read state, older than the window left out", () => {
  const items = notify.deriveNotifications({
    inbox: [doc("r1--1", { kind: "match", title: "Role A", createdAt: "2026-10-30T10:00:00Z" }),
      doc("r1--2", { kind: "alert", title: "Feed down", createdAt: "2026-10-29T10:00:00Z" }),
      doc("r1--3", { kind: "proposal", title: "Add a market", createdAt: "2026-10-30T10:00:00Z" }),
      doc("r1--4", { kind: "approval", gate: "r1--g1", title: "Send it", createdAt: "2026-10-30T10:00:00Z" }),
      doc("r0--1", { kind: "match", title: "Old", createdAt: "2026-10-01T10:00:00Z" })],
    read: new Set(["r1--2"]), now: NOW,
  });
  assert.deepEqual(items.map((n) => [n.kind, n.readId, n.unread]), [["inbox", "r1--1", true], ["inbox", "r1--2", false]]);
  assert.equal(items[0].title, "Role A");
  assert.equal(items[0].href, "#/today");
});

test("notifications: gates never become bell items; waitingSummary counts them and flags the soonest", () => {
  const pending = [
    doc("r1--g1", { status: "pending", title: "Send digest", createdAt: "2026-10-30T00:00:00Z", timeoutHours: 48 }),
    doc("r1--g2", { status: "pending", title: "Send now", createdAt: "2026-10-29T14:00:00Z", timeoutHours: 24 }),
    doc("r1--g3", { status: "pending", title: "Decided", createdAt: "2026-10-30T00:00:00Z" }),
    doc("r1--g4", { status: "pending", title: "Expired", createdAt: "2026-10-20T00:00:00Z", timeoutHours: 1 }),
    doc("r1--g5", { status: "expired", title: "Closed", createdAt: "2026-10-30T00:00:00Z" }),
  ];
  const src = { pending, decisions: [doc("r1--g3", { decision: "approve", at: "2026-10-30T01:00:00Z" })], now: NOW };
  // UX review 7: a request that timed out recently is a "missed" bell item; an old one is not.
  assert.deepEqual(notify.deriveNotifications(Object.assign({}, src, { decisions: new Set(["r1--g3"]) })).map((n) => [n.kind, n.readId]),
    [["missed", "missed--r1--g5"]]);
  assert.deepEqual(notify.waitingSummary(src, NOW), { count: 2, soon: { label: "1 times out in 2 hours" } });
  assert.deepEqual(notify.waitingSummary({ pending: pending.slice(0, 1) }, NOW), { count: 1, soon: null });
  assert.deepEqual(notify.waitingSummary({}, NOW), { count: 0, soon: null });
});

// UX review 4 and 7: one "needs you" number on the bell, and a missed request says so.
test("bellBadge shows the waiting count, and unread notices only as a dot", () => {
  assert.deepEqual(notify.bellBadge(4, 3), { text: "4", dot: false, label: "Notifications, 4 need you, 3 unread" });
  assert.deepEqual(notify.bellBadge(0, 3), { text: "", dot: true, label: "Notifications, 3 unread" });
  assert.deepEqual(notify.bellBadge(0, 0), { text: "", dot: false, label: "Notifications" });
});

test("a gate that timed out without a decision is a missed item that links to its card", () => {
  const pending = [doc("r1--g9", { status: "pending", title: "Send intro", createdAt: "2026-10-28T00:00:00Z", timeoutHours: 48 })];
  const items = notify.deriveNotifications({ pending, now: NOW });
  assert.deepEqual(items.map((n) => [n.kind, n.title, n.href, n.at]),
    [["missed", "Missed: Send intro timed out", "#/approvals?tab=done&r=r1--g9", "2026-10-30T00:00:00.000Z"]]);
  assert.deepEqual(notify.deriveNotifications({ pending, decisions: new Set(["r1--g9"]), now: NOW }), []);
});

test("notifications: over the v2 demo the bell and the waiting row never share a decision", () => {
  const snap = JSON.parse(readFileSync(new URL("../desk_fixtures/v2-demo.json", import.meta.url), "utf8"));
  const pick = (prefix) => Object.keys(snap).filter((k) => k.startsWith(prefix)).map((k) => doc(k.slice(prefix.length), snap[k].data));
  const definition = snap["meta/definition"].data;
  const src = { inbox: pick("inbox/"), pending: pick("pending/"), runs: pick("runs/"), producers: definition.producers || [],
    decisions: new Set(pick("decisions/").map((d) => d.id)) };
  const at = Date.parse("2026-10-28T00:00:00Z");
  const items = notify.deriveNotifications(Object.assign({ now: at }, src));
  const reqSrc = Object.assign({}, src, { decisions: pick("decisions/"), views: pick("views/"), columns: pick("columns/") });
  const requests = deriveRequests(reqSrc, "u_owner", at);
  const readIds = new Set(items.map((n) => n.readId));
  assert.ok(!requests.some((r) => readIds.has(r.id)), "a request is never also a bell item");
  assert.ok(items.length > 0);
  assert.ok(!items.some((n) => n.kind === "gate" || n.kind === "gate-soon"), items.map((n) => n.kind).join());
  const decisionIds = new Set(src.inbox.filter((m) => m.data.kind === "proposal" || m.data.kind === "approval").map((m) => m.id)
    .concat(src.pending.map((g) => g.id)));
  assert.ok(!items.some((n) => decisionIds.has(n.readId)), "no waiting decision is a bell item");
  assert.equal(notify.waitingSummary(reqSrc, at, "u_owner").count, requests.filter((r) => r.state === "waiting").length);
  assert.equal(notify.waitingSummary(reqSrc, at, "u_owner").count, 5);
  const na = items.find((n) => n.kind === "not-applied");
  assert.equal(na.title, "1 approval could not be applied in run jobs-watch-20261028");
  assert.equal(na.href, "#/approvals?tab=done&r=jobs-watch-20261008--2");
});

test("notifications: two not_applied entries in one run make one item linking to Done", () => {
  const runs = [doc("r9", { producer: "a", status: "ok", startedAt: "2026-10-30T06:00:00Z", processed: [
    { request: "x--1", outcome: "not_applied", reason: "gone" }, { request: "x--2", outcome: "applied" },
    { request: "x--3", outcome: "not_applied" }] })];
  const items = notify.deriveNotifications({ runs, now: NOW }).filter((n) => n.kind === "not-applied");
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "2 approvals could not be applied in run r9");
  assert.equal(items[0].href, "#/approvals?tab=done");
  assert.equal(items[0].readId, "na--r9");
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
  assert.equal(items.find((n) => n.kind === "run-failed").href, "#/runs/r3");
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

const history = require(CORE + "pages/history.js");

test("history: runs grouped by UTC day, newest run first within a day", () => {
  const days = history.runsByDay([
    doc("a", { startedAt: "2026-10-29T06:00:00Z" }), doc("b", { startedAt: "2026-10-30T23:30:00Z" }),
    doc("c", { startedAt: "2026-10-30T06:00:00Z" }), doc("d", {}),
  ]);
  assert.deepEqual(Object.keys(days).sort(), ["2026-10-29", "2026-10-30"]);
  assert.deepEqual(days["2026-10-30"].map((r) => r.id), ["b", "c"]);
});

test("history: Timeline by default, Calendar from ?mode=cal, and old modes (health, activity, list) fall back to Timeline", () => {
  assert.equal(history.historyMode({}), "timeline");
  assert.equal(history.historyMode({ query: { mode: "cal" } }), "cal");
  for (const m of ["health", "activity", "list", "x"]) assert.equal(history.historyMode({ query: { mode: m } }), "timeline", m);
});

test("history events name records where a name is known and carry the record id for the peek (History review H1)", () => {
  const items = history.historyEvents({
    names: { "role--a1": "Staff engineer", "role--c": "Platform lead" },
    comments: [doc("role--a1--u_2--x", { entity: "role--a1", text: "Worth a look", at: "2026-10-29T06:00:00Z", by: "u_2" })],
    decisions: [doc("role--a1", { decision: "drop", at: "2026-10-30T05:00:00Z", by: "u_2" }), doc("r1--g1", { decision: "approve", at: "2026-10-30T03:00:00Z", by: "u_1" })],
    merges: [doc("role--b", { into: "role--c", at: "2026-10-30T06:00:00Z", by: "u_2" })],
  });
  assert.deepEqual(items.map((i) => [i.text, i.entity || null]), [
    ["Merged role--b into Platform lead", "role--c"],
    ["Dropped Staff engineer", "role--a1"],
    ["Approved r1--g1", null],
    ["Commented on Staff engineer: Worth a look", "role--a1"]]);
});

test("history: calendar weeks run Monday to Sunday and end with the week holding today", () => {
  const weeks = history.calendarWeeks(Date.parse("2026-10-30T12:00:00Z"), 5);
  assert.equal(weeks.length, 5);
  assert.equal(weeks[4][0], "2026-10-26");
  assert.equal(weeks[4][6], "2026-11-01");
  assert.equal(weeks[0][0], "2026-09-28");
});

test("history events: runs, comments and people writes from decisions, settings history, merges and views, newest first", () => {
  const items = history.historyEvents({
    definition: { producers: [{ id: "jobs", label: "Jobs" }] },
    runs: [doc("jobs-1", { producer: "jobs", status: "partial", startedAt: "2026-10-30T07:00:00Z" })],
    comments: [doc("role--a1--u_2--x", { entity: "role--a1", text: "Worth a look", at: "2026-10-29T06:00:00Z", by: "u_2" })],
    decisions: [doc("r1--g1", { decision: "approve", at: "2026-10-30T03:00:00Z", by: "u_1" }),
      doc("role--a1", { decision: "drop", at: "2026-10-30T05:00:00Z", by: "u_2", reason: "Too senior" }),
      doc("r1--3", { decision: "dismiss", at: "2026-10-29T05:00:00Z", by: "u_1" }),
      doc("old", { decision: "keep" })],
    settingsHistory: [doc("h1", { producer: "jobs", before: { a: 1, b: 2 }, after: { a: 1, b: 3 }, at: "2026-10-30T04:00:00Z", by: "u_1" })],
    merges: [doc("role--b", { into: "role--c", at: "2026-10-30T06:00:00Z", by: "u_2" })],
    views: [doc("v1", { name: "Remote", madeBy: "u_1", createdAt: "2026-10-30T01:00:00Z" }), doc("v2", { name: "Agent", madeBy: "agent", createdAt: "2026-10-30T02:00:00Z" })],
  });
  assert.deepEqual(items.map((i) => i.kind), ["run", "merge", "decision", "settings", "decision", "view", "comment", "decision"]);
  assert.deepEqual(items.map((i) => i.by), [null, "u_2", "u_2", "u_1", "u_1", "u_1", "u_2", "u_1"]);
  assert.deepEqual([items[0].text, items[0].href], ["Jobs run, partial", "#/runs/jobs-1"]);
  assert.deepEqual([items[6].text, items[6].href], ["Commented on role--a1: Worth a look", "#/entity/role/a1"]);
  items.splice(0, 1);
  items.splice(5, 1);
  assert.equal(items[0].text, "Merged role--b into role--c");
  assert.equal(items[0].href, "#/entity/role/c");
  assert.equal(items[1].text, "Dropped role--a1: Too senior");
  assert.equal(items[2].text, "Changed jobs settings: b");
  assert.equal(items[2].href, "#/settings");
  assert.equal(items[3].text, "Approved r1--g1");
  assert.equal(items[3].href, "#/approvals");
  assert.equal(items[4].text, "Saved view Remote");
  assert.equal(items[5].href, "#/approvals");
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
  const settings = require(CORE + "pages/settings.js");
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
Object.assign(globalThis, { toCsv: require(CORE + "pages/browse.js").toCsv });
const exporter = require(CORE + "exporter.js");

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
  const { createStore } = require(CORE + "store.js");
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

// ---------- Package 2: the grouped nav model ----------

const palette2 = require(CORE + "palette.js");
const GN_DEF = {
  types: { role: { label: "Role", plural: "Roles" }, company: { label: "Company", plural: "Companies" } },
  views: [{ id: "au", type: "role", name: "AU roles" }],
  desk: { modules: [{ id: "big", kind: "view", label: "Big ones", view: { type: "company" } }] },
};

test("navModel groups Workspace and Lists, types in definition order, Settings on its own", () => {
  const nav = palette2.navModel(GN_DEF, [], null, null);
  assert.deepEqual(nav.groups.map((g) => [g.id, g.label]), [["workspace", "Workspace"], ["lists", "Lists"]]);
  assert.deepEqual(nav.groups[0].items.map((n) => n.id), ["today", "approvals", "runs", "history"]);
  assert.deepEqual(nav.groups[1].items.map((n) => n.id), ["type:role", "type:company"]);
  assert.deepEqual(nav.groups[1].items[0].children.map((c) => c.id), ["view:au"]);
  assert.deepEqual(nav.groups[1].items[1].children.map((c) => c.id), ["module:big"]);
  assert.equal(nav.settings.id, "settings");
  assert.equal(nav.settings.href, "#/settings");
  const runs = nav.groups[0].items[2];
  assert.deepEqual([runs.label, runs.href], ["Runs", "#/runs"]);
});

test("navModel: Workers joins Workspace with a join card; a hide list naming retired pages changes nothing", () => {
  const plain = palette2.navModel(GN_DEF, [], null, null);
  assert.deepEqual(palette2.navModel(GN_DEF, [], null, null, ["inbox", "suggestions", "views"]), plain);
  const joined = palette2.navModel(GN_DEF, [], null, { id: "join" });
  assert.deepEqual(joined.groups[0].items.map((n) => n.id), ["today", "approvals", "runs", "history", "workers"]);
});

test("navFlat lists every top entry with Settings last; bottomModel and paletteCommands take the grouped model", () => {
  const nav = palette2.navModel(GN_DEF, [], null, null);
  assert.deepEqual(palette2.navFlat(nav).map((n) => n.id), ["today", "approvals", "runs", "history", "type:role", "type:company", "settings"]);
  assert.ok(palette2.paletteCommands(nav, []).some((c) => c.id === "go:runs"));
  assert.ok(palette2.bottomModel(nav).some((n) => n.id === "type:role"));
});

// ---------- Package 2: user menu, bottom nav and shortcuts ----------

test("userMenuItems: no viewer leaves out Signed in and Lock; an owner with a lock and the tour gets every entry", () => {
  const ids = (ctx) => palette2.userMenuItems(ctx).map((i) => i.id);
  assert.deepEqual(ids({ viewer: null, lock: null }), ["theme", "density", "shortcuts"]);
  assert.deepEqual(ids({ viewer: "u_owner", owner: { by: "u_owner" }, lock: { hash: "x" }, tour: true }),
    ["signed-in", "theme", "density", "tour", "shortcuts", "lock"]);
  const labels = palette2.userMenuItems({ viewer: "u_owner", lock: { hash: "x" }, tour: true }).map((i) => i.label);
  assert.deepEqual(labels, ["Signed in", "Theme", "Density", "Take the tour", "Keyboard shortcuts", "Lock now"]);
});

test("viewerRole: Owner when the viewer is meta/owner.by, Member otherwise, null with no viewer", () => {
  assert.equal(palette2.viewerRole({ viewer: "u_owner", owner: { by: "u_owner" } }), "Owner");
  assert.equal(palette2.viewerRole({ viewer: "u_member", owner: { by: "u_owner" } }), "Member");
  assert.equal(palette2.viewerRole({ viewer: "u_member", owner: null }), "Member");
  assert.equal(palette2.viewerRole({ viewer: null, owner: { by: "u_owner" } }), null);
});

test("bottomModel: Today, Approvals, the first type, History and More (More has no address)", () => {
  const b = palette2.bottomModel(palette2.navModel(GN_DEF, [], null, null));
  assert.deepEqual(b.map((n) => n.id), ["today", "approvals", "type:role", "history", "more"]);
  assert.equal(b[4].href, undefined);
  assert.deepEqual(palette2.bottomModel(palette2.navModel(null, [], null, null)).map((n) => n.id), ["today", "approvals", "history", "more"]);
});

test("shortcutFor: g u is Runs, g i is Approvals, j k o move through and open the list", () => {
  assert.deepEqual(palette2.shortcutFor(["g", "u"], []), { go: "#/runs" });
  assert.deepEqual(palette2.shortcutFor(["g", "i"], []), { go: "#/approvals" });
  assert.deepEqual(palette2.shortcutFor(["g", "r"], [{ id: "role", plural: "Roles" }]), { go: "#/browse/role" });
  assert.deepEqual(["j", "k", "o"].map((k) => palette2.shortcutFor([k], [])), [{ run: "next" }, { run: "prev" }, { run: "open" }]);
  const rows = palette2.shortcutRows([]).map((r) => r[0] + " " + r[1]);
  assert.ok(rows.includes("g u Runs"));
  assert.ok(rows.includes("g i Approvals"));
  assert.ok(!rows.some((r) => /Inbox/.test(r)));
});

// ---------- Task 2.5: peek framework ----------

const peek = require(CORE + "peek.js");

test("peekPosition: index, total and neighbours; a key not in the list has no position", () => {
  assert.deepEqual(peek.peekPosition(["a", "b", "c"], "b"), { index: 1, total: 3, prev: "a", next: "c" });
  assert.deepEqual(peek.peekPosition(["a"], "z"), { index: null, total: 1, prev: null, next: null });
  assert.deepEqual(peek.peekPosition(["a", "b"], "a"), { index: 0, total: 2, prev: null, next: "b" });
});

test("peekHash and stripPeek set and remove ?peek= and keep the other query keys", () => {
  assert.equal(peek.peekHash("#/browse/role?view=x", "https://jobs.example/au/1"), "#/browse/role?view=x&peek=" + encodeURIComponent("https://jobs.example/au/1"));
  assert.equal(peek.peekHash("#/browse/role?peek=a&view=x", "b"), "#/browse/role?view=x&peek=b");
  assert.equal(peek.stripPeek("#/browse/role?view=x&peek=a"), "#/browse/role?view=x");
  assert.equal(peek.stripPeek("#/browse/role?peek=a"), "#/browse/role");
  assert.equal(peek.stripPeek("#/browse/role"), "#/browse/role");
  assert.equal(peek.peekKey("#/browse/role?view=x&peek=" + encodeURIComponent("a b/c")), "a b/c");
  assert.equal(peek.peekKey("#/browse/role?view=x"), null);
});

function fakeHistory(start) {
  const entries = [start];
  const listeners = new Set();
  const env = {
    entries,
    history: {
      pushState: (s, t, url) => { entries.push(url); },
      replaceState: (s, t, url) => { entries[entries.length - 1] = url; },
      back: () => { if (entries.length > 1) { entries.pop(); listeners.forEach((fn) => fn({})); } },
    },
    getHash: () => entries[entries.length - 1],
    replaceHash: (h) => { entries[entries.length - 1] = h; },
    on: (type, fn) => { if (type === "popstate") listeners.add(fn); },
    off: (type, fn) => { if (type === "popstate") listeners.delete(fn); },
    listeners,
  };
  return env;
}

// ---- Task 2.6: the PIN privacy screen (spec 5.15, 7e)
const lock = require(CORE + "lock.js");
const LOCK_DOC = JSON.parse(readFileSync(new URL("../desk_fixtures/lock-demo.json", import.meta.url), "utf8"))["meta/lock"].data;

test("validPin takes exactly six digits", () => {
  assert.equal(lock.validPin("246810"), true);
  for (const bad of ["24681", "2468100", "24681a", " 246810", "", null, 246810]) assert.equal(lock.validPin(bad), false, String(bad));
});

test("hashPin matches the hash the fixture builder wrote", async () => {
  assert.equal(await lock.hashPin("246810", LOCK_DOC.salt, LOCK_DOC.iterations), LOCK_DOC.hash);
  assert.notEqual(await lock.hashPin("246811", LOCK_DOC.salt, LOCK_DOC.iterations), LOCK_DOC.hash);
});

test("validLock accepts the fixture and refuses a malformed doc", () => {
  assert.equal(lock.validLock(LOCK_DOC), true);
  assert.equal(lock.validLock(null), false);
  assert.equal(lock.validLock({ ...LOCK_DOC, iterations: 10 }), false);
  assert.equal(lock.validLock({ ...LOCK_DOC, hash: "xyz" }), false);
  assert.equal(lock.validLock({ ...LOCK_DOC, algo: "SHA-1" }), false);
  assert.equal(lock.validLock({ ...LOCK_DOC, iterations: 1e7 + 1 }), false);
  assert.equal(lock.validLock({ ...LOCK_DOC, iterations: 1e7 }), true);
});

test("the pass lasts the page life when session storage throws, and Lock now forgets it", () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get() { throw new Error("blocked"); } });
  try {
    lock.forgetLockPass();
    assert.equal(lock.lockPassed(LOCK_DOC.salt), false);
    lock.rememberLockPass(LOCK_DOC.salt);
    assert.equal(lock.lockPassed(LOCK_DOC.salt), true);
    lock.forgetLockPass();
    assert.equal(lock.lockPassed(LOCK_DOC.salt), false);
  } finally {
    if (prior) Object.defineProperty(globalThis, "sessionStorage", prior); else delete globalThis.sessionStorage;
  }
});

test("a pass is read back from session storage", () => {
  const store = new Map();
  const prior = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
    getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } });
  try {
    lock.forgetLockPass();
    lock.rememberLockPass(LOCK_DOC.salt);
    assert.equal(store.get("routineos-desk-unlocked"), LOCK_DOC.salt);
    lock.forgetLockPass();
    assert.equal(store.has("routineos-desk-unlocked"), false);
    store.set("routineos-desk-unlocked", LOCK_DOC.salt);
    assert.equal(lock.lockPassed(LOCK_DOC.salt), true);
    store.set("routineos-desk-unlocked", "1");
    assert.equal(lock.lockPassed(LOCK_DOC.salt), false);
  } finally {
    if (prior) Object.defineProperty(globalThis, "sessionStorage", prior); else delete globalThis.sessionStorage;
    lock.forgetLockPass();
  }
});

// ---- Task 2.7: network hooks on the store (spec 5.13)
const storeMod = require(CORE + "store.js");

test("isNetworkError: offline, fetch TypeError and network codes count; a missing doc does not", () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
  try {
    assert.equal(storeMod.isNetworkError(new TypeError("Failed to fetch")), true);
    assert.equal(storeMod.isNetworkError({ code: "unavailable" }), true);
    assert.equal(storeMod.isNetworkError(new Error("forced read failure: runs")), false);
    assert.equal(storeMod.isNetworkError(new TypeError("x is not a function")), false);
    globalThis.navigator.onLine = false;
    assert.equal(storeMod.isNetworkError(new Error("anything")), true);
  } finally {
    if (prior) Object.defineProperty(globalThis, "navigator", prior); else delete globalThis.navigator;
  }
});

test("watchNetwork fires onReadOk after a read and onNetworkError on a dropped call, and unsubscribes", async () => {
  let failNext = null;
  const subs = [];
  const base = {
    get: () => (failNext ? Promise.reject(failNext) : Promise.resolve({ exists: false })),
    list: () => Promise.resolve([]),
    set: () => Promise.reject(new TypeError("Failed to fetch")),
    del: () => Promise.resolve(),
    subscribe: (c, cb, q) => { subs.push({ cb, q }); return () => {}; },
  };
  const s = storeMod.watchNetwork(base);
  const seen = [];
  const offOk = s.onReadOk(() => seen.push("ok"));
  s.onNetworkError(() => seen.push("down"));
  await s.get("meta/x");
  failNext = new TypeError("Failed to fetch");
  await s.get("meta/x").catch(() => {});
  failNext = new Error("bad data");
  await s.get("meta/x").catch(() => {});
  await s.set("a/b", {}).catch(() => {});
  let own = 0;
  s.subscribe("runs", () => {}, { where: [["a", "==", 1]], onError: () => own++ });
  assert.deepEqual(subs[0].q.where, [["a", "==", 1]]);
  subs[0].cb([]);
  subs[0].q.onError(new TypeError("NetworkError when attempting to fetch resource."));
  assert.equal(own, 1);
  offOk();
  await s.list("runs");
  assert.deepEqual(seen, ["ok", "down", "down", "ok", "down"]);
});

// ---------- Package 4: per-kind Approvals derivation ----------

Object.assign(globalThis, { human: require(CORE + "dates.js").human });
const requests = require(CORE + "requests.js");
const V2 = JSON.parse(readFileSync(new URL("../desk_fixtures/v2-demo.json", import.meta.url), "utf8"));
const REQ_NOW = Date.parse("2026-10-28T00:00:00Z");
function v2src(extra = {}) {
  const pick = (prefix) => Object.keys(V2).filter((k) => k.startsWith(prefix) && k.split("/").length === 2)
    .map((k) => doc(k.slice(prefix.length), V2[k].data));
  return Object.assign({ pending: pick("pending/"), inbox: pick("inbox/"), views: pick("views/"), columns: pick("columns/"),
    decisions: pick("decisions/"), personDecisions: [], runs: pick("runs/") }, extra);
}
const GATE = "jobs-watch-20261027--g1";

test("requests: the demo approval message folds into its gate; entity decisions never appear", () => {
  const list = requests.deriveRequests(v2src(), "u_owner", REQ_NOW);
  const gates = list.filter((r) => r.group === "gates");
  assert.deepEqual(gates.map((r) => [r.id, r.kind, r.state, r.message]), [[GATE, "gate", "waiting", "jobs-watch-20261027--1"]]);
  assert.match(gates[0].title, /Draft an intro note/);
  assert.equal(gates[0].timeoutAt, "2026-10-29T22:00:00.000Z");
  assert.ok(!list.some((r) => r.id.startsWith("role--") || r.id === "jobs-watch-20261027--1"));
  assert.deepEqual(list.map((r) => r.kind).sort(), ["column", "gate", "proposal-l1", "view", "view"]);
  assert.ok(list.every((r) => r.state === "waiting"));
});

test("requests: a decided gate is queued until a run starts after the decision, then done", () => {
  const dec = doc(GATE, { decision: "approve", at: "2026-10-28T00:10:00Z", by: "u_owner" });
  let gate = requests.deriveRequests(v2src({ decisions: [dec] }), "u_owner", REQ_NOW).find((r) => r.id === GATE);
  assert.equal(gate.state, "queued");
  assert.equal(gate.canUndo, true);
  assert.deepEqual(requests.undoable(gate, v2src().runs), { ok: true });
  const later = doc("jobs-watch-20261029", { startedAt: "2026-10-29T22:00:00Z", status: "ok" });
  const runs = v2src().runs.concat([later]);
  gate = requests.deriveRequests(v2src({ decisions: [dec], runs }), "u_owner", Date.parse("2026-10-30T00:00:00Z")).find((r) => r.id === GATE);
  assert.equal(gate.state, "done");
  assert.equal(gate.outcome.key, "unreported");
  assert.match(gate.outcome.text, /^Decided .*\. The routine did not report on this request\.$/);
  assert.deepEqual(requests.undoable(gate, runs), { ok: false, runId: "jobs-watch-20261029" });
});

test("requests: with the v2 run report a gate decided before that run is applied", () => {
  const dec = doc(GATE, { decision: "approve", at: "2026-10-27T23:00:00Z", by: "u_owner" });
  const gate = requests.deriveRequests(v2src({ decisions: [dec] }), "u_owner", REQ_NOW).find((r) => r.id === GATE);
  assert.equal(gate.state, "done");
  assert.equal(gate.outcome.text, "Applied in run jobs-watch-20261028");
  assert.equal(gate.outcome.result, "Introduction sent.");
  assert.deepEqual(requests.undoable(gate, v2src().runs), { ok: false, runId: "jobs-watch-20261028" });
});

test("requests: a worker gate reads only the viewer's own decision and is never queued or undoable", () => {
  const pending = [doc("w--g1", { status: "pending", lane: "send--a", producer: "jobs-watch", createdAt: "2026-10-27T00:00:00Z", title: "Send" })];
  let r = requests.deriveRequests({ pending, decisions: [doc("w--g1", { decision: "approve", at: "2026-10-27T01:00:00Z", by: "u_owner" })] }, "u_owner", REQ_NOW)[0];
  assert.equal(r.state, "waiting", "a shared decisions/ doc is not a worker gate's decision");
  assert.equal(r.decisionPath, "people/u_owner/decisions/w--g1");
  r = requests.deriveRequests({ pending, personDecisions: [doc("w--g1", { decision: "approve", at: "2026-10-27T01:00:00Z", by: "u_owner" })] }, "u_owner", REQ_NOW)[0];
  assert.equal(r.state, "done");
  assert.equal(r.canUndo, false);
  assert.match(r.outcome.text, /^Decided /);
});

test("requests: L1 accept is done at once; snooze wakes after until; dismiss and archive are done", () => {
  const P = "jobs-watch-20261008--2";
  const at = "2026-10-27T23:50:00Z";
  const find = (decisions, id = P, now = REQ_NOW) => requests.deriveRequests(v2src({ decisions }), "u_owner", now).find((r) => r.id === id);
  let r = find([doc(P, { decision: "accept", at })]);
  assert.equal(r.state, "done");
  assert.equal(r.canUndo, false);
  assert.match(r.outcome.text, /^Applied to settings /);
  r = find([doc(P, { decision: "snooze", at, until: "2026-10-27T12:00:00Z" })]);
  assert.equal(r.state, "waiting");
  r = find([doc(P, { decision: "snooze", at, until: "2026-11-03T12:00:00Z" })]);
  assert.equal(r.state, "done");
  assert.match(r.outcome.text, /^Snoozed until /);
  assert.equal(find([doc(P, { decision: "dismiss", at })]).outcome.text, "Dismissed");
  r = find([doc("views--senior-au-roles", { decision: "archive", at })], "views--senior-au-roles");
  assert.deepEqual([r.state, r.outcome.text, r.decisionPath], ["done", "Archived", "decisions/views--senior-au-roles"]);
});

test("requests: an L2 proposal snoozed until a past date is waiting and says it changes code", () => {
  const inbox = [doc("p--1", { kind: "proposal", producer: "jobs-watch", title: "Add a source", createdAt: "2026-10-20T00:00:00Z",
    proposal: { level: "L2", target: "definition", change: "Add a source" } })];
  const r = requests.deriveRequests({ inbox, decisions: [doc("p--1", { decision: "snooze", at: "2026-10-20T01:00:00Z", until: "2026-10-27T01:00:00Z" })] }, "u_owner", REQ_NOW)[0];
  assert.deepEqual([r.kind, r.state, r.note], ["proposal-l23", "waiting", "Changes the routine's code through a pull request"]);
});

test("requests: an accepted proposal the run did not apply says why", () => {
  const P = "jobs-watch-20261008--2";
  const r = requests.deriveRequests(v2src({ decisions: [doc(P, { decision: "accept", at: "2026-10-27T10:00:00Z" })] }), "u_owner", REQ_NOW)
    .find((x) => x.id === P);
  assert.equal(r.outcome.text, "Not applied in run jobs-watch-20261028: GB is not in this run's sources yet.");
});

// Members (spec 5.9): derived from by and updatedBy fields; Owner from meta/owner.by; seed and bad ids skipped.
test("deriveMembers lists the owner and the member with their newest activity", () => {
  const { deriveMembers } = require(CORE + "members.js");
  const docs = JSON.parse(readFileSync(new URL("../desk_fixtures/v2-demo.json", import.meta.url), "utf8"));
  const out = deriveMembers(docs, docs["meta/owner"].data.by, "u_owner");
  assert.deepEqual(out, [
    { id: "u_owner", role: "Owner", lastActive: "2026-10-26T09:10:00Z" },
    { id: "u_member", role: "Member", lastActive: "2026-10-28T01:22:00.000Z" },
  ]);
  assert.ok(!out.some((m) => m.id === "seed"));
});

test("deriveMembers keeps a viewer with no docs, skips bad ids and ignores meta/join", () => {
  const { deriveMembers } = require(CORE + "members.js");
  const docs = {
    "decisions/a": { data: { by: "seed", at: "2026-10-01T00:00:00Z" } },
    "decisions/b": { data: { by: "bad id!", at: "2026-10-01T00:00:00Z" } },
    "comments/c": { data: { by: "u_x", at: "2026-10-02T00:00:00Z" } },
    "comments/d": { data: { by: "u_x", at: "2026-10-05T00:00:00Z" } },
    "meta/join": { data: { by: "u_join" } },
    "entities/e": { data: { by: "u_other" } },
  };
  assert.deepEqual(deriveMembers(docs, null, "u_new"), [
    { id: "u_x", role: "Member", lastActive: "2026-10-05T00:00:00Z" },
    { id: "u_new", role: "Member", lastActive: null },
  ]);
  assert.deepEqual(deriveMembers({}, null, null), []);
});

// ---- Task 6.4: the owner sets and removes the PIN through actions.js
test("setLockPin writes a contract meta/lock doc for the owner only", async () => {
  Object.assign(globalThis, { validPin: lock.validPin, hashPin: lock.hashPin, rememberLockPass: () => {} });
  const writes = [];
  const store = { set: (path, data) => { writes.push({ op: "set", path, data }); return Promise.resolve(); },
    del: (path) => { writes.push({ op: "delete", path }); return Promise.resolve(); } };
  const owner = { viewer: "u_owner", owner: { by: "u_owner" }, store };
  const member = { viewer: "u_member", owner: { by: "u_owner" }, store };
  await assert.rejects(actions.setLockPin(member, "135790"), /only the Desk owner/);
  await assert.rejects(actions.removeLockPin(member), /only the Desk owner/);
  await assert.rejects(actions.setLockPin(owner, "12345"), /six digits/);
  assert.deepEqual(writes, []);
  const doc = await actions.setLockPin(owner, "135790");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, "meta/lock");
  assert.deepEqual(Object.keys(doc).sort(), ["algo", "hash", "iterations", "salt", "setAt", "setBy"]);
  assert.equal(doc.iterations, 310000);
  assert.equal(doc.setBy, "u_owner");
  assert.match(doc.salt, /^[0-9a-f]{32}$/);
  assert.match(doc.setAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(lock.validLock(doc), true);
  assert.equal(await lock.hashPin("135790", doc.salt, doc.iterations), doc.hash);
  await actions.removeLockPin(owner);
  assert.deepEqual(writes[1], { op: "delete", path: "meta/lock" });
});

// ---- Task 6.6: palette record search and the starter tour
test("searchRecords matches title and key words, case-insensitive, and caps at max", () => {
  const { searchRecords } = require(CORE + "palette.js");
  const ents = [];
  for (let i = 0; i < 30; i++) ents.push({ id: "role--r" + i, data: { type: "role", key: "r" + i, display: { title: "Data Analyst " + i, company: "Northwind" } } });
  ents.push({ id: "company--acme", data: { type: "company", key: "acme.example", display: { name: "Acme Tools" } } });
  ents.push({ id: "role--gone", data: { type: "role", key: "gone", status: "dropped", display: { title: "Analyst gone" } } });
  assert.equal(searchRecords(ents, "analyst").length, 20);
  assert.equal(searchRecords(ents, "ANALYST 7", 5).map((e) => e.id).join(), "role--r7");
  assert.deepEqual(searchRecords(ents, "acme.EXAMPLE").map((e) => e.id), ["company--acme"]);
  assert.deepEqual(searchRecords(ents, "tools acme").map((e) => e.id), ["company--acme"]);
  assert.deepEqual(searchRecords(ents, "gone"), []);
  assert.deepEqual(searchRecords(ents, "  "), []);
  assert.deepEqual(searchRecords(null, "x"), []);
});

test("deriveNotifications skips docs with no data and treats producer names as plain keys", () => {
  const at = Date.parse("2026-10-20T10:00:00Z");
  const run = (id, producer, startedAt, status) => ({ id, data: { producer, startedAt, status } });
  const items = notify.deriveNotifications({ now: at, inbox: [{ id: "m1", data: null }],
    runs: [{ id: "r0", data: null }, run("r1", "constructor", "2026-10-20T09:00:00Z", "failed")] });
  assert.deepEqual(items.map((n) => n.kind), ["run-failed"]);
});
