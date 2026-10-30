// node --test tests/visual/pure.test.mjs  (built-in runner, no packages)
// Pure page logic: Today assembly, Inbox lists, Browse filters, CSV, the page write allowlist.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const SRC = "../../skills/routineos/assets/desk/src/";
const { writable, save, remove, PathError } = require(SRC + "actions.js");
const { todayItems } = require(SRC + "pages/today.js");
const { inboxList, exclusionCandidates, suppressedLines, gateLine } = require(SRC + "pages/inbox.js");
const { applyFilters, toCsv, toRow, readFilterState, writeFilterState, browseColumns, defaultCols } = require(SRC + "pages/browse.js");
const { sparkPoints, entityIdFromRoute } = require(SRC + "pages/entity.js");
const { groupViews, viewToFilterState, filterStateToView, viewDoc } = require(SRC + "pages/views.js");
const { controlSpec, checkSetting, listAdd, listRemove, settingControl, changedValues } = require(SRC + "pages/settings.js");
const { scheduleInterval, isLate, nextRun, dropReasonLinks, settingsDiff, sourcesLine } = require(SRC + "pages/runs.js");

const doc = (id, data) => ({ id, data });

// ---------- page write allowlist ----------

test("pages may write only people-owned documents", () => {
  for (const p of ["settings/jobs-watch", "settings/workspace", "userstate/company--a-example", "decisions/g1",
    "merges/role--x", "views/v1", "columns/c1", "data/users/u_1/state/read/r1--1", "data/users/u_1/state/ack/r1"]) {
    assert.equal(writable(p, "u_1"), true, p);
  }
  for (const p of ["entities/company--a", "runs/r1", "inbox/r1--1", "pending/g1", "meta/definition",
    "data/users/u_2/state/read/r1--1", "data/users/u_1/other/x", "settings/a/b/c", "userstate"]) {
    assert.equal(writable(p, "u_1"), false, p);
  }
  assert.equal(writable("data/users/null/state/read/x", null), false);
});

test("save and remove refuse producer paths without touching the store", async () => {
  const calls = [];
  const store = { set: async (p) => calls.push(["set", p]), del: async (p) => calls.push(["del", p]) };
  await assert.rejects(() => save(store, "u_1", "entities/company--a", {}), PathError);
  await assert.rejects(() => remove(store, "u_1", "runs/r1"), PathError);
  assert.deepEqual(calls, []);
  await save(store, "u_1", "userstate/company--a", { star: true });
  await remove(store, "u_1", "merges/role--x");
  assert.deepEqual(calls, [["set", "userstate/company--a"], ["del", "merges/role--x"]]);
});

test("save passes no version pin to the store", async () => {
  let args = null;
  const store = { set: async (...a) => { args = a; } };
  await save(store, "u_1", "settings/p", { values: {} });
  assert.equal(args.length, 2);
});

// ---------- Today ----------

const DEFN = {
  producers: [
    { id: "jobs-watch", label: "Jobs watch", settings: [
      { name: "excluded_companies", type: "list", role: "exclude", default: [] },
      { name: "markets", type: "list", role: "include", default: [] },
      { name: "max_inbox_per_run", type: "number", default: 5 },
    ] },
    { id: "lead-signals", label: "Lead signals", settings: [] },
  ],
  types: {
    company: { label: "Company", plural: "Companies", identity: "domain", fields: { name: { type: "text" }, domain: { type: "url" } },
      settingFilters: [{ producer: "jobs-watch", setting: "excluded_companies", field: "name" },
        { producer: "lead-signals", setting: "excluded_companies", field: "domain" }] },
    role: { label: "Role", plural: "Roles", identity: "field:url", fields: { title: { type: "text" }, market: { type: "choice" } },
      settingFilters: [{ producer: "jobs-watch", setting: "markets", field: "market" }] },
  },
};

function todayData(over = {}) {
  return Object.assign({
    definition: DEFN,
    inbox: [
      doc("r6--1", { kind: "match", title: "New role", producer: "jobs-watch", run: "r6", createdAt: "2026-10-28T08:00:00Z" }),
      doc("r6--2", { kind: "proposal", title: "Add a market", producer: "jobs-watch", run: "r6", createdAt: "2026-10-28T08:01:00Z",
        proposal: { setting: "markets", from: ["NZ"], to: ["NZ", "AU"] } }),
      doc("r6--3", { kind: "approval", title: "Draft an intro note", producer: "jobs-watch", run: "r6", createdAt: "2026-10-28T08:02:00Z", gate: "g1" }),
    ],
    runs: [
      doc("r5", { producer: "jobs-watch", startedAt: "2026-10-27T08:00:00Z", status: "partial" }),
      doc("r6", { producer: "jobs-watch", startedAt: "2026-10-28T08:00:00Z", status: "ok" }),
      doc("l2", { producer: "lead-signals", startedAt: "2026-10-28T06:00:00Z", status: "partial", parsed: 3, claimed: 5 }),
    ],
    views: [doc("v1", { name: "Hiring this week", state: "proposed", madeBy: "agent", producer: "jobs-watch", type: "role" }),
      doc("v2", { name: "Mine", state: "kept", madeBy: "human", type: "role" })],
    columns: [doc("c1", { name: "Seniority", state: "proposed", producer: "jobs-watch", type: "role" })],
    pending: [doc("g1", { status: "waiting", transport: "slack", timeout: "2026-10-30T08:00:00Z" })],
    decisions: [],
    read: new Set(), done: new Set(), ack: new Set(),
  }, over);
}

test("Today lists what needs the viewer, latest run per producer only", () => {
  const { items } = todayItems(todayData());
  const kinds = items.map((i) => i.kind + ":" + i.id);
  assert.deepEqual(kinds, ["message:r6--1", "run:l2", "view:v1", "column:c1", "proposal:r6--2", "gate:g1"]);
  assert.equal(items.find((i) => i.kind === "gate").message.id, "r6--3");
});

test("Today drops acknowledged runs, decided proposals and gates, read and done messages", () => {
  const { items, lastRuns } = todayItems(todayData({
    ack: new Set(["l2"]), read: new Set(["r6--1"]),
    decisions: [doc("r6--2", { decision: "accept" }), doc("g1", { decision: "approve" })],
    views: [], columns: [],
  }));
  assert.deepEqual(items, []);
  assert.deepEqual(lastRuns.map((r) => [r.producer, r.runId]), [["jobs-watch", "r6"], ["lead-signals", "l2"]]);
});

test("Today treats a closed gate as not waiting", () => {
  const { items } = todayItems(todayData({ pending: [doc("g1", { status: "approved" })] }));
  assert.equal(items.some((i) => i.kind === "gate"), false);
});

test("Today without a viewer id shows one Inbox count line and keeps runs unacknowledgeable", () => {
  const { items } = todayItems(todayData({ read: null, done: null, ack: null }));
  assert.deepEqual(items.map((i) => i.kind), ["inbox-count", "run", "view", "column", "proposal", "gate"]);
  assert.equal(items[0].count, 1);
});

test("Today names producers that have not run yet", () => {
  const { lastRuns } = todayItems(todayData({ runs: [] }));
  assert.deepEqual(lastRuns.map((r) => [r.producer, r.runId]), [["jobs-watch", null], ["lead-signals", null]]);
});

// ---------- Inbox ----------

test("Inbox is newest first and filters by unread and done", () => {
  const msgs = todayData().inbox;
  const state = { read: new Set(["r6--2"]), done: new Set(["r6--3"]) };
  assert.deepEqual(inboxList(msgs, state, "all").map((m) => m.id), ["r6--3", "r6--2", "r6--1"]);
  assert.deepEqual(inboxList(msgs, state, "unread").map((m) => m.id), ["r6--1"]);
  assert.deepEqual(inboxList(msgs, state, "done").map((m) => m.id), ["r6--3"]);
  assert.deepEqual(inboxList(msgs, { read: null, done: null }, "unread").map((m) => m.id), ["r6--3", "r6--2", "r6--1"]);
});

test("exclusion candidates come from exclude-role settings and the entity's value", () => {
  const msg = doc("r6--1", { kind: "match", producer: "jobs-watch",
    refs: [{ type: "company", key: "northwind.example", id: "company--northwind-example" }, { type: "role", key: "u", id: "role--u" }] });
  const entities = { "company--northwind-example": { display: { name: "Northwind Labs", domain: "northwind.example" } }, "role--u": { display: { market: "NZ" } } };
  const settings = { excluded_companies: ["Contoso"] };
  const c = exclusionCandidates(msg, DEFN, entities, settings);
  assert.deepEqual(c, [{ setting: "excluded_companies", value: "Northwind Labs", already: false, refId: "company--northwind-example" }]);
  const again = exclusionCandidates(msg, DEFN, entities, { excluded_companies: ["northwind labs"] });
  assert.equal(again[0].already, true);
  assert.deepEqual(exclusionCandidates(msg, DEFN, {}, settings), []);
});

test("an exclusion shared by a Role and its Company is offered once", () => {
  const filter = [{ producer: "jobs-watch", setting: "excluded_companies", field: "company_domain" }];
  const defn = { producers: DEFN.producers, types: { company: { settingFilters: filter }, role: { settingFilters: filter } } };
  const msg = doc("r6--1", { kind: "alert", producer: "jobs-watch",
    refs: [{ type: "company", id: "company--p" }, { type: "role", id: "role--p" }] });
  const entities = { "company--p": { display: { company_domain: "peltine.example" } }, "role--p": { display: { company_domain: "Peltine.example" } } };
  const c = exclusionCandidates(msg, defn, entities, {});
  assert.deepEqual(c.map((x) => [x.setting, x.value, x.refId]), [["excluded_companies", "peltine.example", "company--p"]]);
});

test("suppressed lines state the exact count and cap", () => {
  const lines = suppressedLines([
    doc("r6", { producer: "jobs-watch", inboxSuppressed: 3, settingsUsed: { max_inbox_per_run: 5 } }),
    doc("r5", { producer: "jobs-watch", inboxSuppressed: 0 }),
  ], DEFN);
  assert.deepEqual(lines, [{ runId: "r6", text: "Jobs watch: 3 more matched, not sent (cap 5)" }]);
});

// ---------- Browse ----------

const NOW = "2026-10-28T12:00:00Z";
function roles() {
  const mk = (id, f, extra = {}) => toRow(doc(id, Object.assign({ type: "role", key: id, status: "active", sources: ["jobs-watch"],
    firstSeen: "2026-09-01T00:00:00Z", lastSeen: "2026-10-27T00:00:00Z", display: f, agentFields: {} }, extra)), extra.us);
  return [
    mk("role--a", { title: "Platform engineer", market: "NZ", remote: true, salary: 120 }),
    mk("role--b", { title: "Data analyst", market: "AU", remote: false, salary: 90 }, { lastSeen: "2026-09-15T00:00:00Z" }),
    mk("role--c", { title: "Staff engineer", market: "NZ", remote: false, salary: 150 },
      { status: "dropped", dropReason: "excluded by excluded_companies", sources: ["lead-signals"], us: { star: true, tags: ["warm"] } }),
    mk("role--d", { title: "Support lead", market: "AU", salary: 70 }, { lastSeen: "2026-10-05T00:00:00Z" }),
  ];
}
const ids = (rows) => rows.map((r) => r.id);

test("applyFilters searches text, status, starred, tag and source", () => {
  const rs = roles();
  assert.deepEqual(ids(applyFilters(rs, { q: "ENGINEER", now: NOW })), ["role--a", "role--c"]);
  assert.deepEqual(ids(applyFilters(rs, { status: "dropped", now: NOW })), ["role--c"]);
  assert.deepEqual(ids(applyFilters(rs, { status: "active", now: NOW })).sort(), ["role--a", "role--b", "role--d"]);
  assert.deepEqual(ids(applyFilters(rs, { starred: true, now: NOW })), ["role--c"]);
  assert.deepEqual(ids(applyFilters(rs, { tag: "warm", now: NOW })), ["role--c"]);
  assert.deepEqual(ids(applyFilters(rs, { source: "lead-signals", now: NOW })), ["role--c"]);
});

test("applyFilters matches the exact drop reason a run links to", () => {
  const rs = roles();
  assert.deepEqual(ids(applyFilters(rs, { status: "dropped", reason: "excluded by excluded_companies", now: NOW })), ["role--c"]);
  assert.deepEqual(ids(applyFilters(rs, { reason: "excluded", now: NOW })), []);
});

test("applyFilters matches choice and bool chips", () => {
  const rs = roles();
  assert.deepEqual(ids(applyFilters(rs, { fields: { market: "AU" }, now: NOW })).sort(), ["role--b", "role--d"]);
  assert.deepEqual(ids(applyFilters(rs, { fields: { remote: "true" }, now: NOW })), ["role--a"]);
  assert.deepEqual(ids(applyFilters(rs, { fields: { remote: "false" }, now: NOW })).sort(), ["role--b", "role--c"]);
});

test("applyFilters date windows use lastSeen against the given now", () => {
  const rs = roles();
  assert.deepEqual(ids(applyFilters(rs, { window: "week", now: NOW })).sort(), ["role--a", "role--c"]);
  assert.deepEqual(ids(applyFilters(rs, { window: "month", now: NOW })).sort(), ["role--a", "role--c", "role--d"]);
  assert.deepEqual(ids(applyFilters(rs, { window: "last-month", now: NOW })), ["role--b"]);
  assert.equal(applyFilters(rs, { window: "all", now: NOW }).length, 4);
});

test("applyFilters sorts numbers numerically, missing values last, ties by id", () => {
  const rs = roles();
  assert.deepEqual(ids(applyFilters(rs, { sort: { field: "salary", dir: "desc" }, now: NOW })), ["role--c", "role--a", "role--b", "role--d"]);
  assert.deepEqual(ids(applyFilters(rs, { sort: { field: "remote", dir: "asc" }, now: NOW })), ["role--b", "role--c", "role--a", "role--d"]);
  assert.deepEqual(ids(applyFilters(rs, { now: NOW })), ["role--a", "role--c", "role--d", "role--b"]);
});

test("applyFilters does not mutate its input", () => {
  const rs = roles();
  const before = ids(rs);
  applyFilters(rs, { sort: { field: "salary", dir: "asc" }, now: NOW });
  assert.deepEqual(ids(rs), before);
});

test("filter state round trips through the hash query", () => {
  const fs = { q: "staff eng", status: "dropped", starred: true, tag: "warm", source: "lead-signals", reason: "excluded by x",
    window: "month", fields: { market: "NZ" }, sort: { field: "salary", dir: "asc" }, group: "market", cols: ["title", "salary"] };
  const qs = writeFilterState(fs);
  const back = readFilterState(Object.fromEntries(new URLSearchParams(qs)));
  assert.deepEqual(back, fs);
  assert.deepEqual(readFilterState({}), { q: "", status: "active", starred: false, tag: "", source: "", reason: "", window: "all",
    fields: {}, sort: { field: "lastSeen", dir: "desc" }, group: "", cols: null });
  assert.equal(writeFilterState(readFilterState({})), "");
});

test("toCsv escapes quotes, commas and newlines and neutralises formula starts", () => {
  const cols = [{ key: "a", label: "Name" }, { key: "b", label: "Note, long" }, { key: "n", label: "N" }];
  const csv = toCsv([
    { a: 'Say "hi"', b: "x,y", n: -3 },
    { a: "=HYPERLINK(1)", b: "line1\nline2", n: 4 },
    { a: "+1", b: "@me", n: null },
    { a: "-x", b: ["p", "q"], n: 0 },
  ], cols);
  assert.equal(csv, [
    'Name,"Note, long",N',
    '"Say ""hi""","x,y",-3',
    "'=HYPERLINK(1),\"line1\nline2\",4",
    "'+1,'@me,",
    "'-x,p; q,0",
  ].join("\r\n") + "\r\n");
});

test("toCsv neutralises tab and carriage return starts and formula starts after leading spaces", () => {
  const cols = [{ key: "a", label: "A" }, { key: "b", label: "B" }];
  const csv = toCsv([
    { a: "\t=1", b: "  =SUM(A1)" },
    { a: "\r=1", b: " safe" },
  ], cols);
  assert.equal(csv, [
    "A,B",
    "'\t=1,'  =SUM(A1)",
    "\"'\r=1\", safe",
  ].join("\r\n") + "\r\n");
});

test("filtering 5,000 rows stays well under a frame budget per keystroke (measured)", () => {
  const rows = [];
  for (let i = 0; i < 5000; i++) {
    rows.push(toRow(doc("role--" + i, { type: "role", key: String(i), status: i % 7 ? "active" : "dropped", sources: ["jobs-watch"],
      lastSeen: "2026-10-" + String(1 + (i % 28)).padStart(2, "0") + "T00:00:00Z",
      display: { title: "Role " + i + (i % 3 ? " engineer" : " analyst"), market: i % 2 ? "NZ" : "AU", salary: i % 200 } })));
  }
  const t0 = performance.now();
  const out = applyFilters(rows, { q: "engineer", fields: { market: "NZ" }, sort: { field: "salary", dir: "desc" }, now: NOW });
  const ms = performance.now() - t0;
  console.log("applyFilters 5000 rows: " + ms.toFixed(1) + " ms, " + out.length + " matched");
  assert.ok(out.length > 0);
  assert.ok(ms < 500, ms + " ms");
});

// ---------- Entity ----------

test("sparkPoints keeps numeric sighting values in time order", () => {
  const s = [
    { at: "2026-10-02T00:00:00Z", values: { salary: 100 } },
    { at: "2026-10-01T00:00:00Z", values: { salary: 90 } },
    { at: "2026-10-03T00:00:00Z", values: { salary: "n/a" } },
    { at: "2026-10-04T00:00:00Z", values: {} },
  ];
  assert.deepEqual(sparkPoints(s, "salary"), [{ at: "2026-10-01T00:00:00Z", v: 90 }, { at: "2026-10-02T00:00:00Z", v: 100 }]);
});

test("the entity route carries the doc id after the type", () => {
  assert.equal(entityIdFromRoute({ type: "company", key: "northwind-example" }), "company--northwind-example");
  assert.equal(entityIdFromRoute({ type: "company", key: "jobs-watch--x" }), "company--jobs-watch--x");
});

// ---------- Views ----------

const VIEW_DEFN = Object.assign({}, DEFN, {
  views: [{ id: "latest", type: "role", name: "Latest roles", filters: { status: "active" }, sort: { field: "lastSeen", dir: "desc" }, columns: ["title"] }],
});

test("groupViews groups saved and built-in views by type, human and agent made", () => {
  const groups = groupViews([
    doc("v1", { name: "Hiring this week", state: "proposed", madeBy: "agent", producer: "jobs-watch", type: "role" }),
    doc("v2", { name: "Mine", state: "kept", madeBy: "human", type: "role" }),
    doc("v3", { name: "Big ones", state: "kept", madeBy: "human", type: "company" }),
    doc("v4", { name: "Orphan", madeBy: "human", type: "gone" }),
  ], VIEW_DEFN);
  assert.deepEqual(groups.map((g) => [g.type, g.label]), [["company", "Companies"], ["gone", "gone"], ["role", "Roles"]]);
  const role = groups[2].views.map((v) => [v.id, v.builtIn]);
  assert.deepEqual(role, [["v1", false], ["latest", true], ["v2", false]]);
});

test("a view and the Browse filter state convert both ways", () => {
  const fs = { q: "eng", status: "dropped", starred: true, tag: "warm", source: "lead-signals", reason: "too old",
    window: "week", fields: { market: "NZ" }, sort: { field: "salary", dir: "asc" }, group: "market", cols: ["title", "salary"] };
  const v = filterStateToView(fs);
  assert.deepEqual(v.filters, { q: "eng", status: "dropped", starred: true, tag: "warm", source: "lead-signals", reason: "too old", fields: { market: "NZ" } });
  assert.deepEqual(viewToFilterState(v), fs);
  const builtIn = viewToFilterState(VIEW_DEFN.views[0]);
  assert.equal(builtIn.status, "active");
  assert.deepEqual(builtIn.cols, ["title"]);
  assert.deepEqual(viewToFilterState({}).sort, { field: "lastSeen", dir: "desc" });
});

test("saving over an agent view keeps who made it; a new view is human made", () => {
  const fs = viewToFilterState({ filters: { status: "active" } });
  const base = { name: "Hiring this week", state: "kept", madeBy: "agent", producer: "jobs-watch", type: "role", filters: {} };
  const over = viewDoc(fs, { type: "role", name: "Hiring now", base: base, at: "2026-10-28T09:00:00Z", by: "u_1" });
  assert.equal(over.madeBy, "agent");
  assert.equal(over.producer, "jobs-watch");
  assert.equal(over.state, "kept");
  assert.equal(over.name, "Hiring now");
  assert.deepEqual(over.filters, { status: "active" });
  assert.equal(over.updatedBy, "u_1");
  const fresh = viewDoc(fs, { type: "role", name: "Mine", at: "2026-10-28T09:00:00Z", by: null });
  assert.equal(fresh.madeBy, "human");
  assert.equal(fresh.state, "kept");
  assert.equal("producer" in fresh, false);
});

// ---------- Settings ----------

const ENTRIES = {
  toggle: { name: "include_remote", type: "toggle", default: true, label: "Include remote roles", example: "on" },
  number: { name: "max_inbox_per_run", type: "number", default: 5, min: 1, max: 20, cost_note: "each message is one Inbox doc" },
  choice: { name: "digest", type: "choice", default: "daily", choices: ["daily", "weekly"] },
  list: { name: "excluded_companies", type: "list", default: [], role: "exclude", example: "Contoso" },
};

test("controlSpec picks the control by type and falls back to the default value and a plain label", () => {
  assert.deepEqual(controlSpec(ENTRIES.toggle, undefined), { kind: "toggle", name: "include_remote", label: "Include remote roles",
    value: true, example: "on", costNote: "", min: null, max: null, choices: [] });
  const n = controlSpec(ENTRIES.number, 8);
  assert.deepEqual([n.kind, n.label, n.value, n.min, n.max, n.costNote], ["number", "Max inbox per run", 8, 1, 20, "each message is one Inbox doc"]);
  assert.deepEqual(controlSpec(ENTRIES.choice, undefined).choices, ["daily", "weekly"]);
  assert.deepEqual(controlSpec(ENTRIES.list, ["A"]).value, ["A"]);
  assert.equal(controlSpec({ name: "odd", type: "mystery", default: "x" }, undefined).kind, "text");
});

test("checkSetting states what is wrong in plain words", () => {
  assert.equal(checkSetting(ENTRIES.number, 5), "");
  assert.equal(checkSetting(ENTRIES.number, 0), "At least 1.");
  assert.equal(checkSetting(ENTRIES.number, 21), "At most 20.");
  assert.equal(checkSetting(ENTRIES.number, NaN), "Enter a number.");
  assert.equal(checkSetting(ENTRIES.choice, "hourly"), "Choose one of the listed values.");
  assert.equal(checkSetting(ENTRIES.list, ["a"]), "");
});

test("list edits trim, skip blanks and duplicates ignoring case, and never mutate", () => {
  const list = ["Contoso"];
  assert.deepEqual(listAdd(list, "  Fabrikam "), ["Contoso", "Fabrikam"]);
  assert.deepEqual(listAdd(list, "contoso"), ["Contoso"]);
  assert.deepEqual(listAdd(list, "   "), ["Contoso"]);
  assert.deepEqual(listRemove(["a", "b"], "a"), ["b"]);
  assert.deepEqual(list, ["Contoso"]);
});

test("changedValues keeps only keys that differ from the loaded values", () => {
  assert.deepEqual(changedValues({ a: 1, b: ["x"], c: true }, { a: 1, b: ["x", "y"], c: false }), { b: ["x", "y"], c: false });
  assert.deepEqual(changedValues({ a: 1 }, { a: 1 }), {});
});

// A minimal DOM shim: enough of document for ui.js el() and the setting controls.
class FakeNode {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.nodeType = 1; this.childNodes = []; this.attributes = {}; this.listeners = {}; }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  removeAttribute(k) { delete this.attributes[k]; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  appendChild(c) { this.childNodes.push(c); return c; }
  removeChild(c) { this.childNodes = this.childNodes.filter((x) => x !== c); return c; }
  get firstChild() { return this.childNodes[0] || null; }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(""); }
  set textContent(v) { this.childNodes = [{ nodeType: 3, textContent: String(v) }]; }
  fire(t) { (this.listeners[t] || []).forEach((f) => f({ target: this })); }
}
function findAll(node, tag) {
  const out = [];
  (function walk(n) { if (n.tagName === tag.toUpperCase()) out.push(n); (n.childNodes || []).forEach(walk); })(node);
  return out;
}
function withDom(fn) {
  const saved = globalThis.document;
  globalThis.document = { createElement: (t) => new FakeNode(t), createElementNS: (_ns, t) => new FakeNode(t),
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }) };
  Object.assign(globalThis, require(SRC + "ui.js"), require(SRC + "icons.js"));
  try { return fn(); } finally { globalThis.document = saved; }
}

test("settingControl builds a labelled control per type and reports typed values", () => withDom(() => {
  const got = [];
  const num = settingControl(ENTRIES.number, 5, (v) => got.push(v));
  const input = findAll(num, "input")[0];
  assert.equal(input.getAttribute("type"), "number");
  assert.equal(input.getAttribute("min"), "1");
  assert.equal(input.getAttribute("max"), "20");
  assert.equal(findAll(num, "label").length, 1);
  assert.match(num.textContent, /Max inbox per run/);
  assert.match(num.textContent, /each message is one Inbox doc/);
  input.value = "7";
  input.fire("change");
  assert.deepEqual(got, [7]);

  const tog = settingControl(ENTRIES.toggle, false, (v) => got.push(v));
  const box = findAll(tog, "input")[0];
  assert.equal(box.getAttribute("type"), "checkbox");
  box.checked = true;
  box.fire("change");
  assert.equal(got[got.length - 1], true);

  const ch = settingControl(ENTRIES.choice, "weekly", (v) => got.push(v));
  assert.deepEqual(findAll(ch, "option").map((o) => o.textContent), ["daily", "weekly"]);

  const list = settingControl(ENTRIES.list, ["Contoso"], (v) => got.push(v));
  const remove = findAll(list, "button").filter((b) => b.getAttribute("aria-label") === "Remove Contoso")[0];
  assert.ok(remove, "each list value has a labelled remove button");
  remove.fire("click");
  assert.deepEqual(got[got.length - 1], []);
  const add = findAll(list, "input")[0];
  add.value = "Fabrikam";
  findAll(list, "button").filter((b) => b.textContent === "Add")[0].fire("click");
  assert.deepEqual(got[got.length - 1], ["Fabrikam"], "the control keeps its own list between edits");
  assert.match(list.textContent, /Example: Contoso/);
}));

// ---------- Runs and health ----------

const DAY = 864e5;

test("scheduleInterval reads the cron forms the templates use and gives up on the rest", () => {
  assert.equal(scheduleInterval("0 22 * * 1"), 7 * DAY);
  assert.equal(scheduleInterval("0 22 * * 1,4"), 4 * DAY, "Thursday to Monday is the longest gap");
  assert.equal(scheduleInterval("0 22 * * 1-5"), 3 * DAY, "Friday to Monday");
  assert.equal(scheduleInterval("0 22 * * *"), DAY);
  assert.equal(scheduleInterval("0 * * * *"), 3600e3);
  assert.equal(scheduleInterval("*/30 * * * *"), 1800e3);
  assert.equal(scheduleInterval("0 22 1 * *"), null, "day of month is not read");
  assert.equal(scheduleInterval(""), null);
  assert.equal(scheduleInterval("every day"), null);
  assert.equal(scheduleInterval("0 25 * * *"), null);
});

test("isLate flags a last run older than twice the interval, and says unknown otherwise", () => {
  const now = "2026-10-28T09:00:00Z";
  assert.equal(isLate("2026-10-19T22:00:00Z", "0 22 * * 1", now), false, "weekly, 8.5 days ago");
  assert.equal(isLate("2026-10-12T22:00:00Z", "0 22 * * 1", now), true, "weekly, 15.5 days ago");
  assert.equal(isLate("2026-10-23T22:00:00Z", "0 22 * * 1,4", now), false, "twice weekly, 4.5 days ago");
  assert.equal(isLate("2026-10-19T22:00:00Z", "0 22 * * 1,4", now), true, "twice weekly, 8.5 days ago");
  assert.equal(isLate("2026-10-28T08:30:00Z", "0 * * * *", now), false, "hourly, 30 minutes ago");
  assert.equal(isLate("2026-10-28T06:00:00Z", "0 * * * *", now), true, "hourly, 3 hours ago");
  assert.equal(isLate("2026-10-01T00:00:00Z", "0 22 1 * *", now), null);
  assert.equal(isLate(null, "0 22 * * 1", now), null);
  assert.equal(isLate("not a date", "0 22 * * 1", now), null);
});

test("nextRun gives the next fire time in UTC", () => {
  assert.equal(nextRun("0 22 * * 1-5", "2026-10-28T09:00:00Z"), "2026-10-28T22:00:00.000Z");
  assert.equal(nextRun("0 22 * * 1-5", "2026-10-31T09:00:00Z"), "2026-11-02T22:00:00.000Z");
  assert.equal(nextRun("*/30 * * * *", "2026-10-28T09:10:00Z"), "2026-10-28T09:30:00.000Z");
  assert.equal(nextRun("0 22 1 * *", "2026-10-28T09:00:00Z"), null);
});

test("drop reasons link to Browse filtered to that exact reason, biggest first", () => {
  const run = {
    droppedByReason: { "closed": 1, "excluded by excluded_companies": 2 },
    dropped: [{ id: "role--a", reason: "closed" }, { id: "role--b", reason: "excluded by excluded_companies" }],
  };
  assert.deepEqual(dropReasonLinks(run, { types: ["company", "role"] }), [
    { reason: "excluded by excluded_companies", count: 2, href: "#/browse/role?status=dropped&reason=excluded+by+excluded_companies" },
    { reason: "closed", count: 1, href: "#/browse/role?status=dropped&reason=closed" },
  ]);
  assert.equal(dropReasonLinks({ droppedByReason: { gone: 3 } }, { types: ["company"] })[0].href, "#/browse/company?status=dropped&reason=gone",
    "with no sample ids the producer's first type is used");
  assert.equal(dropReasonLinks({ droppedByReason: { gone: 3 } }, null)[0].href, null, "no type, no link");
  assert.deepEqual(dropReasonLinks({}, null), []);
});

test("settingsDiff lists every key with both values and marks only the ones that changed", () => {
  assert.deepEqual(settingsDiff({ a: 1, b: ["x"] }, { a: 2, b: ["x"], c: true }), [
    { name: "a", used: 1, current: 2, differs: true },
    { name: "b", used: ["x"], current: ["x"], differs: false },
    { name: "c", used: undefined, current: true, differs: true },
  ]);
  assert.deepEqual(settingsDiff(null, null), []);
});

test("sourcesLine states parsed of claimed with exact numbers", () => {
  assert.equal(sourcesLine({ parsed: 2, claimed: 3 }), "parsed 2 of 3 sources");
  assert.equal(sourcesLine({ parsed: 1, claimed: 1 }), "parsed 1 of 1 source");
  assert.equal(sourcesLine({}), "");
});

// ---------- Designed states ----------

test("stateView states each case in fixed words with one next action", () => withDom(() => {
  Object.assign(globalThis, require(SRC + "actions.js"));
  const { stateView } = require(SRC + "states.js");
  let retried = 0, cleared = 0;
  const err = stateView("read-error", { collection: "roles", onRetry: () => retried++ });
  assert.match(err.textContent, /Could not read roles\./);
  findAll(err, "button").filter((b) => b.textContent === "Try again")[0].fire("click");
  assert.equal(retried, 1);

  const empty = stateView("empty-filter", { plural: "roles", onClear: () => cleared++ });
  assert.match(empty.textContent, /No roles match these filters\./);
  findAll(empty, "button").filter((b) => b.textContent === "Clear filters")[0].fire("click");
  assert.equal(cleared, 1);

  assert.equal(stateView("no-db").textContent, "This page needs the db capability. Republish it with db declared.");
  assert.match(stateView("loading", { label: "companies" }).textContent, /^Loading companies/);
  assert.match(stateView("quiet").textContent, /^Nothing needs you\./);
  assert.equal(stateView("per-viewer-off").textContent, "Read and done are not available for this visit.");
  assert.match(stateView("not-set-up", { name: "Hiring watch" }).textContent, /routineos\.py seed <routine-folder> --out <batch-dir>/);
  assert.match(stateView("first-run", { next: [{ label: "Jobs watch", at: "2026-10-28T22:00:00.000Z" }] }).textContent,
    /Jobs watch runs next at 2026-10-28 22:00 UTC/);
  assert.match(stateView("first-run", { next: [{ label: "Jobs watch", at: null }] }).textContent, /Jobs watch has not run yet/);
  assert.match(stateView("first-run", { plural: "roles", sources: ["Jobs watch"], settings: ["markets"] }).textContent,
    /No roles yet\. They appear after Jobs watch runs\. Shaped by the setting markets\./);
}));

test("browseFirstRun names the producers and settings for a type from the settingFilters list", () => {
  const { browseFirstRun } = require(SRC + "pages/browse.js");
  const producers = [{ id: "jobs-watch", label: "Jobs watch", types: ["role", "company"] }, { id: "tenders", label: "Tenders", types: ["tender"] }];
  const defn = { producers, types: { role: { settingFilters: [
    { producer: "jobs-watch", setting: "markets", field: "market" }, { producer: "jobs-watch", setting: "markets", field: "city" }] } } };
  assert.deepEqual(browseFirstRun(defn, "role"), { sources: ["Jobs watch"], settings: ["markets"] });
  assert.deepEqual(browseFirstRun({ producers, types: { tender: {} } }, "tender"), { sources: ["Tenders"], settings: [] });
});

test("gateLine says how a gate travels, when it times out and how it ended", () => {
  assert.equal(gateLine({ transport: "email", timeoutHours: 48, status: "waiting" }), "Gate by email, times out after 48 hours.");
  assert.equal(gateLine({ transport: "slack", status: "approved", outcome: "sent" }), "Gate by slack, approved: sent.");
  assert.equal(gateLine(null), "");
});

test("Browse columns follow the declared field order, not object key order", () => {
  const t = { order: ["title", "company", "market"],
    fields: { company: { type: "text", summary: true }, market: { type: "text", summary: true }, title: { label: "Title", type: "text", summary: true } } };
  const cols = browseColumns(t, [], "role");
  assert.deepEqual(cols.filter((c) => !c.meta).map((c) => c.key), ["title", "company", "market"]);
  assert.equal(cols[0].label, "Title");
  assert.deepEqual(defaultCols(cols), ["title", "company", "market", "lastSeen"]);
});

// ---------- Icons, icon buttons and the star toggle ----------

const REQUIRED_ICONS = ["star", "star-filled", "pencil", "check", "x", "external-link", "chevron-down", "filter", "columns-3",
  "download", "triangle-alert", "search", "sun", "moon", "monitor", "bell", "menu", "panel-left", "rows-3",
  // navigation icons (NAV_ICONS in definition.py)
  "house", "inbox", "badge-check", "history", "settings", "list", "dot", "building-2", "briefcase", "user", "users",
  "video", "file-text", "mail", "message-square", "calendar", "receipt", "tag", "folder", "newspaper", "git-pull-request", "chart-line", "circle-help", "rss", "file-search", "package", "globe", "link"];
const useHref = (node) => findAll(node, "use").map((u) => u.getAttribute("href"));

test("the sprite holds a 24 grid currentColor symbol per icon and icon() points at it", () => withDom(() => {
  const sprite = iconSprite();
  assert.equal(sprite.getAttribute("aria-hidden"), "true");
  const symbols = findAll(sprite, "symbol");
  assert.deepEqual(symbols.map((s) => s.getAttribute("id")).sort(), REQUIRED_ICONS.map((n) => "icon-" + n).sort());
  for (const s of symbols) {
    assert.equal(s.getAttribute("viewBox"), "0 0 24 24");
    assert.equal(s.getAttribute("stroke"), "currentColor");
    assert.equal(s.getAttribute("fill"), "none");
    assert.ok(s.childNodes.length > 0, s.getAttribute("id"));
  }
  const filled = symbols.filter((s) => s.getAttribute("id") === "icon-star-filled")[0];
  assert.equal(filled.childNodes[0].getAttribute("fill"), "currentColor");
  assert.deepEqual(useHref(icon("pencil")), ["#icon-pencil"]);
  assert.equal(icon("pencil").getAttribute("aria-hidden"), "true");
  assert.throws(() => icon("sparkles"), /No icon called sparkles/);
}));

test("an icon-only button names itself by aria-label and title, with no visible text", () => withDom(() => {
  const b = button("Remove Contoso", () => {}, { icon: "x", iconOnly: true });
  assert.equal(b.getAttribute("aria-label"), "Remove Contoso");
  assert.equal(b.getAttribute("title"), "Remove Contoso");
  assert.equal(b.textContent, "");
  assert.equal(b.className, "ghost icon-btn");
  assert.equal(b.getAttribute("aria-pressed"), null);
  const text = button("Export CSV", null, { icon: "download" });
  assert.equal(text.textContent, "Export CSV");
  assert.equal(text.getAttribute("aria-label"), null);
  assert.deepEqual(useHref(text), ["#icon-download"]);
  assert.equal(button("Save", null, { primary: true }).className, "primary");
}));

test("the star toggle is an icon button with aria-pressed and a label naming the item", () => withDom(() => {
  const { starToggle } = require(SRC + "actions.js");
  const ctx = { store: { readOnly: false }, viewer: "u_1" };
  const off = starToggle(ctx, "Staff engineer", false, () => {});
  assert.equal(off.getAttribute("aria-label"), "Star Staff engineer");
  assert.equal(off.getAttribute("title"), "Star Staff engineer");
  assert.equal(off.getAttribute("aria-pressed"), "false");
  assert.equal(off.textContent, "");
  assert.deepEqual(useHref(off), ["#icon-star"]);
  const on = starToggle(ctx, "Staff engineer", true, () => {});
  assert.equal(on.getAttribute("aria-label"), "Unstar Staff engineer");
  assert.equal(on.getAttribute("aria-pressed"), "true");
  assert.deepEqual(useHref(on), ["#icon-star-filled"]);
  const ro = starToggle({ store: { readOnly: true } }, "Staff engineer", false, () => {});
  assert.equal(ro.getAttribute("aria-label"), "Star Staff engineer");
  assert.equal(ro.getAttribute("title"), "Demo data, read only");
}));

test("an action button stops its click at itself", () => withDom(() => {
  const { actionButton } = require(SRC + "actions.js");
  let stopped = 0, ran = 0;
  const b = actionButton({ store: { readOnly: false }, viewer: "u_1" }, "Done", () => { ran++; });
  (b.listeners.click || []).forEach((f) => f({ target: b, stopPropagation: () => stopped++ }));
  assert.equal(stopped, 1);
  return Promise.resolve().then(() => assert.equal(ran, 1));
}));

// ---------- Copy and states ----------

test("a proposal without from or to names the setting only, never undefined", () => {
  globalThis.normalizeProposal = require(SRC + "actions.js").normalizeProposal;
  const { proposalText } = require(SRC + "pages/today.js");
  const { proposalDiff } = require(SRC + "pages/inbox.js");
  assert.equal(proposalText("Jobs watch", { setting: "markets", from: ["NZ"], to: ["NZ", "AU"] }),
    'Jobs watch proposes markets: from ["NZ"] to ["NZ","AU"].');
  assert.equal(proposalText("Jobs watch", { setting: "markets" }), "Jobs watch proposes a change to markets.");
  assert.equal(proposalText("Jobs watch", { setting: "markets", to: ["AU"] }), "Jobs watch proposes a change to markets.");
  assert.equal(proposalText("Jobs watch", {}), null);
  assert.equal(proposalText("Jobs watch", undefined), null);
  assert.equal(proposalDiff({ setting: "markets" }), "markets");
  assert.equal(proposalDiff({ setting: "markets", from: [], to: ["AU"] }), 'markets: [] to ["AU"]');
});

test("proposal copy reads the legacy current and suggested shape as from and to", () => {
  globalThis.normalizeProposal = require(SRC + "actions.js").normalizeProposal;
  const { proposalText } = require(SRC + "pages/today.js");
  const { proposalDiff } = require(SRC + "pages/inbox.js");
  const legacy = { setting: "title_keywords", current: ["Shopify"], suggested: ["Shopify", "Hydrogen"] };
  assert.equal(proposalText("Jobs watch", legacy), 'Jobs watch proposes title_keywords: from ["Shopify"] to ["Shopify","Hydrogen"].');
  assert.equal(proposalDiff(legacy), 'title_keywords: ["Shopify"] to ["Shopify","Hydrogen"]');
});

// ---------- Accepting a proposal ----------

function proposalStore(docs) {
  const writes = [];
  return {
    readOnly: false, docs, writes,
    get: async (path) => ({ exists: path in docs, data: docs[path] }),
    set: async (path, data) => { writes.push(path); docs[path] = data; },
  };
}

const PROPOSAL_DEFN = { producers: [{ id: "jobs-watch", settings: [{ name: "title_keywords", default: ["Shopify"] }] }] };

test("accept with {setting, from, to} writes the setting, then the decision", async () => {
  const { acceptProposal } = require(SRC + "actions.js");
  const store = proposalStore({ "settings/jobs-watch": { values: { title_keywords: ["Shopify"], markets: ["AU"] } } });
  const ctx = { store, viewer: "u_1", definition: PROPOSAL_DEFN };
  await acceptProposal(ctx, doc("r1--1", { producer: "jobs-watch",
    proposal: { setting: "title_keywords", from: ["Shopify"], to: ["Shopify", "Hydrogen"] } }));
  assert.deepEqual(store.writes, ["settings/jobs-watch", "decisions/r1--1"]);
  assert.deepEqual(store.docs["settings/jobs-watch"].values, { title_keywords: ["Shopify", "Hydrogen"], markets: ["AU"] });
  assert.equal(store.docs["decisions/r1--1"].decision, "accept");
  assert.equal(store.docs["decisions/r1--1"].by, "u_1");
});

test("accept with the legacy {current, suggested} shape writes the suggested value", async () => {
  const { acceptProposal } = require(SRC + "actions.js");
  const store = proposalStore({ "settings/jobs-watch": { values: { markets: ["AU"] } } });
  const ctx = { store, viewer: "u_1", definition: PROPOSAL_DEFN };
  await acceptProposal(ctx, doc("r1--2", { producer: "jobs-watch",
    proposal: { setting: "title_keywords", current: ["Shopify"], suggested: ["Shopify", "headless"] } }));
  assert.deepEqual(store.writes, ["settings/jobs-watch", "decisions/r1--2"]);
  assert.deepEqual(store.docs["settings/jobs-watch"].values, { markets: ["AU"], title_keywords: ["Shopify", "headless"] });
  assert.equal(store.docs["decisions/r1--2"].decision, "accept");
});

test("accept with a malformed proposal writes nothing, records no decision and states the error", async () => {
  const { acceptProposal, actionButton } = require(SRC + "actions.js");
  const before = { values: { title_keywords: ["Shopify"] } };
  const store = proposalStore({ "settings/jobs-watch": before });
  const ctx = { store, viewer: "u_1", definition: PROPOSAL_DEFN };
  const bad = [{ setting: "title_keywords" }, { from: ["Shopify"], to: ["AU"] }, { setting: "title_keywords", current: ["Shopify"] }, "markets", null];
  for (const [i, p] of bad.entries()) {
    await assert.rejects(() => acceptProposal(ctx, doc("r1--" + i, { producer: "jobs-watch", proposal: p })), /names no setting or no new value/);
  }
  assert.deepEqual(store.writes, []);
  assert.equal(store.docs["settings/jobs-watch"], before);
  assert.deepEqual(Object.keys(store.docs), ["settings/jobs-watch"]);
  // The Accept button states the refusal in its status line, the same place every other failed write shows.
  const { b, status } = withDom(() => {
    const status = new FakeNode("span");
    const b = actionButton(ctx, "Accept", () => acceptProposal(ctx, doc("r1--9", { producer: "jobs-watch", proposal: { setting: "title_keywords" } })), { status });
    return { b, status };
  });
  (b.listeners.click || []).forEach((f) => f({ target: b }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(status.textContent, "Not saved: this proposal names no setting or no new value");
  assert.equal(b.disabled, false);
  assert.deepEqual(store.writes, []);
});

test("the Inbox has a designed empty state per filter", () => withDom(() => {
  Object.assign(globalThis, require(SRC + "actions.js"));
  const { stateView } = require(SRC + "states.js");
  assert.match(stateView("inbox-empty", { filter: "all" }).textContent, /^No messages yet\./);
  assert.match(stateView("inbox-empty", { filter: "unread" }).textContent, /^Nothing unread\./);
  assert.match(stateView("inbox-empty", { filter: "done" }).textContent, /^Nothing marked done yet\./);
  assert.match(stateView("inbox-empty", {}).textContent, /^No messages yet\./);
}));

test("shortLabel shows a URL as its host and leaves other text alone", () => withDom(() => {
  assert.equal(shortLabel("https://www.jobs.example.au/role/49"), "jobs.example.au");
  assert.equal(shortLabel("http://acme.test/x"), "acme.test");
  assert.equal(shortLabel("acme.test"), "acme.test");
  assert.equal(shortLabel("role--x"), "role--x");
}));

test("a role is titled by its title, with its company as the subtitle", () => {
  const { recordTitle, recordSubtitle } = require(SRC + "pages/entity.js");
  const role = { order: ["title", "company", "url"], links: ["company"],
    fields: { company: { summary: true }, title: { summary: true }, url: {} } };
  const d = { key: "https://jobs.example.au/1", display: { company: "Acme", title: "Staff engineer", url: "https://jobs.example.au/1" } };
  assert.equal(recordTitle(role, d), "Staff engineer");
  assert.equal(recordSubtitle(role, d), "Acme");
  assert.equal(recordSubtitle({ fields: {} }, d), "");
});

test("Browse hides dropped by default and status=all shows them", () => {
  assert.equal(readFilterState({}).status, "active");
  assert.equal(readFilterState({ status: "all" }).status, "all");
  assert.equal(readFilterState({ status: "nonsense" }).status, "active");
  assert.equal(writeFilterState(readFilterState({ status: "all" })), "status=all");
  const rs = [{ id: "a", status: "active", f: {}, a: {} }, { id: "b", status: "dropped", f: {}, a: {} }];
  assert.deepEqual(applyFilters(rs, readFilterState({})).map((r) => r.id), ["a"]);
  assert.deepEqual(applyFilters(rs, readFilterState({ status: "all" })).map((r) => r.id).sort(), ["a", "b"]);
});

// ---------- Keeping a dropped record ----------

const KEPT = { decision: "keep", at: "2026-10-28T01:05:00Z", by: "u_1" };
const sighting = (at, extra) => Object.assign({ run: "r-" + at, at, outcome: "updated", dropReason: null }, extra || {});

test("keepState reads the stored status, the keep decision and the latest sighting note", () => {
  const { keepState } = require(SRC + "pages/entity.js");
  const dropped = { status: "dropped", dropReason: "not in markets", sightings: [sighting("2026-10-01T00:00:00Z", { dropReason: "not in markets" })] };
  const kept = { status: "active", sightings: [sighting("2026-10-01T00:00:00Z"), sighting("2026-10-08T00:00:00Z", { note: "kept by person" })] };
  assert.equal(keepState(dropped, null), "dropped");
  assert.equal(keepState(dropped, KEPT), "kept-pending");
  assert.equal(keepState(kept, KEPT), "kept");
  assert.equal(keepState(kept, null), "drop-pending");
  assert.equal(keepState({ status: "active", sightings: [sighting("2026-10-01T00:00:00Z")] }, null), "active");
  assert.equal(keepState(dropped, { decision: "dismiss" }), "dropped");
});

function keepStore(docs) {
  const writes = [];
  return {
    readOnly: false, docs, writes,
    get: async (path) => ({ exists: path in docs, data: docs[path] }),
    set: async (path, data) => { writes.push(["set", path]); docs[path] = data; },
    del: async (path) => { writes.push(["delete", path]); delete docs[path]; },
  };
}

async function click(section, label) {
  const b = findAll(section, "button").find((n) => n.textContent === label);
  assert.ok(b, "no button " + label + " in " + section.textContent);
  (b.listeners.click || []).forEach((f) => f({ target: b }));
  await new Promise((r) => setTimeout(r, 0));
}

test("Keep this role writes decisions/<entityId> as a keep by the viewer, and the pending state says so", async () => {
  const { statusSection, KEEP_NOTE } = require(SRC + "pages/entity.js");
  const store = keepStore({});
  const ctx = { store, viewer: "u_1" };
  const t = { label: "Role", fields: {} };
  const dropped = { status: "dropped", dropReason: "not in title_keywords", sightings: [] };
  let reloads = 0;
  const sec = withDom(() => { Object.assign(globalThis, require(SRC + "actions.js")); return statusSection(ctx, "role--x", t, "role", dropped, null, () => { reloads++; }); });
  assert.match(sec.textContent, /Dropped: not in title_keywords/);
  await withDom(() => click(sec, "Keep this role"));
  assert.deepEqual(store.writes, [["set", "decisions/role--x"]]);
  assert.equal(store.docs["decisions/role--x"].decision, "keep");
  assert.equal(store.docs["decisions/role--x"].by, "u_1");
  assert.match(store.docs["decisions/role--x"].at, /^\d{4}-\d\d-\d\dT/);
  assert.equal(reloads, 1);
  const pending = withDom(() => statusSection(ctx, "role--x", t, "role", dropped, store.docs["decisions/role--x"], () => {}));
  assert.match(pending.textContent, /Kept \(pending next run\)/);
  assert.ok(pending.textContent.includes(KEEP_NOTE));
  assert.ok(findAll(pending, "button").some((n) => n.textContent === "Drop again"));
});

test("Drop again removes the keep decision", async () => {
  const { statusSection } = require(SRC + "pages/entity.js");
  const store = keepStore({ "decisions/role--x": KEPT });
  const ctx = { store, viewer: "u_1" };
  const kept = { status: "active", sightings: [sighting("2026-10-08T00:00:00Z", { note: "kept by person" })] };
  const sec = withDom(() => { Object.assign(globalThis, require(SRC + "actions.js")); return statusSection(ctx, "role--x", { label: "Role" }, "role", kept, KEPT, () => {}); });
  assert.match(sec.textContent, /^Status\s*Kept/);
  await withDom(() => click(sec, "Drop again"));
  assert.deepEqual(store.writes, [["delete", "decisions/role--x"]]);
  assert.equal("decisions/role--x" in store.docs, false);
  const after = withDom(() => statusSection(ctx, "role--x", { label: "Role" }, "role", kept, null, () => {}));
  assert.match(after.textContent, /Drop again \(pending next run\)/);
  assert.ok(findAll(after, "button").some((n) => n.textContent === "Keep this role"));
});

// ---------- Self-improving: per-item proposals and Suggestions ----------

const LEARN_DEFN = { producers: [{ id: "jobs-watch", settings: [
  { name: "title_keywords", default: ["Shopify"] }, { name: "max_inbox_per_run", default: 10 }] }] };
const item = (id, proposal, extra) => doc(id, Object.assign({ producer: "jobs-watch", kind: "proposal", proposal }, extra || {}));

test("per-item add applies to the current value, not the stored to", async () => {
  const { acceptProposal } = require(SRC + "actions.js");
  const store = proposalStore({ "settings/jobs-watch": { values: { title_keywords: ["Shopify", "React"] } } });
  const ctx = { store, viewer: "u_1", definition: LEARN_DEFN };
  await acceptProposal(ctx, item("r2--1", { setting: "title_keywords", op: "add", value: "Hydrogen", level: "L1",
    from: ["Shopify"], to: ["Shopify", "Hydrogen"], key: "title_keywords:add:hydrogen" }));
  assert.deepEqual(store.docs["settings/jobs-watch"].values.title_keywords, ["Shopify", "React", "Hydrogen"]);
  assert.equal(store.docs["decisions/r2--1"].decision, "accept");
  assert.equal(store.docs["decisions/r2--1"].key, "title_keywords:add:hydrogen");
});

test("per-item remove matches case-insensitively and set replaces the number", async () => {
  const { acceptProposal } = require(SRC + "actions.js");
  const store = proposalStore({ "settings/jobs-watch": { values: { title_keywords: ["Shopify", "hydrogen"] } } });
  const ctx = { store, viewer: "u_1", definition: LEARN_DEFN };
  await acceptProposal(ctx, item("r2--2", { setting: "title_keywords", op: "remove", value: "Hydrogen", key: "k1" }));
  assert.deepEqual(store.docs["settings/jobs-watch"].values.title_keywords, ["Shopify"]);
  await acceptProposal(ctx, item("r2--3", { setting: "max_inbox_per_run", op: "set", value: 20, key: "k2" }));
  assert.equal(store.docs["settings/jobs-watch"].values.max_inbox_per_run, 20);
});

test("applyOp adds once, removes by casefold and sets", () => {
  const { applyOp } = require(SRC + "actions.js");
  assert.deepEqual(applyOp(["Shopify"], { op: "add", value: "shopify" }), ["Shopify"]);
  assert.deepEqual(applyOp(undefined, { op: "add", value: "Hydrogen" }), ["Hydrogen"]);
  assert.deepEqual(applyOp(["A", "b"], { op: "remove", value: "B" }), ["A"]);
  assert.equal(applyOp(10, { op: "set", value: 15 }), 15);
});

test("accept refuses L2 and L3 and writes nothing", async () => {
  const { acceptProposal } = require(SRC + "actions.js");
  const store = proposalStore({ "settings/jobs-watch": { values: {} } });
  const ctx = { store, viewer: "u_1", definition: LEARN_DEFN };
  for (const level of ["L2", "L3"]) {
    await assert.rejects(() => acceptProposal(ctx, item("r2--" + level, { level, target: level === "L2" ? "definition" : "prompt",
      change: "Add a salary field", setting: "title_keywords", to: ["x"], key: "definition:l2:abc" })), /opens a PR/);
  }
  assert.deepEqual(store.writes, []);
});

test("reject and snooze write the key, and snooze an until seven days on", async () => {
  const { rejectProposal, snoozeProposal } = require(SRC + "actions.js");
  const store = proposalStore({});
  const ctx = { store, viewer: "u_1", definition: LEARN_DEFN };
  const m = item("r2--5", { setting: "title_keywords", op: "add", value: "Remix", key: "title_keywords:add:remix" });
  await rejectProposal(ctx, m);
  assert.equal(store.docs["decisions/r2--5"].decision, "reject");
  assert.equal(store.docs["decisions/r2--5"].key, "title_keywords:add:remix");
  const now = Date.parse("2026-10-29T00:00:00Z");
  await snoozeProposal(ctx, m, now);
  assert.equal(store.docs["decisions/r2--5"].decision, "snooze");
  assert.equal(store.docs["decisions/r2--5"].until, "2026-11-05T00:00:00.000Z");
  assert.equal(store.docs["decisions/r2--5"].key, "title_keywords:add:remix");
});

test("suggestionList splits open and history and returns an expired snooze to open", () => {
  const { suggestionList } = require(SRC + "pages/suggestions.js");
  const now = Date.parse("2026-10-29T00:00:00Z");
  const msgs = [
    item("a", { setting: "s", op: "add", value: "x" }, { createdAt: "2026-10-27T00:00:00Z" }),
    item("b", { setting: "s", op: "add", value: "y" }, { createdAt: "2026-10-28T00:00:00Z" }),
    item("c", { setting: "s", op: "add", value: "z" }, { createdAt: "2026-10-26T00:00:00Z" }),
    item("d", { setting: "s", op: "add", value: "w" }, { createdAt: "2026-10-25T00:00:00Z" }),
    doc("e", { kind: "match", title: "not a proposal" }),
  ];
  const decisions = {
    a: { decision: "reject", at: "2026-10-28T00:00:00Z" },
    c: { decision: "snooze", until: "2026-10-28T00:00:00Z" },
    d: { decision: "snooze", until: "2026-11-02T00:00:00Z" },
  };
  const { open, history } = suggestionList(msgs, decisions, now);
  assert.deepEqual(open.map((m) => m.id), ["b", "c"]);
  assert.deepEqual(history.map((m) => m.id), ["a", "d"]);
});

test("a snooze without until stays snoozed", () => {
  const { suggestionList, snoozedNow } = require(SRC + "pages/suggestions.js");
  const now = Date.parse("2026-10-29T00:00:00Z");
  const { open, history } = suggestionList([item("a", { setting: "s", op: "add", value: "x" })], { a: { decision: "snooze" } }, now);
  assert.deepEqual([open.length, history.map((m) => m.id)], [0, ["a"]]);
  assert.equal(snoozedNow({ decision: "snooze" }, now), true);
  assert.equal(snoozedNow({ decision: "snooze", until: "2026-10-28T00:00:00Z" }, now), false);
  assert.equal(snoozedNow({ decision: "reject" }, now), false);
});

test("history is newest decision first, not newest message", () => {
  const { suggestionList } = require(SRC + "pages/suggestions.js");
  const msgs = [
    item("old", { setting: "s", op: "add", value: "x" }, { createdAt: "2026-10-01T00:00:00Z" }),
    item("new", { setting: "s", op: "add", value: "y" }, { createdAt: "2026-10-20T00:00:00Z" }),
  ];
  const decisions = { old: { decision: "reject", at: "2026-10-25T00:00:00Z" }, new: { decision: "accept", at: "2026-10-21T00:00:00Z" } };
  assert.deepEqual(suggestionList(msgs, decisions, Date.parse("2026-10-29T00:00:00Z")).history.map((m) => m.id), ["old", "new"]);
});

test("accept refuses to empty an include list and writes nothing", async () => {
  const { acceptProposal } = require(SRC + "actions.js");
  const defn = { producers: [{ id: "jobs-watch", settings: [
    { name: "markets", default: ["AU"], role: "include" }, { name: "excluded_companies", default: [], role: "exclude" }] }] };
  const store = proposalStore({ "settings/jobs-watch": { values: { markets: ["AU"], excluded_companies: ["acme.com"] } } });
  const ctx = { store, viewer: "u_1", definition: defn };
  await assert.rejects(() => acceptProposal(ctx, item("r3--1", { setting: "markets", op: "remove", value: "AU", key: "k" })), /empty/);
  await assert.rejects(() => acceptProposal(ctx, item("r3--2", { setting: "markets", from: ["AU"], to: [] })), /empty/);
  assert.deepEqual(store.writes, []);
  await acceptProposal(ctx, item("r3--3", { setting: "excluded_companies", op: "remove", value: "acme.com", key: "k2" }));
  assert.deepEqual(store.docs["settings/jobs-watch"].values.excluded_companies, []);
});

test("suggestion lines name the item, the level and the evidence", () => {
  const { levelLabel, itemLine, evidenceLine } = require(SRC + "pages/suggestions.js");
  assert.equal(itemLine({ setting: "title_keywords", op: "add", value: "Hydrogen" }), "Add Hydrogen to title_keywords");
  assert.equal(itemLine({ setting: "title_keywords", op: "remove", value: "PHP" }), "Remove PHP from title_keywords");
  assert.equal(itemLine({ setting: "max_inbox_per_run", op: "set", value: 15 }), "Set max_inbox_per_run to 15");
  assert.equal(itemLine({ setting: "t", from: ["a"], to: ["a", "b"] }), 't: ["a"] to ["a","b"]');
  assert.equal(itemLine({ level: "L2", target: "definition", change: "Add a salary field" }), "Add a salary field");
  assert.equal(levelLabel({ op: "add" }), "L1 setting");
  assert.equal(levelLabel({}), "L1 setting");
  assert.equal(levelLabel({ level: "L2", target: "definition" }), "L2 definition, opens a PR");
  assert.equal(levelLabel({ level: "L3", target: "prompt" }), "L3 prompt, opens a PR");
  assert.equal(evidenceLine({ count: 3, of: 4, refs: ["role--a", "role--b"] }), "Kept 3 of 4, 2 records linked");
  assert.equal(evidenceLine({ runs: 6 }), "No match for 6 runs");
  assert.equal(evidenceLine({ count: 3, of: 4, runs: 4 }), "3 of the last 4 runs");
  assert.equal(evidenceLine(undefined), "");
});

test("the Suggestions route", () => {
  const { route } = require(SRC + "router.js");
  assert.deepEqual(route("#/suggestions"), { page: "suggestions", params: {} });
});

// ---------- Names through store.profiles on Approvals and Settings history ----------

const tick = () => new Promise((r) => setImmediate(r));

function namesCtx(profiles) {
  const asked = [];
  return { asked, ctx: { viewer: "u_1", store: { profiles: (ids) => { asked.push(ids); return Promise.resolve(profiles); } } } };
}

test("Approvals names the decider through store.profiles, falling back to you and someone", async () => {
  const { ctx, asked } = namesCtx({ u_2: { name: "Sam" } });
  const history = require(SRC + "pages/history.js");
  let item, mine, other;
  withDom(() => {
    Object.assign(globalThis, { gateLine, personWord: history.personWord, fillNames: history.fillNames });
    const { decidedItem } = require(SRC + "pages/approvals.js");
    const names = [];
    item = decidedItem(ctx, { id: "r1--g1", gate: {}, decision: { decision: "approve", at: "2026-10-28T10:00:00Z", by: "u_2" } }, names);
    mine = decidedItem(ctx, { id: "r1--g2", gate: {}, decision: { decision: "reject", at: "2026-10-28T10:00:00Z", by: "u_1" } }, names);
    other = decidedItem(ctx, { id: "r1--g3", gate: {}, decision: { decision: "reject", at: "2026-10-28T10:00:00Z", by: "u_3" } }, names);
    assert.match(item.textContent, / by someone/);
    history.fillNames(ctx, names);
  });
  await tick();
  assert.deepEqual(asked, [["u_2", "u_1", "u_3"]]);
  assert.match(item.textContent, / by Sam/);
  assert.match(mine.textContent, / by you/);
  assert.match(other.textContent, / by someone/);
});

test("Settings history names who changed a setting through store.profiles", async () => {
  const { ctx } = namesCtx({ u_2: { name: "Sam" } });
  const history = require(SRC + "pages/history.js");
  let section;
  withDom(() => {
    Object.assign(globalThis, require(SRC + "actions.js"), { NEXT_RUN_NOTE: "Saved.", personWord: history.personWord, fillNames: history.fillNames });
    const { historySection } = require(SRC + "pages/settings.js");
    section = historySection(ctx, "jobs-watch", [
      { id: "h1", data: { producer: "jobs-watch", at: "2026-10-20T00:00:00Z", by: "u_2", before: { a: 1 }, after: { a: 2 } } },
      { id: "h2", data: { producer: "jobs-watch", at: "2026-10-21T00:00:00Z", by: "u_1", before: { a: 2 }, after: { a: 3 } } },
    ], null);
    assert.doesNotMatch(section.textContent, /Sam/);
  });
  await tick();
  assert.match(section.textContent, /Sam/);
  assert.match(section.textContent, / you /);
});

test("a person's reason shown before the next run is capped at 200 code points, like the contract", () => {
  const { shownReason } = require(SRC + "actions.js");
  const got = shownReason("\u{1F600}" + "y".repeat(10000));
  assert.equal(Array.from(got).length, 200);
  assert.ok(got.startsWith("\u{1F600}y"));
  assert.equal(shownReason("too junior"), "too junior");
});

// ---------- Join a Desk: Workers view, joiner-only approval, owner record, release, learning sources ----------

const MAILBOX = "sales" + "@example.com";
const LK = "sender--sales-example-com-0123456789ab";
const CARD = {
  version: 1, open: true, summary: "Sales outreach", url: "https://claude.ai/artifact/abc", cap: { scope: "desk", maxRunsPerDay: 4 },
  lanes: [
    { id: "sender", label: "Send from {mailbox}", kind: "email-sender", match: { type: "draft", field: "assignee", equals: "{mailbox}" },
      params: { mailbox: { type: "email", ask: "Which mailbox?" } }, connectors: ["gmail"], gate: "send" },
    { id: "reviewer", label: "Review drafts", kind: "email-sender", match: { type: "draft", field: "stage", equals: "review" }, params: {} },
  ],
};
const WORKERS = [
  doc(LK, { lane: "sender", kind: "email-sender", params: { mailbox: MAILBOX }, status: "active", joinedAt: "2026-10-30T00:00:00Z",
    by: "u_2", routineId: "trig_1", schedule: "0 9 * * 1-5" }),
  doc(LK + "--health", { runAt: "2026-10-31T09:00:00Z", outcome: "ok" }),
  doc(LK + "--budget", { day: "2026-10-31", runs: 1 }),
];
const ENTITIES = [
  doc("draft--a", { type: "draft", display: { assignee: "Sales" + "@Example.com" } }),
  doc("draft--b", { type: "draft", display: { assignee: MAILBOX } }),
  doc("draft--c", { type: "draft", display: { assignee: MAILBOX } }),
  doc("draft--d", { type: "draft", status: "dropped", display: { assignee: MAILBOX } }),
  doc("draft--e", { type: "draft", display: { assignee: "other" + "@example.com" } }),
];
const OUTCOMES = [
  doc("draft--a--" + LK, { item: "draft--a", lane: LK, status: "sent" }),
  doc("draft--b--" + LK, { item: "draft--b", lane: LK, status: "drafted" }),
];

test("laneRows two-lane card with one served lane gives one served and one unserved row", () => {
  const { laneRows, fillLabel } = require(SRC + "pages/workers.js");
  const rows = laneRows(CARD, WORKERS, OUTCOMES, [], ENTITIES);
  assert.equal(rows.length, 2);
  const served = rows.find((r) => r.served);
  assert.deepEqual([served.laneId, served.laneKey, served.by, served.label], ["sender", LK, "u_2", "Send from " + MAILBOX]);
  assert.equal(served.lastRun, "2026-10-31T09:00:00Z");
  assert.equal(served.health, "ok");
  const open = rows.find((r) => !r.served);
  assert.deepEqual([open.laneId, open.laneKey, open.by], ["reviewer", null, null]);
  assert.equal(fillLabel("Send from {mailbox}", {}), "Send from <mailbox>");
});

test("laneRows: a left or released worker leaves its lane unserved, and an off-card lane shows nothing", () => {
  const { laneRows } = require(SRC + "pages/workers.js");
  const left = [doc(LK, Object.assign({}, WORKERS[0].data, { status: "left" }))];
  assert.equal(laneRows(CARD, left, [], [], []).filter((r) => r.served).length, 0);
  const rel = [doc("release--" + LK, { decision: "release", at: "2026-10-31T00:00:00Z", by: "u_1" })];
  assert.equal(laneRows(CARD, WORKERS, [], [], [], { decisions: rel, ownerBy: "u_1" }).filter((r) => r.served).length, 0);
  assert.equal(laneRows(CARD, WORKERS, [], [], [], { decisions: rel, ownerBy: "u_9" }).filter((r) => r.served).length, 1);
  // A release naming the holder is final for that holder, whatever joinedAt says; another holder is not released.
  const held = [doc("release--" + LK, { decision: "release", at: "2026-10-01T00:00:00Z", by: "u_1", holder: WORKERS[0].data.by })];
  const later = [doc(LK, Object.assign({}, WORKERS[0].data, { joinedAt: "2099-01-01T00:00:00Z" }))];
  assert.equal(laneRows(CARD, later, [], [], [], { decisions: held, ownerBy: "u_1" }).filter((r) => r.served).length, 0);
  const other = [doc(LK, Object.assign({}, WORKERS[0].data, { by: "u_7" }))];
  assert.equal(laneRows(CARD, other, [], [], [], { decisions: held, ownerBy: "u_1" }).filter((r) => r.served).length, 1);
  const bad = [doc(LK, Object.assign({}, WORKERS[0].data, { joinedAt: "soon" }))];
  assert.equal(laneRows(CARD, bad, [], [], []).filter((r) => r.served).length, 0);
  const off = [doc("ghost--x-0123456789ab", { lane: "ghost", params: {}, status: "active", by: "u_3" })];
  assert.deepEqual(laneRows(CARD, off, [], [], []).map((r) => r.served), [false, false]);
});

test("unserved row carries the exact copy", () => {
  const { UNSERVED_NOTE } = require(SRC + "pages/workers.js");
  assert.equal(UNSERVED_NOTE, "Nobody serves this lane yet. Share this Desk and ask them to say: join this Desk.");
});

test("waiting and done counts", () => {
  const { laneRows } = require(SRC + "pages/workers.js");
  const served = laneRows(CARD, WORKERS, OUTCOMES, [], ENTITIES).find((r) => r.served);
  assert.equal(served.done, 2);
  assert.equal(served.waiting, 1);
  const skipped = OUTCOMES.concat([doc("draft--c--" + LK, { item: "draft--c", lane: LK, status: "skipped" })]);
  const again = laneRows(CARD, WORKERS, skipped, [], ENTITIES).find((r) => r.served);
  assert.deepEqual([again.done, again.waiting], [2, 0]);
});

test("canApproveGate allows only the lane's worker", () => {
  const { canApproveGate } = require(SRC + "pages/workers.js");
  const byKey = { [LK]: WORKERS[0].data };
  assert.deepEqual(canApproveGate({ title: "owner gate" }, byKey, "u_1"), { ok: true, reason: "" });
  assert.equal(canApproveGate({ lane: LK }, byKey, "u_2").ok, true);
  const no = canApproveGate({ lane: LK }, byKey, "u_1");
  assert.deepEqual(no, { ok: false, reason: "Only the person who serves this lane can approve it." });
  assert.equal(canApproveGate({ lane: LK }, byKey, null).ok, false);
  assert.equal(canApproveGate({ lane: "missing--x" }, byKey, "u_2").ok, false);
});

function joinGlobals() {
  const history = require(SRC + "pages/history.js");
  Object.assign(globalThis, require(SRC + "actions.js"), require(SRC + "pages/workers.js"),
    { gateLine, personWord: history.personWord, fillNames: history.fillNames, NEXT_RUN_NOTE: "Saved." });
}

test("approvals hides Approve on a worker gate for the owner", () => withDom(() => {
  joinGlobals();
  const { approvalCard } = require(SRC + "pages/approvals.js");
  const gate = { title: "Send intro", lane: LK, run: "r1", createdAt: "2026-10-31T09:00:00Z" };
  const store = { readOnly: false, set: async () => {} };
  const owner = approvalCard({ viewer: "u_1", store, workersByKey: { [LK]: WORKERS[0].data } }, { id: "r1--" + LK + "--g1", gate }, Date.now());
  assert.equal(findAll(owner, "button").filter((b) => /Approve/.test(b.textContent + (b.getAttribute("aria-label") || ""))).length, 0);
  assert.match(owner.textContent, /Only the person who serves this lane can approve it\./);
  const joiner = approvalCard({ viewer: "u_2", store, workersByKey: { [LK]: WORKERS[0].data } }, { id: "r1--" + LK + "--g1", gate }, Date.now());
  assert.equal(findAll(joiner, "button").filter((b) => /Approve/.test(b.textContent + (b.getAttribute("aria-label") || ""))).length, 1);
}));

test("releaseLane writes people/<owner>/decisions/release--<key>", async () => {
  const { releaseLane } = require(SRC + "actions.js");
  const calls = [];
  const store = { set: async (p, d) => calls.push([p, d]) };
  const ctx = { viewer: "u_1", owner: { by: "u_1" }, store };
  await releaseLane(ctx, LK, () => false, "u_2");
  assert.deepEqual(calls, []);
  await releaseLane(ctx, LK, () => true, "u_2");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "people/u_1/decisions/release--" + LK);
  assert.deepEqual([calls[0][1].decision, calls[0][1].by, typeof calls[0][1].at, calls[0][1].holder],
    ["release", "u_1", "string", "u_2"]);
  await assert.rejects(() => releaseLane({ viewer: "u_2", owner: { by: "u_1" }, store }, LK, () => true, "u_2"));
  await assert.rejects(() => releaseLane(ctx, "a/b", () => true, "u_2"));
  await assert.rejects(() => releaseLane(ctx, LK, () => true, "u/2"));
  await assert.rejects(() => releaseLane(ctx, LK, () => true));
  assert.equal(calls.length, 1);
});

test("route #/workers", () => {
  const { route } = require(SRC + "router.js");
  assert.deepEqual(route("#/workers"), { page: "workers", params: {} });
});

test("navModel adds Workers only with a join card", () => {
  const { navModel } = require(SRC + "palette.js");
  assert.equal(navModel(null, null, null).some((n) => n.id === "workers"), false);
  const nav = navModel(null, null, null, CARD);
  const w = nav.find((n) => n.id === "workers");
  assert.deepEqual([w.label, w.href], ["Workers", "#/workers"]);
});

function ownerStore(isOwner, existing) {
  const writes = [];
  let owner = existing || null;
  return { writes, store: {
    readOnly: false,
    isOwner: async () => isOwner,
    get: async (p) => (p === "meta/owner" && owner ? { exists: true, data: owner } : { exists: false }),
    set: async (p, d) => { writes.push([p, d]); if (p === "meta/owner") owner = d; },
  } };
}

test("ensureOwner writes meta/owner once when isOwner is true", async () => {
  const { ensureOwner, writable } = require(SRC + "actions.js");
  const { store, writes } = ownerStore(true);
  const ctx = { viewer: "u_1", store };
  await ensureOwner(ctx);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], "meta/owner");
  assert.deepEqual(Object.keys(writes[0][1]).sort(), ["at", "by"]);
  assert.equal(writes[0][1].by, "u_1");
  assert.equal(ctx.owner.by, "u_1");
  await ensureOwner(ctx);
  await ensureOwner({ viewer: "u_1", store });
  assert.equal(writes.length, 1);
  assert.equal(writable("meta/owner", "u_1"), false);
});

test("ensureOwner writes nothing for a non-owner or when meta/owner exists", async () => {
  const { ensureOwner } = require(SRC + "actions.js");
  const a = ownerStore(false);
  await ensureOwner({ viewer: "u_2", store: a.store });
  const b = ownerStore(true, { by: "u_1", at: "2026-10-01T00:00:00Z" });
  const ctx = { viewer: "u_1", store: b.store };
  await ensureOwner(ctx);
  const c = ownerStore(true);
  await ensureOwner({ viewer: null, store: c.store });
  assert.deepEqual([a.writes, b.writes, c.writes], [[], [], []]);
  assert.equal(ctx.owner.by, "u_1");
});

test("ensureOwner flags a meta/owner that names someone other than the artifact owner, and accepts no owner", async () => {
  const { ensureOwner, isDeskOwner } = require(SRC + "actions.js");
  const planted = ownerStore(true, { by: "u_9", at: "2026-10-01T00:00:00Z" });
  const ctx = { viewer: "u_1", store: planted.store, owner: { by: "u_9" } };
  await ensureOwner(ctx);
  assert.deepEqual([ctx.owner, ctx.ownerTampered, planted.writes], [null, true, []]);
  const self = ownerStore(false, { by: "u_2", at: "2026-10-01T00:00:00Z" });
  const ctx2 = { viewer: "u_2", store: self.store, owner: { by: "u_2" } };
  await ensureOwner(ctx2);
  assert.deepEqual([ctx2.owner, ctx2.ownerTampered, isDeskOwner(ctx2)], [null, true, false]);
  const other = { viewer: "u_3", store: ownerStore(false, { by: "u_1" }).store, owner: { by: "u_1" } };
  await ensureOwner(other);
  assert.deepEqual([other.owner.by, !!other.ownerTampered], ["u_1", false]);
});

test("a person's own decisions are writable only under people/<their id>/decisions/", () => {
  const { writable, personPath } = require(SRC + "actions.js");
  assert.equal(personPath("u_1", "release--" + LK), "people/u_1/decisions/release--" + LK);
  assert.equal(writable("people/u_1/decisions/x", "u_1"), true);
  for (const [p, v] of [["people/u_2/decisions/x", "u_1"], ["people/u_1/decisions/x", null], ["people/u_1/other/x", "u_1"],
    ["people/u_1", "u_1"], ["people/u_1/decisions/x/y", "u_1"], ["meta/owner", "u_1"]]) {
    assert.equal(writable(p, v), false, p);
  }
});

test("worker gate decisions go to the viewer's people path; owner gates stay in decisions/", async () => {
  Object.assign(globalThis, require(SRC + "actions.js"));
  const approvals = require(SRC + "pages/approvals.js");
  const calls = [];
  const ctx = { viewer: "u_2", store: { set: async (p, d) => calls.push([p, d]) } };
  const gid = "r1--" + LK + "--g1";
  await approvals.approveGate(ctx, gid, { lane: LK, item: "draft--d1", timeoutHours: 999, createdAt: new Date().toISOString() }, null);
  await approvals.rejectGate(ctx, gid, "No", { lane: LK, item: "draft--d1" });
  await approvals.approveGate(ctx, "r1--g1", { timeoutHours: 999, createdAt: new Date().toISOString() }, null);
  assert.deepEqual(calls.map((c) => c[0]), ["people/u_2/decisions/" + gid, "people/u_2/decisions/" + gid, "decisions/r1--g1"]);
  assert.equal(calls[0][1].by, "u_2");
});

test("a worker gate approval names the gate's item, so it cannot be moved to another item", async () => {
  Object.assign(globalThis, require(SRC + "actions.js"));
  const approvals = require(SRC + "pages/approvals.js");
  const calls = [];
  const ctx = { viewer: "u_2", store: { set: async (p, d) => calls.push([p, d]) } };
  const gid = "r1--" + LK + "--g1";
  await approvals.approveGate(ctx, gid, { lane: LK, item: "draft--d1", timeoutHours: 999, createdAt: new Date().toISOString() }, null);
  await approvals.rejectGate(ctx, gid, "No", { lane: LK, item: "draft--d1" });
  assert.equal(calls[0][1].item, "draft--d1");
  assert.equal(calls[1][1].item, "draft--d1");
  await assert.rejects(approvals.approveGate(ctx, gid, { lane: LK, timeoutHours: 999, createdAt: new Date().toISOString() }, null));
  assert.equal(calls.length, 2);
});

test("a worker gate decision stores the gate content shown, so a gate edited afterwards is not approved", async () => {
  Object.assign(globalThis, require(SRC + "actions.js"));
  const approvals = require(SRC + "pages/approvals.js");
  const calls = [];
  const ctx = { viewer: "u_2", store: { set: async (p, d) => calls.push([p, d]) } };
  const gid = "r1--" + LK + "--g1";
  const createdAt = new Date().toISOString();
  const gate = { lane: LK, item: "draft--d1", status: "pending", run: "r1", createdAt, transport: "email",
    timeoutHours: 999, correlation: "gmail-draft-1", recipients: [{ role: "buyer" }] };
  await approvals.approveGate(ctx, gid, gate, null);
  assert.deepEqual(calls[0][1].shown, { transport: "email", timeoutHours: 999, correlation: "gmail-draft-1",
    recipients: [{ role: "buyer" }] });
  gate.recipients[0].role = "someone else";
  assert.equal(calls[0][1].shown.recipients[0].role, "buyer");
  await approvals.approveGate(ctx, "r1--g1", { timeoutHours: 999, createdAt, correlation: "c" }, null);
  assert.equal(calls[1][1].shown, undefined);
});

test("gateDecisions reads a worker gate's decision only from its joiner's people path", () => {
  Object.assign(globalThis, require(SRC + "actions.js"));
  const { gateDecisions } = require(SRC + "pages/approvals.js");
  const wg = "r1--" + LK + "--g1";
  const pending = [doc(wg, { lane: LK }), doc("r1--g1", {})];
  const shared = [doc(wg, { decision: "approve", by: "u_2" }), doc("r1--g1", { decision: "reject", by: "u_1" })];
  const got = gateDecisions(pending, shared, { [LK]: { by: "u_2" } }, []);
  assert.deepEqual(Object.keys(got), ["r1--g1"]);
  const mine = gateDecisions(pending, shared, { [LK]: { by: "u_2" } }, [doc(wg, { decision: "approve", by: "u_2" })], "u_2");
  assert.equal(mine[wg].decision, "approve");
  const notJoiner = gateDecisions(pending, shared, { [LK]: { by: "u_2" } }, [doc(wg, { decision: "approve", by: "u_1" })], "u_1");
  assert.equal(notJoiner[wg], undefined);
});

test("lane releases are read only from the owner's people path", () => {
  const { ownerDecisions_ } = require(SRC + "pages/workers.js");
  assert.equal(ownerDecisions_("u_1"), "people/u_1/decisions");
  for (const bad of [undefined, null, "", "a/b", "../x", "x".repeat(65)]) assert.equal(ownerDecisions_(bad), null, String(bad));
});

test("Release hidden for a non-owner and on a Desk without meta/owner", () => withDom(() => {
  joinGlobals();
  const { laneRows, laneRow } = require(SRC + "pages/workers.js");
  const row = laneRows(CARD, WORKERS, OUTCOMES, [], ENTITIES).find((r) => r.served);
  const store = { readOnly: false, set: async () => {} };
  const hasRelease = (n) => findAll(n, "button").some((b) => /Release/.test(b.textContent + (b.getAttribute("aria-label") || "")));
  assert.equal(hasRelease(laneRow({ viewer: "u_1", owner: { by: "u_1" }, store, join: CARD }, row, {})), true);
  assert.equal(hasRelease(laneRow({ viewer: "u_2", owner: { by: "u_1" }, store, join: CARD }, row, {})), false);
  assert.equal(hasRelease(laneRow({ viewer: "u_1", owner: null, store, join: CARD }, row, {})), false);
}));

test("unserved row shows the copy and Copy link only when the card has a url", () => withDom(() => {
  joinGlobals();
  const { laneRows, laneRow, UNSERVED_NOTE } = require(SRC + "pages/workers.js");
  const row = laneRows(CARD, [], [], [], []).find((r) => !r.served);
  const store = { readOnly: false };
  const withUrl = laneRow({ viewer: "u_1", store, join: CARD }, row, {});
  assert.ok(withUrl.textContent.includes(UNSERVED_NOTE));
  assert.equal(findAll(withUrl, "button").some((b) => /Copy link/.test(b.textContent)), true);
  const noUrl = laneRow({ viewer: "u_1", store, join: Object.assign({}, CARD, { url: undefined }) }, row, {});
  assert.equal(findAll(noUrl, "button").some((b) => /Copy link/.test(b.textContent)), false);
}));

test("Workers shows only the viewer's own Desk id, with Copy, for join and leave", () => withDom(() => {
  joinGlobals();
  const { yourIdLine_ } = require(SRC + "pages/workers.js");
  assert.equal(yourIdLine_({ viewer: null }), null);
  const line = yourIdLine_({ viewer: "u_1" });
  assert.ok(line.textContent.includes("Your Desk id: u_1"));
  assert.equal(findAll(line, "button").some((b) => /Copy id/.test(b.textContent)), true);
}));

test("Apply on a proposal hidden for a non-owner", () => withDom(() => {
  joinGlobals();
  const { suggestionCard } = require(SRC + "pages/suggestions.js");
  Object.assign(globalThis, { producerLabel: () => "Jobs watch", entityHash: (id) => "#/" + id, shortLabel: (s) => s, when: (s) => String(s) });
  const m = doc("r6--2", { kind: "proposal", producer: "jobs-watch", createdAt: "2026-10-28T08:01:00Z",
    proposal: { setting: "markets", op: "add", value: "AU" } });
  const store = { readOnly: false, profiles: async () => ({}) };
  const accept = (n) => findAll(n, "button").some((b) => /Accept/.test(b.textContent + (b.getAttribute("aria-label") || "")));
  assert.equal(accept(suggestionCard({ viewer: "u_2", owner: { by: "u_1" }, store, join: CARD, definition: DEFN }, m, null)), false);
  assert.equal(accept(suggestionCard({ viewer: "u_1", owner: { by: "u_1" }, store, join: CARD, definition: DEFN }, m, null)), true);
  assert.equal(accept(suggestionCard({ viewer: "u_2", owner: null, store, join: null, definition: DEFN }, m, null)), true);
}));

test("sourceLine names people and lanes with per-source counts", () => {
  const { sourceLine } = require(SRC + "pages/workers.js");
  const sources = [{ source: "owner", by: "u_1", count: 7 }, { source: LK, by: "u_2", count: 5 }];
  const profiles = { u_1: { name: "Sam Lee" }, u_2: { name: "Alex Rivera" } };
  assert.equal(sourceLine(sources, profiles, "u_1", "u_1"), "From 7 decisions by you and 5 by Alex Rivera (sender lane)");
  assert.equal(sourceLine(sources, profiles, "u_1", "u_2"), "From 7 decisions by Sam Lee and 5 by you (sender lane)");
  assert.equal(sourceLine(sources, {}, "u_1", "u_3"), "From 7 decisions by someone and 5 by someone (sender lane)");
  assert.equal(sourceLine([{ source: "owner", by: "u_1", count: 7 }], profiles, "u_1", "u_1"), "From 7 decisions");
  assert.equal(sourceLine(sources, { u_2: { name: "alex" + "@example.com" } }, "u_1", "u_1"), "From 7 decisions by you and 5 by someone (sender lane)");
  assert.equal(sourceLine(null, profiles, "u_1", "u_1"), "");
});
