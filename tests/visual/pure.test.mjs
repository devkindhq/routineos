// node --test tests/visual/pure.test.mjs  (built-in runner, no packages)
// Pure page logic: Today assembly, Inbox lists, Browse filters, CSV, the page write allowlist.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const CORE = "../../skills/routineos/assets/desk/core/";
// Page files call the helpers that moved to shared.js (spec 7.3) as globals, as in the bundle.
Object.assign(globalThis, require(CORE + "shared.js"));
const { writable, save, remove, PathError } = require(CORE + "actions.js");
const { todayModel, partialLine } = require(CORE + "pages/today.js");
const { gateLine, itemLine, evidenceLine } = require(CORE + "requests.js");
const { applyFilters, toCsv, toRow, readFilterState, writeFilterState, browseColumns, defaultCols, statusPills, pillText, autoFullRead, decisionLabel, parseCalc, calcValue } = require(CORE + "pages/browse.js");
const { historyCsv } = require(CORE + "exporter.js");
const { ownerOf } = require(CORE + "members.js");
const { sparkPoints, entityIdFromRoute } = require(CORE + "pages/entity.js");
const { controlSpec, checkSetting, listAdd, listRemove, changedValues } = require(CORE + "pages/settings.js");
const { groupViews, viewToFilterState, filterStateToView, viewDoc } = require(CORE + "pages/settings.js");
const { scheduleInterval, isLate, nextRun } = require(CORE + "schedule.js");
const { dropReasonLinks, settingsDiff, sourcesLine, runsNewest } = require(CORE + "pages/runs.js");

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

Object.assign(globalThis, { human: require(CORE + "dates.js").human }, require(CORE + "schedule.js"), require(CORE + "requests.js"));
const { readFileSync } = require("node:fs");
const T_NOW = Date.parse("2026-10-28T00:00:00Z");
function snapSrc(file, extra = {}) {
  const snap = JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));
  const pick = (p) => Object.keys(snap).filter((k) => k.startsWith(p) && k.split("/").length === 2).map((k) => doc(k.slice(p.length), snap[k].data));
  return Object.assign({ definition: snap["meta/definition"].data, pending: pick("pending/"), inbox: pick("inbox/"), views: pick("views/"),
    columns: pick("columns/"), decisions: pick("decisions/"), runs: pick("runs/"), entities: pick("entities/") }, extra);
}
const DEMO = "../../templates/jobs-watch/demo/desk-demo.json";
const V2DEMO = "../desk_fixtures/v2-demo.json";

test("Today over the demo: no hero without desk.health, every waiting request counted, one partial line", () => {
  const m = todayModel(snapSrc(DEMO), T_NOW);
  assert.equal(m.hero, null);
  // The bell's waiting row and Today agree: deriveRequests over the demo has 5 waiting requests.
  assert.equal(m.waitingTotal, 5);
  assert.equal(m.waiting.length, 3);
  assert.equal(m.proposals, 4);
  const partial = m.sinceLastRun.filter((r) => r.partial);
  assert.deepEqual(partial.map((r) => [r.producer, partialLine(r.partial)]), [["jobs-watch", "parsed 2 of 3"]]);
  assert.deepEqual(m.fromRoutine.map((x) => x.data.kind).sort(), ["alert", "match", "match"]);
  assert.ok(m.sinceLastRun.every((r) => r.changed.length <= 5));
});

test("Today's newSinceLast sums each producer's latest run only", () => {
  const src = snapSrc(DEMO);
  assert.equal(todayModel(src, T_NOW).newSinceLast, 110 + 130 + 60);
  assert.equal(todayModel(snapSrc(V2DEMO), T_NOW).newSinceLast, 0 + 130 + 60);
  assert.equal(todayModel(Object.assign({}, src, { runs: [] }), T_NOW).newSinceLast, 0);
});

// UX review 1: a hero tile counts only what its list shows: active records, less the person's pending drops.
test("Today's hero counts only the records the role list shows (no dropped, no pending drops)", () => {
  const src = snapSrc(V2DEMO);
  const m = todayModel(src, T_NOW);
  assert.equal(m.hero.type, "role");
  const shown = src.entities.filter((e) => e.data.type === "role" && (e.data.status || "active") !== "dropped"
    && !src.decisions.some((d) => d.id === e.id && d.data.decision === "drop"));
  assert.equal(m.hero.red + m.hero.yellow + m.hero.green, shown.length);
  assert.equal(shown.length, 343);
  assert.deepEqual([m.hero.red, m.hero.yellow], [0, 0]);
});

// UX review 3: one plain status per routine, and a count of late routines for the header.
test("Today gives each routine one plain status and counts the late ones", () => {
  const m = todayModel(snapSrc(DEMO), T_NOW);
  const lead = m.health.filter((h) => h.producer === "lead-signals")[0];
  assert.equal(lead.tone, "danger");
  assert.match(lead.text, /^Late: last ran 33 days ago, next /);
  const jobs = m.health.filter((h) => h.producer === "jobs-watch")[0];
  assert.match(jobs.text, /^(On time|Partial): last ran /);
  assert.equal(m.late, 1);
});

// UX review 7: a waiting request with the nearest deadline comes first.
test("Today lists the waiting request that times out soonest first", () => {
  const src = snapSrc(DEMO);
  const m = todayModel(src, T_NOW);
  const times = m.waiting.map((r) => r.timeoutAt ? Date.parse(r.timeoutAt) : Infinity);
  assert.deepEqual(times, times.slice().sort((a, b) => a - b));
  assert.ok(m.waiting[0].timeoutAt, "a request with a deadline leads");
});

test("Today hides done and snoozed messages and names each producer's health", () => {
  const src = snapSrc(DEMO, { done: new Set(["jobs-watch-20261027--3"]),
    snooze: [doc("jobs-watch-20261027--2", { until: "2026-10-29T00:00:00Z" }), doc("jobs-watch-20261008--1", { until: "2026-10-27T00:00:00Z" })] });
  const m = todayModel(src, T_NOW);
  assert.deepEqual(m.fromRoutine.map((x) => x.id), ["jobs-watch-20261008--1"]);
  assert.deepEqual(m.health.map((h) => [h.producer, h.last && h.last.id, h.late]),
    [["jobs-watch", "jobs-watch-20261027", false], ["content-radar", "content-radar-20261015", false], ["lead-signals", "lead-signals-20260924", true]]);
  assert.equal(m.health[0].next.at, "2026-10-29T22:00:00.000Z");
});

// ---------- Runs and health ----------

test("Runs over the demo: next run, captured with delta, the partial run and the late producer", () => {
  globalThis.runsNewest = runsNewest;
  const { runsModel } = require(CORE + "pages/runs-health.js");
  const m = runsModel(snapSrc(DEMO), T_NOW);
  assert.deepEqual(m.next, { at: "2026-10-28T21:00:00.000Z", certain: true });
  // Latest runs: jobs-watch 110+18+17, content-radar 130+30+15, lead-signals 60; deltas against the run before.
  assert.deepEqual(m.captured, { value: 145 + 175 + 60, delta: (145 - 220) + (175 - 210) });
  assert.equal(m.partial7d, 1);
  // isLate: lead-signals last ran Sep 24 on a weekly schedule, so it is late now; the others are not.
  assert.equal(m.late7d, 1);
  assert.equal(m.rows.length, 6);
  assert.equal(m.rows[0].id, "jobs-watch-20261027");
  assert.deepEqual([m.rows[0].result, m.rows[0].parsed, m.rows[0].claimed, m.rows[0].new, m.rows[0].dropped, m.rows[0].durationMs],
    ["partial", 2, 3, 110, 18, 21 * 60000]);
  const late = m.rows.filter((r) => r.result === "late");
  assert.deepEqual(late.map((r) => [r.id, r.expectedBy]), [["lead-signals-20260924", "2026-09-29T20:00:00.000Z"]]);
  assert.ok(m.rows.filter((r) => r.result === "ok").every((r) => r.expectedBy === null));
});

test("Runs: a partial run older than seven days is not counted, and no runs is an empty model", () => {
  const { runsModel } = require(CORE + "pages/runs-health.js");
  assert.equal(runsModel(snapSrc(DEMO), Date.parse("2026-11-20T00:00:00Z")).partial7d, 0);
  const m = runsModel(Object.assign(snapSrc(DEMO), { runs: [] }), T_NOW);
  assert.deepEqual([m.rows, m.captured, m.partial7d, m.late7d], [[], { value: 0, delta: 0 }, 0, 0]);
});

test("Runs counts the requests queued for the next run", () => {
  const { runsModel } = require(CORE + "pages/runs-health.js");
  const src = snapSrc(V2DEMO);
  const queued = deriveRequests(src, null, T_NOW).filter((r) => r.state === "queued").length;
  assert.equal(runsModel(src, T_NOW).queued, queued);
  const decided = snapSrc(DEMO, { decisions: [doc("jobs-watch-20261027--g1", { decision: "approve", at: "2026-10-27T23:50:00Z", by: "u_1" })] });
  assert.equal(runsModel(decided, T_NOW).queued, 1);
});

// ---------- Inbox ----------

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
  const fs = { q: "staff eng", status: "dropped", starred: true, tag: "warm", source: "lead-signals", reason: "excluded by x", health: "yellow",
    window: "month", fields: { market: "NZ" }, sort: { field: "salary", dir: "asc" }, group: "market", cols: ["title", "salary"] };
  const qs = writeFilterState(fs);
  const back = readFilterState(Object.fromEntries(new URLSearchParams(qs)));
  assert.deepEqual(back, fs);
  assert.deepEqual(readFilterState({}), { q: "", status: "active", starred: false, tag: "", source: "", reason: "", health: "", window: "all",
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

test("browseFirstRun names the producers and settings for a type from the settingFilters list", () => {
  const { browseFirstRun } = require(CORE + "pages/browse.js");
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
  const { acceptProposal } = require(CORE + "actions.js");
  const store = proposalStore({ "settings/jobs-watch": { values: { title_keywords: ["Shopify"], markets: ["AU"] } } });
  const ctx = { store, viewer: "u_1", definition: PROPOSAL_DEFN };
  await acceptProposal(ctx, doc("r1--1", { producer: "jobs-watch",
    proposal: { setting: "title_keywords", from: ["Shopify"], to: ["Shopify", "Hydrogen"] } }));
  assert.deepEqual(store.writes, ["settings/jobs-watch", "decisions/r1--1"]);
  assert.deepEqual(store.docs["settings/jobs-watch"].values, { title_keywords: ["Shopify", "Hydrogen"], markets: ["AU"] });
  assert.equal(store.docs["decisions/r1--1"].decision, "accept");
  assert.equal(store.docs["decisions/r1--1"].by, "u_1");
});

// UX review 2: Accept changes settings right away, so it must be undoable: the old value comes back exactly
// (an unset key is unset again, not pinned to the default) and the decision is removed.
test("undoAccept puts the setting back as it was and removes the decision", async () => {
  const { acceptProposal, undoAccept } = require(CORE + "actions.js");
  const store = proposalStore({ "settings/jobs-watch": { values: { markets: ["AU"] } } });
  store.del = async (path) => { store.writes.push("del " + path); delete store.docs[path]; };
  const ctx = { store, viewer: "u_1", definition: PROPOSAL_DEFN };
  const prior = await acceptProposal(ctx, doc("r1--3", { producer: "jobs-watch",
    proposal: { setting: "title_keywords", from: ["Shopify"], to: ["Shopify", "Hydrogen"] } }));
  assert.deepEqual(prior, { producer: "jobs-watch", setting: "title_keywords", had: false, before: undefined });
  await undoAccept(ctx, "r1--3", prior);
  assert.deepEqual(store.writes, ["settings/jobs-watch", "decisions/r1--3", "settings/jobs-watch", "del decisions/r1--3"]);
  assert.deepEqual(store.docs["settings/jobs-watch"].values, { markets: ["AU"] });
  assert.ok(!("decisions/r1--3" in store.docs));
  store.docs["settings/jobs-watch"].values.title_keywords = ["React"];
  const p2 = await acceptProposal(ctx, doc("r1--4", { producer: "jobs-watch", proposal: { setting: "title_keywords", to: ["Vue"] } }));
  await undoAccept(ctx, "r1--4", p2);
  assert.deepEqual(store.docs["settings/jobs-watch"].values.title_keywords, ["React"]);
});

test("accept with the legacy {current, suggested} shape writes the suggested value", async () => {
  const { acceptProposal } = require(CORE + "actions.js");
  const store = proposalStore({ "settings/jobs-watch": { values: { markets: ["AU"] } } });
  const ctx = { store, viewer: "u_1", definition: PROPOSAL_DEFN };
  await acceptProposal(ctx, doc("r1--2", { producer: "jobs-watch",
    proposal: { setting: "title_keywords", current: ["Shopify"], suggested: ["Shopify", "headless"] } }));
  assert.deepEqual(store.writes, ["settings/jobs-watch", "decisions/r1--2"]);
  assert.deepEqual(store.docs["settings/jobs-watch"].values, { markets: ["AU"], title_keywords: ["Shopify", "headless"] });
  assert.equal(store.docs["decisions/r1--2"].decision, "accept");
});

test("a role is titled by its title, with its company as the subtitle", () => {
  const { recordTitle, recordSubtitle } = require(CORE + "pages/entity.js");
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
  const { keepState } = require(CORE + "pages/entity.js");
  const dropped = { status: "dropped", dropReason: "not in markets", sightings: [sighting("2026-10-01T00:00:00Z", { dropReason: "not in markets" })] };
  const kept = { status: "active", sightings: [sighting("2026-10-01T00:00:00Z"), sighting("2026-10-08T00:00:00Z", { note: "kept by person" })] };
  assert.equal(keepState(dropped, null), "dropped");
  assert.equal(keepState(dropped, KEPT), "kept-pending");
  assert.equal(keepState(kept, KEPT), "kept");
  assert.equal(keepState(kept, null), "drop-pending");
  assert.equal(keepState({ status: "active", sightings: [sighting("2026-10-01T00:00:00Z")] }, null), "active");
  assert.equal(keepState(dropped, { decision: "dismiss" }), "dropped");
});

// ---------- Self-improving: per-item proposals and Suggestions ----------

const LEARN_DEFN = { producers: [{ id: "jobs-watch", settings: [
  { name: "title_keywords", default: ["Shopify"] }, { name: "max_inbox_per_run", default: 10 }] }] };
const item = (id, proposal, extra) => doc(id, Object.assign({ producer: "jobs-watch", kind: "proposal", proposal }, extra || {}));

test("per-item add applies to the current value, not the stored to", async () => {
  const { acceptProposal } = require(CORE + "actions.js");
  const store = proposalStore({ "settings/jobs-watch": { values: { title_keywords: ["Shopify", "React"] } } });
  const ctx = { store, viewer: "u_1", definition: LEARN_DEFN };
  await acceptProposal(ctx, item("r2--1", { setting: "title_keywords", op: "add", value: "Hydrogen", level: "L1",
    from: ["Shopify"], to: ["Shopify", "Hydrogen"], key: "title_keywords:add:hydrogen" }));
  assert.deepEqual(store.docs["settings/jobs-watch"].values.title_keywords, ["Shopify", "React", "Hydrogen"]);
  assert.equal(store.docs["decisions/r2--1"].decision, "accept");
  assert.equal(store.docs["decisions/r2--1"].key, "title_keywords:add:hydrogen");
});

test("per-item remove matches case-insensitively and set replaces the number", async () => {
  const { acceptProposal } = require(CORE + "actions.js");
  const store = proposalStore({ "settings/jobs-watch": { values: { title_keywords: ["Shopify", "hydrogen"] } } });
  const ctx = { store, viewer: "u_1", definition: LEARN_DEFN };
  await acceptProposal(ctx, item("r2--2", { setting: "title_keywords", op: "remove", value: "Hydrogen", key: "k1" }));
  assert.deepEqual(store.docs["settings/jobs-watch"].values.title_keywords, ["Shopify"]);
  await acceptProposal(ctx, item("r2--3", { setting: "max_inbox_per_run", op: "set", value: 20, key: "k2" }));
  assert.equal(store.docs["settings/jobs-watch"].values.max_inbox_per_run, 20);
});

test("applyOp adds once, removes by casefold and sets", () => {
  const { applyOp } = require(CORE + "actions.js");
  assert.deepEqual(applyOp(["Shopify"], { op: "add", value: "shopify" }), ["Shopify"]);
  assert.deepEqual(applyOp(undefined, { op: "add", value: "Hydrogen" }), ["Hydrogen"]);
  assert.deepEqual(applyOp(["A", "b"], { op: "remove", value: "B" }), ["A"]);
  assert.equal(applyOp(10, { op: "set", value: 15 }), 15);
});

test("accept refuses L2 and L3 and writes nothing", async () => {
  const { acceptProposal } = require(CORE + "actions.js");
  const store = proposalStore({ "settings/jobs-watch": { values: {} } });
  const ctx = { store, viewer: "u_1", definition: LEARN_DEFN };
  for (const level of ["L2", "L3"]) {
    await assert.rejects(() => acceptProposal(ctx, item("r2--" + level, { level, target: level === "L2" ? "definition" : "prompt",
      change: "Add a salary field", setting: "title_keywords", to: ["x"], key: "definition:l2:abc" })), /opens a PR/);
  }
  assert.deepEqual(store.writes, []);
});

test("reject and snooze write the key, and snooze an until seven days on", async () => {
  const { rejectProposal, snoozeProposal } = require(CORE + "actions.js");
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

test("a snooze without until stays snoozed", () => {
  const { snoozedNow } = require(CORE + "requests.js");
  const now = Date.parse("2026-10-29T00:00:00Z");
  assert.equal(snoozedNow({ decision: "snooze" }, now), true);
  assert.equal(snoozedNow({ decision: "snooze", until: "2026-10-28T00:00:00Z" }, now), false);
  assert.equal(snoozedNow({ decision: "reject" }, now), false);
});

test("accept refuses to empty an include list and writes nothing", async () => {
  const { acceptProposal } = require(CORE + "actions.js");
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
  const { levelLabel } = require(CORE + "requests.js");
  assert.equal(itemLine({ setting: "title_keywords", op: "add", value: "Hydrogen" }), "Add Hydrogen to title_keywords");
  assert.equal(itemLine({ setting: "title_keywords", op: "remove", value: "PHP" }), "Remove PHP from title_keywords");
  assert.equal(itemLine({ setting: "max_inbox_per_run", op: "set", value: 15 }), "Set max_inbox_per_run to 15");
  // UX review 9: list changes read as plain words, not JSON.
  assert.equal(itemLine({ setting: "t", from: ["a"], to: ["a", "b"] }), "Add b to t");
  assert.equal(itemLine({ setting: "t", from: ["a", "b"], to: ["a"] }), "Remove b from t");
  assert.equal(itemLine({ setting: "t", from: ["a", "b"], to: ["c", "a"] }), "Add c and remove b in t");
  assert.equal(itemLine({ setting: "n", from: 5, to: 9 }), "Set n to 9 (was 5)");
  assert.equal(itemLine({ setting: "q", current: { a: 1 }, suggested: { a: 2 } }), 'Set q to {"a":2}');
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

test("the old Suggestions route redirects to proposals on Approvals", () => {
  const { route } = require(CORE + "router.js");
  assert.deepEqual(route("#/suggestions"), { page: "approvals", params: { query: { kind: "proposals" } }, redirect: "#/approvals?kind=proposals" });
});

// ---------- Names through store.profiles on Approvals and Settings history ----------

test("a person's reason shown before the next run is capped at 200 code points, like the contract", () => {
  const { shownReason } = require(CORE + "actions.js");
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
  const { laneRows, fillLabel } = require(CORE + "pages/workers.js");
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
  const { laneRows } = require(CORE + "pages/workers.js");
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
  const { UNSERVED_NOTE } = require(CORE + "pages/workers.js");
  assert.equal(UNSERVED_NOTE, "Nobody serves this lane yet. Share this Desk and ask them to say: join this Desk.");
});

test("waiting and done counts", () => {
  const { laneRows } = require(CORE + "pages/workers.js");
  const served = laneRows(CARD, WORKERS, OUTCOMES, [], ENTITIES).find((r) => r.served);
  assert.equal(served.done, 2);
  assert.equal(served.waiting, 1);
  const skipped = OUTCOMES.concat([doc("draft--c--" + LK, { item: "draft--c", lane: LK, status: "skipped" })]);
  const again = laneRows(CARD, WORKERS, skipped, [], ENTITIES).find((r) => r.served);
  assert.deepEqual([again.done, again.waiting], [2, 0]);
});

test("canApproveGate allows only the lane's worker", () => {
  const { canApproveGate } = require(CORE + "pages/workers.js");
  const byKey = { [LK]: WORKERS[0].data };
  assert.deepEqual(canApproveGate({ title: "owner gate" }, byKey, "u_1"), { ok: true, reason: "" });
  assert.equal(canApproveGate({ lane: LK }, byKey, "u_2").ok, true);
  const no = canApproveGate({ lane: LK }, byKey, "u_1");
  assert.deepEqual(no, { ok: false, reason: "Only the person who serves this lane can approve it." });
  assert.equal(canApproveGate({ lane: LK }, byKey, null).ok, false);
  assert.equal(canApproveGate({ lane: "missing--x" }, byKey, "u_2").ok, false);
});

test("releaseLane writes people/<owner>/decisions/release--<key>", async () => {
  const { releaseLane } = require(CORE + "actions.js");
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
  const { route } = require(CORE + "router.js");
  assert.deepEqual(route("#/workers"), { page: "workers", params: {} });
});

test("navModel adds Workers only with a join card", () => {
  const { navModel, navFlat } = require(CORE + "palette.js");
  assert.equal(navFlat(navModel(null, null, null)).some((n) => n.id === "workers"), false);
  const nav = navFlat(navModel(null, null, null, CARD));
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
  const { ensureOwner, writable } = require(CORE + "actions.js");
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
  const { ensureOwner } = require(CORE + "actions.js");
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
  const { ensureOwner, isDeskOwner } = require(CORE + "actions.js");
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
  const { writable, personPath } = require(CORE + "actions.js");
  assert.equal(personPath("u_1", "release--" + LK), "people/u_1/decisions/release--" + LK);
  assert.equal(writable("people/u_1/decisions/x", "u_1"), true);
  assert.equal(writable("people/u_1", "u_1"), true, "the viewer's own marker doc");
  for (const [p, v] of [["people/u_2/decisions/x", "u_1"], ["people/u_1/decisions/x", null], ["people/u_1/other/x", "u_1"],
    ["people/u_2", "u_1"], ["people/u_1", null], ["people/u_1/decisions/x/y", "u_1"], ["meta/owner", "u_1"]]) {
    assert.equal(writable(p, v), false, p);
  }
});

test("worker gate decisions go to the viewer's people path; owner gates stay in decisions/", async () => {
  Object.assign(globalThis, require(CORE + "actions.js"));
  const approvals = require(CORE + "pages/approvals.js");
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
  Object.assign(globalThis, require(CORE + "actions.js"));
  const approvals = require(CORE + "pages/approvals.js");
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
  Object.assign(globalThis, require(CORE + "actions.js"));
  const approvals = require(CORE + "pages/approvals.js");
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

test("deriveRequests reads a worker gate's decision only from its joiner's people path", () => {
  const { deriveRequests } = require(CORE + "requests.js");
  const wg = "r1--" + LK + "--g1";
  const pending = [doc(wg, { lane: LK }), doc("r1--g1", {})];
  const decisions = [doc(wg, { decision: "approve", by: "u_2" }), doc("r1--g1", { decision: "reject", by: "u_1", at: "2026-10-27T00:00:00Z" })];
  const workersByKey = { [LK]: { by: "u_2" } };
  const at = Date.parse("2026-10-28T00:00:00Z");
  const state = (list) => Object.fromEntries(list.filter((r) => r.group === "gates").map((r) => [r.id, r.decision ? r.decision.decision : null]));
  assert.deepEqual(state(deriveRequests({ pending, decisions, workersByKey }, null, at)), { [wg]: null, "r1--g1": "reject" });
  const mine = deriveRequests({ pending, decisions, workersByKey, personDecisions: [doc(wg, { decision: "approve", by: "u_2" })] }, "u_2", at);
  assert.equal(state(mine)[wg], "approve");
  assert.equal(mine.find((r) => r.id === wg).decisionPath, "people/u_2/decisions/" + wg);
  const notJoiner = deriveRequests({ pending, decisions, workersByKey, personDecisions: [doc(wg, { decision: "approve", by: "u_1" })] }, "u_1", at);
  assert.equal(state(notJoiner)[wg], null);
});

test("lane releases are read only from the owner's people path", () => {
  const { ownerDecisions_ } = require(CORE + "pages/workers.js");
  assert.equal(ownerDecisions_("u_1"), "people/u_1/decisions");
  for (const bad of [undefined, null, "", "a/b", "../x", "x".repeat(65)]) assert.equal(ownerDecisions_(bad), null, String(bad));
});

test("sourceLine names people and lanes with per-source counts", () => {
  const { sourceLine } = require(CORE + "pages/workers.js");
  const sources = [{ source: "owner", by: "u_1", count: 7 }, { source: LK, by: "u_2", count: 5 }];
  const profiles = { u_1: { name: "Sam Lee" }, u_2: { name: "Alex Rivera" } };
  assert.equal(sourceLine(sources, profiles, "u_1", "u_1"), "From 7 decisions by you and 5 by Alex Rivera (sender lane)");
  assert.equal(sourceLine(sources, profiles, "u_1", "u_2"), "From 7 decisions by Sam Lee and 5 by you (sender lane)");
  assert.equal(sourceLine(sources, {}, "u_1", "u_3"), "From 7 decisions by someone and 5 by someone (sender lane)");
  assert.equal(sourceLine([{ source: "owner", by: "u_1", count: 7 }], profiles, "u_1", "u_1"), "From 7 decisions");
  assert.equal(sourceLine(sources, { u_2: { name: "alex" + "@example.com" } }, "u_1", "u_1"), "From 7 decisions by you and 5 by someone (sender lane)");
  assert.equal(sourceLine(null, profiles, "u_1", "u_1"), "");
});

// ---------- Record (Desk v2, Package 3) ----------

const V2 = require("../desk_fixtures/v2-demo.json");
const V2_DEF = V2["meta/definition"].data;
const V2_ROLE = V2["entities/role--https-jobs-example-au-00003"].data;

test("recordMarkdown: a heading, then each summary field as - Label: value", () => {
  const { recordMarkdown } = require(CORE + "record.js");
  const md = recordMarkdown(V2_ROLE, V2_DEF);
  const lines = md.split("\n");
  assert.equal(lines[0], "# Lead headless commerce architect");
  for (const l of ["- Company: Valtine Home", "- Market: AU", "- Posted: 2026-09-02", "- Title: Lead headless commerce architect"]) {
    assert.ok(lines.includes(l), l);
  }
  assert.ok(lines.includes("- URL: https://jobs.example/au/00003"));
  assert.match(md, /Owns the headless commerce architecture/);
});

test("recordMarkdown keeps a hostile title as one line of text", () => {
  const { recordMarkdown } = require(CORE + "record.js");
  const evil = "<img src=x onerror=alert(1)>\n# injected";
  const d = Object.assign({}, V2_ROLE, { display: Object.assign({}, V2_ROLE.display, { title: evil }) });
  const lines = recordMarkdown(d, V2_DEF).split("\n");
  assert.equal(lines[0], "# \\<img src=x onerror=alert\\(1\\)\\> \\# injected");
  assert.equal(lines.filter((l) => l.startsWith("# ")).length, 1);
});

test("recordMarkdown escapes Markdown in stored values, so they read as text, not links, images or markup", () => {
  const { recordMarkdown } = require(CORE + "record.js");
  const display = Object.assign({}, V2_ROLE.display, {
    title: "[click](javascript:alert(1)) ![x](https://t.example/p.png)",
    company: "*Bold* _co_ `code` <b>x</b> | a",
    summary: "- not a list\n1. not numbered",
  });
  const md = recordMarkdown(Object.assign({}, V2_ROLE, { display: display }), V2_DEF);
  const lines = md.split("\n");
  assert.equal(lines[0], "# \\[click\\]\\(javascript:alert\\(1\\)\\) \\!\\[x\\]\\(https://t.example/p.png\\)");
  assert.ok(lines.includes("- Company: \\*Bold\\* \\_co\\_ \\`code\\` \\<b\\>x\\</b\\> \\| a"), md);
  assert.ok(lines.includes("\\- not a list 1. not numbered"), md);
  assert.ok(lines.includes("- URL: https://jobs.example/au/00003"));
  assert.doesNotMatch(md, /[^\\]\]\(/);
});

// ---------- Record activity (Desk v2, Task 3.3) ----------

const v2Docs = (prefix) => Object.keys(V2).filter((k) => k.startsWith(prefix)).map((k) => doc(k.slice(k.indexOf("/") + 1), V2[k].data));
const ROLE3_ID = "role--https-jobs-example-au-00003";

test("recordEvents: the v2 role yields seen, change, merge, decision, setting and comment events, newest first", () => {
  const { recordEvents } = require(CORE + "record.js");
  const role = JSON.parse(JSON.stringify(V2_ROLE));
  role.sightings[1].values = Object.assign({}, role.sightings[1].values, { salary_max: 140000 });
  const ev = recordEvents(role, {
    id: ROLE3_ID,
    definition: V2_DEF,
    decisions: [{ at: "2026-10-21T02:40:00Z", by: "u_member", decision: "keep" }],
    merges: [doc("role--https-jobs-example-au-09999", { into: ROLE3_ID, at: "2026-10-22T00:00:00Z", by: "u_owner" })],
    settingsHistory: v2Docs("settingsHistory/"),
    comments: v2Docs("comments/"),
  });
  assert.deepEqual([...new Set(ev.map((e) => e.kind))].sort(), ["change", "comment", "decision", "merge", "seen", "setting"]);
  const ats = ev.map((e) => e.at);
  assert.deepEqual(ats, ats.slice().sort().reverse());
  const change = ev.find((e) => e.kind === "change");
  assert.ok(change.parts.join("").endsWith("130000 to 140000"), change.parts.join(""));
  // The edit doc is not a second comment; the reply is.
  assert.deepEqual(ev.filter((e) => e.kind === "comment").map((e) => e.parts.slice(2).join("")), ["replied", "commented"]);
  const setting = ev.find((e) => e.kind === "setting");
  assert.deepEqual(setting.parts[0], { person: "u_member" });
  assert.match(setting.parts[2], /excluded_companies, lookback_days, max_inbox_per_run/);
  const seen = ev.filter((e) => e.kind === "seen").pop();
  assert.deepEqual(seen.parts.at(-1), { link: { label: "Run jobs-watch-20260903", href: "#/runs/jobs-watch-20260903" } });
});

test("recordEvents: a merge into the record links the other record; a merge away links the target", () => {
  const { recordEvents } = require(CORE + "record.js");
  const other = "role--https-jobs-example-au-09999";
  const into = recordEvents(V2_ROLE, { id: ROLE3_ID, merges: [doc(other, { into: ROLE3_ID, at: "2026-10-22T00:00:00Z", by: "u_owner" })] })
    .find((e) => e.kind === "merge");
  assert.deepEqual(into.parts.slice(2), ["merged into this ", { link: { label: other, href: "#/entity/role/https-jobs-example-au-09999" } }]);
  const away = recordEvents(V2_ROLE, { id: ROLE3_ID, merges: [doc(ROLE3_ID, { into: other, at: "2026-10-22T00:00:00Z" })] }).find((e) => e.kind === "merge");
  assert.deepEqual(away.parts, ["merged this into ", { link: { label: other, href: "#/entity/role/https-jobs-example-au-09999" } }]);
  // A merge between two other records is not this record's event.
  assert.equal(recordEvents(V2_ROLE, { id: ROLE3_ID, merges: [doc("role--a", { into: "role--b", at: "2026-10-22T00:00:00Z" })] })
    .filter((e) => e.kind === "merge").length, 0);
});

test("recShown: 8 value changes show the 5 newest and hide 3 behind Show all changes", () => {
  const { recordEvents, recShown } = require(CORE + "record.js");
  const sightings = Array.from({ length: 9 }, (_, i) => ({ at: "2026-10-0" + (i + 1) + "T00:00:00Z", producer: "jobs-watch", values: { salary_max: 100 + i } }));
  const ev = recordEvents({ type: "role", key: "k", sightings }, { definition: V2_DEF });
  assert.equal(ev.filter((e) => e.kind === "change").length, 8);
  const s = recShown(ev, false);
  assert.equal(s.events.filter((e) => e.kind === "change").length, 5);
  assert.equal(s.hidden, 3);
  assert.equal(s.events.filter((e) => e.kind === "seen").length, 9);
  assert.match(s.events.find((e) => e.kind === "change").parts[0], /107 to 108$/);
  assert.equal(recShown(ev, true).hidden, 0);
});

// ---------- Record comments (Desk v2, Task 3.4) ----------

test("commentView: an own edit replaces the text, another person's edit does not, delete hides, 15 minute edit window", () => {
  const { commentView } = require(CORE + "record.js");
  const now = Date.parse("2026-10-26T11:10:00Z");
  const v = commentView(v2Docs("comments/"), "u_owner", now);
  assert.deepEqual(v.map((c) => [c.by, c.text, c.edited]), [
    ["u_owner", "Worth a look: lead level, remote and in AU.", true],
    ["u_member", "Agreed. I will check the salary band first.", false]]);
  assert.equal(v[0].id, "role--https-jobs-example-au-00003--u_owner--mvp102o0");
  assert.equal(v[0].canEdit, false, "posted 130 minutes ago");
  const t0 = Date.parse("2026-10-26T11:00:00Z");
  const cid = (who, ms) => "role--x--" + who + "--" + (t0 + ms).toString(36);
  const at = (ms) => new Date(t0 + ms).toISOString();
  const orig = doc(cid("u_1", 0), { entity: "role--x", by: "u_1", text: "Mine", at: at(0) });
  const own = doc(cid("u_1", 60e3), { entity: "role--x", by: "u_1", text: "Mine, edited", at: at(60e3), edits: cid("u_1", 0) });
  assert.deepEqual(commentView([orig, own], "u_1", now).map((c) => [c.text, c.edited]), [["Mine, edited", true]]);
  const prefixed = doc(cid("u_1", 90e3), { entity: "role--x", by: "u_1", text: "Older form", at: at(90e3), edits: "comments/" + cid("u_1", 0) });
  assert.equal(commentView([orig, prefixed], "u_1", now)[0].text, "Older form", "an edits value with the comments/ prefix still applies");
  const other = doc(cid("u_2", 60e3), { entity: "role--x", by: "u_2", text: "Hijack", at: at(60e3), edits: cid("u_1", 0) });
  assert.deepEqual(commentView([orig, other], "u_1", now).map((c) => [c.text, c.edited, c.canEdit]), [["Mine", false, true]]);
  assert.equal(commentView([orig], "u_1", Date.parse("2026-10-26T11:16:00Z"))[0].canEdit, false);
  assert.equal(commentView([orig], "u_2", now)[0].canEdit, false);
  const del = doc(cid("u_1", 120e3), { entity: "role--x", by: "u_1", at: at(120e3), edits: cid("u_1", 0), deleted: true });
  assert.deepEqual(commentView([orig, del], "u_1", now), []);
});

test("commentView: authorship comes from the doc id (security review)", () => {
  const { commentView } = require(CORE + "record.js");
  const t0 = Date.parse("2026-10-26T11:00:00Z"), now = t0 + 5 * 60e3;
  const cid = (who, ms) => "role--x--" + who + "--" + (t0 + ms).toString(36);
  const at = (ms) => new Date(t0 + ms).toISOString();
  const orig = doc(cid("u_1", 0), { entity: "role--x", by: "u_1", text: "Mine", at: at(0) });
  // A spoofed author: u_2 writes under its own id but types by: u_1.
  const spoof = doc(cid("u_2", 30e3), { entity: "role--x", by: "u_1", text: "Pretending", at: at(30e3) });
  assert.deepEqual(commentView([orig, spoof], "u_2", now).map((c) => c.text), ["Mine"]);
  // Someone else's edit, typed with the original author's by.
  const forged = doc(cid("u_2", 60e3), { entity: "role--x", by: "u_1", text: "Hijack", at: at(60e3), edits: cid("u_1", 0) });
  assert.deepEqual(commentView([orig, forged], "u_1", now).map((c) => [c.text, c.edited]), [["Mine", false]]);
  // A late edit by the author, 16 minutes after the original.
  const late = doc(cid("u_1", 16 * 60e3), { entity: "role--x", by: "u_1", text: "Too late", at: at(16 * 60e3), edits: cid("u_1", 0) });
  assert.deepEqual(commentView([orig, late], "u_1", now).map((c) => [c.text, c.edited]), [["Mine", false]]);
  // An edit dated before the original.
  const early = doc(cid("u_1", -60e3), { entity: "role--x", by: "u_1", text: "Before", at: at(-60e3), edits: cid("u_1", 0) });
  assert.deepEqual(commentView([orig, early], "u_1", now).map((c) => c.text), ["Mine"]);
  // Someone else's delete, typed with the original author's by.
  const del = doc(cid("u_2", 90e3), { entity: "role--x", by: "u_1", at: at(90e3), edits: cid("u_1", 0), deleted: true });
  assert.deepEqual(commentView([orig, del], "u_1", now).map((c) => c.text), ["Mine"]);
  // A doc id that does not parse is ignored.
  assert.deepEqual(commentView([doc("junk", { entity: "role--x", by: "u_1", text: "x", at: at(0) })], "u_1", now), []);
});

test("comments are written only under the viewer's own people path", () => {
  assert.equal(writable("people/u_1/comments/role--x--mvp102o0", "u_1"), true);
  assert.equal(writable("people/u_2/comments/role--x--mvp102o0", "u_1"), false);
  assert.equal(writable("comments/role--x--u_1--mvp102o0", "u_1"), false, "the flat collection is read, not written");
  assert.equal(writable("comments/a/b", "u_1"), false);
});

test("deriveRequests: a bad timeoutHours gives no deadline, and gate ids are plain keys", () => {
  const { deriveRequests } = require(CORE + "requests.js");
  const at = Date.parse("2026-10-20T10:00:00Z");
  const g = (id, hours) => doc(id, { status: "pending", createdAt: "2026-10-20T08:00:00Z", timeoutHours: hours });
  const out = deriveRequests({ pending: [g("r1--a", "NaN"), g("r1--b", -4), g("r1--c", 1e9), g("r1--d", 24), g("constructor", 24)] }, null, at);
  const by = Object.fromEntries(out.map((r) => [r.id, r]));
  assert.equal(by["r1--a"].timeoutAt, undefined);
  assert.equal(by["r1--b"].timeoutAt, undefined);
  assert.equal(by["r1--c"].timeoutAt, undefined);
  assert.equal(by["r1--d"].timeoutAt, "2026-10-21T08:00:00.000Z");
  assert.equal(by["constructor"].message, null);
});

test("runStatusTag tone: only ok is success, failed is danger, anything else warning; runMinutes guards bad dates", () => {
  const { runStatusTone, runMinutes } = require(CORE + "pages/runs.js");
  assert.equal(runStatusTone("ok"), "success");
  assert.equal(runStatusTone("failed"), "danger");
  assert.equal(runStatusTone("partial"), "warning");
  assert.equal(runStatusTone(undefined), "warning");
  assert.equal(runStatusTone("done"), "success");
  assert.equal(runMinutes({ startedAt: "2026-10-20T08:00:00Z", endedAt: "2026-10-20T08:30:00Z" }), 30);
  assert.equal(runMinutes({ startedAt: "garbage", endedAt: "2026-10-20T08:30:00Z" }), null);
  assert.equal(runMinutes({ startedAt: "2026-10-20T08:00:00Z" }), null);
});

// Items list (Task 3.5): the chip row comes from desk.health when the type has it, else the first summary choice field.
test("chipSource: health first, then a summary choice field, else none", () => {
  const { chipSource } = require(CORE + "pages/browse.js");
  const v2 = JSON.parse(readFileSync(new URL("../desk_fixtures/v2-demo.json", import.meta.url), "utf8"));
  const v2def = (v2["meta/definition"] || v2.docs["meta/definition"]).data;
  const demo = JSON.parse(readFileSync(new URL("../../templates/jobs-watch/definition.json", import.meta.url), "utf8"));
  assert.deepEqual(chipSource(v2def, "role"), { kind: "health", field: "market", rule: v2def.desk.health.role });
  assert.deepEqual(chipSource(demo, "role"), { kind: "choice", field: "market", choices: ["AU", "US", "CA", "NZ", "PH", "GB", "DE"] });
  assert.equal(chipSource(demo, "company"), null);
  assert.equal(chipSource({}, "role"), null);
});

test("health filter: ?health= round trips, needs the full set, shows a chip and keeps only that tone", () => {
  const { needsFullRead, filterChips, removeChip, healthOf } = require(CORE + "pages/browse.js");
  const rule = { field: "market", red: ["DE"], yellow: ["GB"], green: ["AU", "US"] };
  const fs = readFilterState({ health: "red" });
  assert.equal(fs.health, "red");
  assert.equal(readFilterState({ health: "purple" }).health, "");
  assert.equal(writeFilterState(fs), "health=red");
  assert.equal(needsFullRead(fs), true);
  assert.deepEqual(filterChips(fs, {}).map((c) => c.label), ["Health: red"]);
  assert.equal(removeChip(fs, "health").health, "");
  const row = (id, market) => toRow({ id, data: { status: "active", display: { market } } });
  const rs = [row("role--a", "DE"), row("role--b", "GB"), row("role--c", "AU"), row("role--d", "FR")];
  assert.equal(healthOf(rule, rs[0]), "red");
  assert.equal(healthOf(rule, rs[3]), null);
  assert.deepEqual(applyFilters(rs, { status: "all", health: "red", healthRule: rule }).map((r) => r.id), ["role--a"]);
  assert.deepEqual(applyFilters(rs, { status: "all", health: "green", healthRule: rule }).map((r) => r.id).sort(), ["role--c"]);
  // Without a rule the health key filters nothing out rather than everything.
  assert.equal(applyFilters(rs, { status: "all", health: "red" }).length, 4);
});

// ---------- Items filter row (Desk preview match, Task 9) ----------

test("autoFullRead is true up to 2,000 records and false above", () => {
  assert.equal(autoFullRead(2000), true);
  assert.equal(autoFullRead(2001), false);
  assert.equal(autoFullRead(0), true);
});

test("status pill counts wait for Count all above 2,000 records", () => {
  const pills = statusPills({ health: "" }, null);
  assert.deepEqual(pills.map(pillText), ["All", "Needs action", "Check", "All good"]);
});

test("status pills carry counts when known and mark the pressed one", () => {
  const pills = statusPills({ health: "red" }, { all: 1378, red: 12, yellow: 31, green: 1335 });
  assert.deepEqual(pills.map(pillText), ["All1,378", "Needs action12", "Check31", "All good1,335"]);
  assert.deepEqual(pills.map((p) => p.pressed), [false, true, false, false]);
  assert.deepEqual(pills.map((p) => p.dot), [null, "red", "yellow", "green"]);
  assert.deepEqual(pills.map((p) => p.value), ["", "red", "yellow", "green"]);
});

test("decisionLabel", () => {
  assert.equal(decisionLabel({ decision: "keep" }), "Kept");
  assert.equal(decisionLabel({ kind: "keep" }), "Kept");
  assert.equal(decisionLabel({ decision: "drop" }), "Dropped");
  assert.equal(decisionLabel({ kind: "drop" }), "Dropped");
  assert.equal(decisionLabel(undefined), "Pending");
});

test("owner is the decider, and a comment never makes anyone an owner", () => {
  const d = new Map([["a", { decision: "keep", by: "Robin Vale" }]]);
  const c = [{ entity: "b", by: "Kit Marlow", at: "2026-10-01" }, { entity: "b", by: "Robin Vale", at: "2026-10-02" }];
  assert.equal(ownerOf("a", d, c).name, "Robin Vale");
  assert.equal(ownerOf("b", d, c), null);
  assert.equal(ownerOf("b", d, [{ verified: true, data: { entity: "b", by: "Kit Marlow", at: "2026-10-03" } }]), null);
  assert.equal(ownerOf("a", { a: { by: "Kit Marlow" } }, []).name, "Kit Marlow");
});

test("owner falls back to null, which the Owner cell draws as No owner", () => {
  assert.equal(ownerOf("z", new Map(), []), null);
  assert.equal(ownerOf("z", {}, undefined), null);
  assert.equal(ownerOf("z", new Map(), [{ entity: "z", at: "2026-10-01" }]), null);
});

test("parseCalc keeps known pairs", () => assert.deepEqual(parseCalc("notes:sum,status:unique", ["notes", "status"]), [{ field: "notes", fn: "sum" }, { field: "status", fn: "unique" }]));

test("bad calc params are ignored", () => {
  assert.deepEqual(parseCalc("nope:sum,notes:explode,<img src=x>:count,", ["notes"]), []);
  const st = readFilterState({ calc: "<b>:sum", health: "red" });
  assert.equal(st.health, "red");
  assert.deepEqual(parseCalc(st.calc, ["notes"]), []);
  assert.equal(writeFilterState(readFilterState({ calc: "notes:sum" })), "calc=notes%3Asum");
});

test("calcValue on loaded rows", () => {
  assert.equal(calcValue([{ notes: 3 }, { notes: 0 }, { notes: 2 }], { field: "notes", fn: "sum" }), "5");
  assert.equal(calcValue([{ notes: 3 }, { notes: 0 }], { field: "notes", fn: "avg" }), "1.5");
  assert.equal(calcValue([{ notes: 3 }, {}], { field: "notes", fn: "empty" }), "1");
  assert.equal(calcValue([{ notes: 3 }, {}], { field: "notes", fn: "filled" }), "1");
  assert.equal(calcValue([{ status: "a" }, { status: "a" }, { status: "b" }], { field: "status", fn: "unique" }), "2");
  assert.equal(calcValue([{ status: "a" }], { field: "status", fn: "sum" }), "");
  assert.equal(calcValue([{ notes: 1200 }, { notes: 34 }], { field: "notes", fn: "sum" }), "1,234");
});

test("exportRecord names and content", () => {
  const { exportRecord } = require(CORE + "record.js");
  const md = exportRecord(V2_ROLE, "md", V2_DEF, "Acme Desk");
  assert.match(md.name, /^acme-desk-.*-\d{4}-\d{2}-\d{2}\.md$/);
  assert.equal(md.body, require(CORE + "record.js").recordMarkdown(V2_ROLE, V2_DEF));
  const js = exportRecord(V2_ROLE, "json", V2_DEF, "Acme Desk");
  assert.match(js.name, /\.json$/);
  assert.equal(typeof JSON.parse(js.body), "object");
});

test("todayModel stack sums to total on the twin", () => {
  const m = todayModel(snapSrc("../desk_fixtures/preview-twin.json"), T_NOW);
  assert.ok(m.hero, "twin declares desk.health");
  assert.equal(m.hero.total, m.hero.red + m.hero.yellow + m.hero.green);
  assert.equal(m.hero.total, 1378);
  assert.deepEqual(m.hero.stack.map((s) => s.tone), ["danger", "warning", "success"]);
  assert.equal(m.hero.stack.reduce((a, s) => a + s.value, 0), 1378);
  assert.deepEqual(m.hero.stack.map((s) => s.label), ["Needs action", "Check", "All good"]);
});

test("historyCsv quotes commas and quotes", () => {
  const out = historyCsv([{ at: "2026-11-01T10:00:00.000Z", by: null, kind: "run", text: 'a, "b"' }]);
  const lines = out.split("\r\n");
  assert.equal(lines[0], "When,Who,Kind,What");
  assert.equal(lines[1], '2026-11-01T10:00:00.000Z,routine,run,"a, ""b"""');
});

test("decisionNow: the Decision control reads Drop for a settings-dropped record", () => {
  const { decisionNow } = require(CORE + "pages/entity.js");
  assert.equal(decisionNow("kept"), "keep");
  assert.equal(decisionNow("kept-pending"), "keep");
  assert.equal(decisionNow("person-dropped"), "drop");
  assert.equal(decisionNow("person-drop-pending"), "drop");
  assert.equal(decisionNow("dropped"), "drop");
  assert.equal(decisionNow("active"), "pending");
  assert.equal(decisionNow("drop-pending"), "pending");
});

// ---------- request queue (Desk v2 package 2) ----------

test("request writes a pending doc under requests/ and returns its id", async () => {
  const { request } = require(CORE + "actions.js");
  const sets = [];
  const store = { readOnly: false, set: (p, d) => { sets.push([p, d]); return Promise.resolve(); } };
  const ctx = { store, viewer: "u_1", definition: { producers: [{ id: "p1" }] } };
  const out = await request(ctx, "run-now", { routine: "p1", note: "check it" });
  assert.equal(sets.length, 1);
  assert.equal(sets[0][0], "requests/" + out.id);
  const d = sets[0][1];
  assert.deepEqual(Object.keys(d).sort(), ["by", "createdAt", "kind", "note", "routine", "status"]);
  assert.equal(d.status, "pending");
  assert.equal(d.kind, "run-now");
  assert.equal(d.routine, "p1");
  assert.equal(d.by, "u_1");
  assert.equal(d.note, "check it");
  assert.ok(!Number.isNaN(Date.parse(d.createdAt)));
});

test("request refuses an unknown kind, an unlisted routine and a viewer who cannot write, writing nothing", async () => {
  const { request } = require(CORE + "actions.js");
  const sets = [];
  const mk = (over) => Object.assign({ store: { readOnly: false, set: (p, d) => { sets.push(p); return Promise.resolve(); } },
    viewer: "u_1", definition: { producers: [{ id: "p1" }] } }, over || {});
  await assert.rejects(request(mk(), "delete-all", { routine: "p1" }));
  await assert.rejects(request(mk(), "run-now", { routine: "nope" }));
  await assert.rejects(request(mk(), "run-now", {}));
  await assert.rejects(request(mk({ viewer: null }), "run-now", { routine: "p1" }), /Sign in to make changes/);
  await assert.rejects(request(mk({ store: { readOnly: true, set: () => { sets.push("x"); return Promise.resolve(); } } }), "retry", { routine: "p1" }), /read only/);
  assert.equal(sets.length, 0);
});

test("requests is a people collection so the page may write requests/<id>", () => {
  assert.equal(writable("requests/abc", "u_1"), true);
  assert.equal(writable("requests/abc/x", "u_1"), false);
});

test("queuedRequests keeps pending requests for one routine, oldest first", () => {
  const { queuedRequests, QUEUED_LABEL } = require(CORE + "queue.js");
  assert.equal(QUEUED_LABEL, "Queued for next run");
  const docs = [
    doc("b", { kind: "retry", routine: "p1", status: "pending", createdAt: "2026-11-09T02:00:00Z" }),
    doc("a", { kind: "run-now", routine: "p1", status: "pending", createdAt: "2026-11-09T01:00:00Z" }),
    doc("c", { kind: "run-now", routine: "p1", status: "handled", createdAt: "2026-11-09T00:00:00Z" }),
    doc("d", { kind: "run-now", routine: "p2", status: "pending", createdAt: "2026-11-09T00:00:00Z" }),
    doc("e", { kind: "run-now", routine: "p1", status: "refused", createdAt: "2026-11-09T00:00:00Z" }),
  ];
  assert.deepEqual(queuedRequests(docs, "p1").map((d) => d.id), ["a", "b"]);
  assert.deepEqual(queuedRequests(null, "p1"), []);
});

// Desk v2 package 4: record address, position, strip and note boxes.
const STRIP_NOW = Date.parse("2026-11-09T12:00:00Z");
const POS_DEF = { types: { role: { label: "Role", plural: "Roles", fields: { title: { type: "text" }, level: { type: "choice", choices: ["junior", "senior"], summary: true } } } },
  desk: { health: { role: { field: "level", red: ["junior"], yellow: [], green: ["senior"] } } } };
function posDoc(key, level, lastSeen, extra) {
  return { id: "role--" + key, data: Object.assign({ type: "role", key: key, status: "active", lastSeen: lastSeen, sources: [], display: { title: key, level: level } }, extra || {}) };
}
function posCtx(docs, more, fail) {
  return { store: { list: (c) => (fail ? Promise.reject(new Error("down")) : Promise.resolve(c === "entities" ? docs : (more && more[c]) || [])) } };
}

test("recordHref adds the filter query and leaves a bare address alone", () => {
  const { recordHref, entityHash } = require(CORE + "shared.js");
  assert.equal(recordHref("role--a", ""), entityHash("role--a"));
  assert.equal(recordHref("role--a"), "#/entity/role/a");
  assert.equal(recordHref("role--a", "health=red&q=x"), "#/entity/role/a?health=red&q=x");
  assert.equal(recordHref("role--a", "?health=red"), "#/entity/role/a?health=red");
  assert.equal(recordHref("nodash", "health=red"), "#/today");
});

test("recPosition counts the filtered list in its sort order, not insertion order", async () => {
  const { recPosition } = require(CORE + "record.js");
  const docs = [posDoc("c", "junior", "2026-11-01T00:00:00Z"), posDoc("a", "junior", "2026-11-03T00:00:00Z"),
    posDoc("b", "junior", "2026-11-02T00:00:00Z"), posDoc("z", "senior", "2026-11-09T00:00:00Z")];
  const p = await recPosition(posCtx(docs), "role", "role--b", { health: "red" }, POS_DEF);
  assert.deepEqual([p.index, p.total, p.prev, p.next, p.label, p.qs], [1, 3, "role--a", "role--c", "Needs action", "health=red"]);
  const ends = await recPosition(posCtx(docs), "role", "role--c", { health: "red" }, POS_DEF);
  assert.deepEqual([ends.index, ends.next, ends.prev], [2, null, "role--b"]);
});

test("recPosition is null without filters, when the record is outside the list, and when the read fails", async () => {
  const { recPosition } = require(CORE + "record.js");
  const docs = [posDoc("a", "junior", "2026-11-03T00:00:00Z"), posDoc("z", "senior", "2026-11-09T00:00:00Z")];
  assert.equal(await recPosition(posCtx(docs), "role", "role--a", {}, POS_DEF), null);
  assert.equal(await recPosition(posCtx(docs), "role", "role--a", undefined, POS_DEF), null);
  assert.equal(await recPosition(posCtx(docs), "role", "role--z", { health: "red" }, POS_DEF), null);
  assert.equal(await recPosition(posCtx(docs, null, true), "role", "role--a", { health: "red" }, POS_DEF), null);
});

test("recPosition counts a list the way Browse does: stars and a pending drop change the list", async () => {
  const { recPosition } = require(CORE + "record.js");
  const docs = [posDoc("a", "junior", "2026-11-03T00:00:00Z"), posDoc("b", "junior", "2026-11-02T00:00:00Z"), posDoc("c", "junior", "2026-11-01T00:00:00Z")];
  const more = { userstate: [{ id: "role--b", data: { star: true } }, { id: "role--c", data: { star: true } }],
    decisions: [{ id: "role--c", data: { decision: "drop", by: "u1", at: "2026-11-04T00:00:00Z" } }] };
  const p = await recPosition(posCtx(docs, more), "role", "role--b", { starred: "1" }, POS_DEF);
  assert.deepEqual([p.index, p.total, p.next], [0, 1, null]);
});

test("stripItems orders state, notes, decision, captured, run, type, last seen", () => {
  const { stripItems } = require(CORE + "strip.js");
  const d = { type: "role", status: "active", lastSeen: "2026-11-09T11:00:00Z", display: { title: "T", level: "junior" },
    capture: { image: "https://img.example/a.png", capturedAt: "2026-11-09T06:11:00Z", notes: [{ text: "a" }, { text: "b" }] },
    sightings: [{ at: "2026-11-08T00:00:00Z", producer: "p", run: "old" }, { at: "2026-11-09T06:00:00Z", producer: "p", run: "run-0412" }] };
  const items = stripItems(d, null, POS_DEF, STRIP_NOW);
  assert.deepEqual(items.map((i) => i.key), ["state", "notes", "decision", "captured", "run", "type", "lastSeen"]);
  const by = Object.fromEntries(items.map((i) => [i.key, i]));
  assert.equal(by.state.label, "junior");
  assert.equal(by.notes.label, "2 image notes");
  assert.equal(by.decision.value, "active");
  assert.match(by.captured.label, /^Captured /);
  assert.equal(by.run.label, "Run run-0412");
  assert.equal(by.run.value, "run-0412");
  assert.equal(by.type.label, "Role");
});

test("stripItems omits what the record lacks and never reuses lastSeen as a capture time", () => {
  const { stripItems } = require(CORE + "strip.js");
  const bare = { type: "role", status: "active", lastSeen: "2026-11-09T11:00:00Z", display: {}, sightings: [{ at: "2026-11-09T00:00:00Z", producer: "p" }] };
  assert.deepEqual(stripItems(bare, null, { types: POS_DEF.types }, STRIP_NOW).map((i) => i.key), ["decision", "type", "lastSeen"]);
  const noRun = stripItems(Object.assign({}, bare, { capture: { notes: [] } }), null, { types: POS_DEF.types }, STRIP_NOW);
  assert.deepEqual(noRun.map((i) => i.key), ["notes", "decision", "type", "lastSeen"]);
  assert.equal(noRun[0].label, "No notes");
});

test("stripItems note chip grammar: one and many, with and without a usable image", () => {
  const { stripItems } = require(CORE + "strip.js");
  const label = (cap) => stripItems({ type: "role", display: {}, capture: cap }, null, { types: POS_DEF.types }, STRIP_NOW).find((i) => i.key === "notes").label;
  const img = "https://img.example/a.png";
  assert.equal(label({ image: img, notes: [{}] }), "1 image note");
  assert.equal(label({ image: img, notes: [{}, {}] }), "2 image notes");
  assert.equal(label({ notes: [{}] }), "1 note");
  assert.equal(label({ image: "javascript:alert(1)", notes: [{}, {}] }), "2 notes");
});

test("a declared strip replaces the default and skips what is empty", () => {
  const { stripItems } = require(CORE + "strip.js");
  const def = { types: POS_DEF.types, desk: { record: { strip: { role: [{ field: "level" }, { chip: "type" }, { chip: "run" }, { field: "title" }] } } } };
  const d = { type: "role", display: { level: "senior", title: "" }, sightings: [] };
  const items = stripItems(d, null, def, STRIP_NOW);
  assert.deepEqual(items.map((i) => i.key), ["field:level", "type"]);
  assert.equal(items[0].label, "senior");
  assert.equal(stripItems(d, null, { types: POS_DEF.types, desk: { record: { strip: { other: [{ chip: "type" }] } } } }, STRIP_NOW).map((i) => i.key).join(), "decision,type");
});

test("noteBox accepts only finite boxes inside the image and returns percentages", () => {
  const { noteBox } = require(CORE + "shared.js");
  assert.deepEqual(noteBox([0.1, 0.2, 0.3, 0.4]), { left: "10%", top: "20%", width: "30%", height: "40%" });
  assert.deepEqual(noteBox([0, 0, 1, 1]), { left: "0%", top: "0%", width: "100%", height: "100%" });
  for (const bad of [[2, 0, 1, 1], [NaN, 0, 0.1, 0.1], [0.1, 0.1, 0, 0.1], [0.1, 0.1, 0.1, -0.1], [0.8, 0, 0.5, 0.1], [0, 0.95, 0.1, 0.1],
    [0.1, 0.1, 0.1], "x", null, undefined, [Infinity, 0, 0.1, 0.1], ["0.1", 0, 0.1, 0.1]]) assert.equal(noteBox(bad), null, JSON.stringify(bad));
});

// ---------- Today, Approvals, Runs (desk v2 package 5) ----------

const { headline, leadLine, lastRefreshed, progressDelta, healthTiles } = require(CORE + "pages/today.js");
const { queuedBanner } = require(CORE + "pages/approvals.js");
const { runsModel, nextRunLine } = require(CORE + "pages/runs-health.js");
const paging5 = require(CORE + "paging.js");

test("headline with reds and warns counts every non-green item", () => {
  assert.equal(headline({ red: 2, yellow: 3, green: 5, total: 10 }), "Not all green yet: 5 items need attention");
  assert.equal(headline({ red: 0, yellow: 1, green: 5, total: 6 }), "Not all green yet: 1 item needs attention");
});

test("headline all green", () => {
  assert.equal(headline({ red: 0, yellow: 0, green: 4, total: 4 }), "All green");
});

test("headline is null when capped, empty or undeclared", () => {
  assert.equal(headline({ red: 0, yellow: 0, green: 30000, total: 30000, capped: true }), null);
  assert.equal(headline({ red: 0, yellow: 0, green: 0, total: 0 }), null);
  assert.equal(headline(null), null);
  assert.equal(leadLine({ red: 1, yellow: 1, green: 1, total: 3, capped: true }), null);
  assert.equal(leadLine({ red: 2, yellow: 3, green: 1, total: 6 }), "2 need action now, 3 to check");
});

function pagedStore(n) {
  const rows = Array.from({ length: n }, (_, i) => ({ id: "r" + String(i).padStart(6, "0"), data: { key: "k" + String(i).padStart(6, "0") } }));
  return { list: async (c, q) => {
    const gt = (q.where || []).filter((w) => w[0] === "key" && w[1] === ">")[0];
    return rows.filter((r) => !gt || r.data.key > gt[2]).slice(0, q.limit);
  } };
}

test("fullRead sets capped at the 30th full page", async () => {
  const capped = await paging5.fullRead(pagedStore(30000), "entities", {});
  assert.equal(capped.length, 30000);
  assert.equal(capped.capped, true);
  const exact = await paging5.fullRead(pagedStore(2500), "entities", {});
  assert.equal(exact.capped, false);
  const almost = await paging5.fullRead(pagedStore(29999), "entities", {});
  assert.equal(almost.capped, false);
});

test("lastRefreshed picks the newest finish in the viewer's zone", () => {
  const runs = [
    doc("a", { startedAt: "2026-11-01T01:00:00Z", endedAt: "2026-11-01T02:00:00Z" }),
    doc("b", { startedAt: "2026-11-08T22:00:00Z", endedAt: "2026-11-08T23:30:00Z" }),
    doc("c", { startedAt: "2026-11-05T01:00:00Z" }),
  ];
  const utc = lastRefreshed(runs, "UTC", "en-US");
  assert.match(utc, /^Last refreshed at /);
  assert.match(utc, /Nov 8/);
  assert.match(utc, /11:30/);
  assert.match(lastRefreshed(runs, "Australia/Brisbane", "en-US"), /Nov 9/);
  assert.equal(lastRefreshed([], "UTC"), null);
  assert.equal(lastRefreshed([doc("x", { startedAt: "nope" })], "UTC"), null);
});

test("delta says since the previous run and only with both counts", () => {
  const run = (id, at, green, total) => doc(id, { startedAt: at, counts: { green, total } });
  const runs = [run("a", "2026-11-01T00:00:00Z", 90, 100), run("b", "2026-11-02T00:00:00Z", 95, 100)];
  assert.equal(progressDelta(runs), "up 5% since the previous run");
  assert.equal(progressDelta([runs[1], run("c", "2026-11-03T00:00:00Z", 91, 100)]), "down 4% since the previous run");
  assert.equal(progressDelta([run("a", "2026-11-01T00:00:00Z", 90, 100)]), null);
  assert.equal(progressDelta([doc("a", { startedAt: "2026-11-01T00:00:00Z" }), run("b", "2026-11-02T00:00:00Z", 95, 100)]), null);
});

test("three tiles link to browse health red, yellow, green", () => {
  const t = healthTiles({ type: "role s", red: 1, yellow: 2, green: 3, total: 6 });
  assert.deepEqual(t.map((x) => [x.label, x.value, x.href]), [
    ["Needs action", 1, "#/browse/role%20s?health=red"],
    ["Check", 2, "#/browse/role%20s?health=yellow"],
    ["All good", 3, "#/browse/role%20s?health=green"],
  ]);
  assert.equal(healthTiles(null), null);
});

test("queuedBanner shows Queued for next run only for pending requests", () => {
  const defn = { producers: [{ id: "scout", schedule: "0 6 * * *" }] };
  const now = Date.parse("2026-11-09T00:00:00Z");
  const reqs = [doc("req~1", { status: "pending", routine: "scout" }), doc("req~2", { status: "handled", routine: "scout" }),
    { id: "g1", state: "queued" }, { id: "g2", state: "done" }];
  const b = queuedBanner(reqs, defn, now);
  assert.match(b, /^2 queued for next run/);
  assert.equal(queuedBanner([doc("req~2", { status: "handled", routine: "scout" }), { id: "g2", state: "done" }], defn, now), null);
  assert.equal(queuedBanner([], defn, now), null);
});

test("next-run id is never shown", () => {
  const now = Date.parse("2026-11-09T00:00:00Z");
  const line = nextRunLine({ at: "2026-11-09T06:00:00Z", certain: true }, 2, now);
  assert.match(line, /^Next run /);
  assert.match(line, /with 2 approvals queued\.$/);
  assert.doesNotMatch(line, /scout|run-\d|#\d/i);
  assert.match(nextRunLine({ at: null }, 1, now), /with 1 approval queued\.$/);
  assert.doesNotMatch(nextRunLine({ at: null }, 0, now), /queued/);
});

test("run columns Captured, Failed, New reds, Cost appear only when a run doc has the field", () => {
  const defn = { producers: [{ id: "scout", schedule: "0 6 * * *" }] };
  const now = Date.parse("2026-11-09T12:00:00Z");
  const plain = { id: "r1", data: { producer: "scout", startedAt: "2026-11-09T06:00:00Z", endedAt: "2026-11-09T06:10:00Z", status: "ok", counts: { new: 1 } } };
  const m0 = runsModel({ definition: defn, runs: [plain] }, now);
  assert.deepEqual(m0.columns, []);
  assert.equal(m0.cost, null);
  const rich = { id: "r2", data: { producer: "scout", startedAt: "2026-11-09T07:00:00Z", status: "ok", cost: 1.25,
    counts: { new: 1, captured: 9, failed: 2, newReds: 1 } } };
  const m1 = runsModel({ definition: defn, runs: [plain, rich] }, now);
  assert.deepEqual(m1.columns.map((c) => c.key), ["captured", "failed", "newReds", "cost"]);
  const row = m1.rows.filter((r) => r.id === "r2")[0];
  assert.equal(row.extra.captured, 9);
  assert.equal(row.extra.cost, 1.25);
  assert.equal(m1.cost, 1.25);
  const partial = runsModel({ definition: defn, runs: [{ id: "r3", data: { producer: "scout", startedAt: "2026-11-09T07:00:00Z", counts: { failed: 0 } } }] }, now);
  assert.deepEqual(partial.columns.map((c) => c.key), ["failed"]);
});

test("dayGroup names the calendar day against now: Today, Yesterday, This week, Earlier", () => {
  const { dayGroup, DAY_GROUPS } = require(CORE + "dates.js");
  const now = Date.parse("2026-11-09T12:00:00Z");
  const z = { timeZone: "UTC" };
  assert.deepEqual(DAY_GROUPS, ["Today", "Yesterday", "This week", "Earlier"]);
  assert.equal(dayGroup("2026-11-09T00:30:00Z", now, z), "Today");
  assert.equal(dayGroup("2026-11-08T23:59:00Z", now, z), "Yesterday");
  assert.equal(dayGroup("2026-11-04T10:00:00Z", now, z), "This week");
  assert.equal(dayGroup("2026-11-03T10:00:00Z", now, z), "This week");
  assert.equal(dayGroup("2026-11-02T10:00:00Z", now, z), "Earlier");
  assert.equal(dayGroup("2026-11-10T10:00:00Z", now, z), "Today");
  assert.equal(dayGroup("not a date", now, z), "Earlier");
  // the viewer's zone decides the calendar day, not UTC
  assert.equal(dayGroup("2026-11-08T23:30:00Z", Date.parse("2026-11-09T01:00:00Z"), { timeZone: "UTC" }), "Yesterday");
  assert.equal(dayGroup("2026-11-08T23:30:00Z", Date.parse("2026-11-09T01:00:00Z"), { timeZone: "Pacific/Auckland" }), "Today");
});

test("palette search covers every row passed and reports capped only when matches pass the limit", () => {
  const { search } = require(CORE + "palette.js");
  const rows = [];
  for (let i = 0; i < 30; i++) rows.push({ id: "role--r" + i, data: { key: "r" + i, status: "active", display: { title: "Analyst " + i } } });
  rows.push({ id: "role--z", data: { key: "z", status: "active", display: { title: "Zebra keeper" } } });
  const few = search("zebra", rows, 20);
  assert.deepEqual(few.hits.map((r) => r.id), ["role--z"]);
  assert.equal(few.capped, false);
  const many = search("analyst", rows, 20);
  assert.equal(many.hits.length, 20);
  assert.equal(many.capped, true);
  const exact = search("analyst", rows.slice(0, 20), 20);
  assert.equal(exact.hits.length, 20);
  assert.equal(exact.capped, false);
  assert.deepEqual(search("  ", rows, 20), { hits: [], capped: false });
});

test("palette actions: Switch theme always, Take the tour only when the tour is available", () => {
  const { paletteActions } = require(CORE + "palette.js");
  assert.deepEqual(paletteActions({ tour: false }).map((a) => a.label), ["Switch theme"]);
  assert.deepEqual(paletteActions({ tour: true }).map((a) => a.label), ["Switch theme", "Take the tour"]);
});

test("nextTheme cycles system, light, dark", () => {
  const { nextTheme } = require(CORE + "palette.js");
  assert.equal(nextTheme("system"), "light");
  assert.equal(nextTheme("light"), "dark");
  assert.equal(nextTheme("dark"), "system");
  assert.equal(nextTheme("nope"), "light");
});

test("signedInLine names the viewer, and is null without a usable name", () => {
  const { signedInLine, SIGN_OUT_NOTE } = require(CORE + "palette.js");
  assert.equal(signedInLine("Alex Rivera"), "Signed in as Alex Rivera");
  assert.equal(signedInLine("someone"), null);
  assert.equal(signedInLine(""), null);
  assert.equal(signedInLine(null), null);
  assert.equal(SIGN_OUT_NOTE, "No sign-out here");
});

test("notGreenCount counts rows whose health is not green, and is null with no health rule", () => {
  const { notGreenCount, notGreenLine } = require(CORE + "pages/browse.js");
  const rule = { field: "level", red: ["junior"], yellow: ["mid"], green: ["senior"] };
  const row = (level) => ({ id: "x" + level, f: { level } });
  const rows = [row("junior"), row("mid"), row("senior"), row("senior"), row("odd")];
  assert.equal(notGreenCount(rule, rows), 3);
  assert.equal(notGreenCount(null, rows), null);
  assert.equal(notGreenLine(3), "3 items not green yet");
  assert.equal(notGreenLine(1), "1 item not green yet");
  assert.equal(notGreenLine(0), "0 items not green yet");
});
