// Store contract parity on the Mantine Desk. For each user action, the collections read and the paths written
// while it runs must equal the 0.8.1 golden (tests/visual/golden/store-calls.json). Also pins the v2 grouped nav
// model (golden/nav-v2.json). Both goldens are read only; a mismatch is fixed in the app code, never in the golden.
//
// Each action mounts the real App over a recording store built on the static adapter and the jobs-watch demo
// snapshot, with a fixed clock (inside the demo gate's 48 hour window) and viewer u_test. The log is cleared once
// the page has settled, then the action is triggered by role and label.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { notifications } from "@mantine/notifications";
import App from "../app/App.jsx";
import { navModel } from "../core/palette.js";
import { createStore } from "../core/store.js";

var HERE = dirname(fileURLToPath(import.meta.url));
var ROOT = join(HERE, "..", "..", "..", "..", "..");
var DEMO = join(ROOT, "templates", "jobs-watch", "demo", "desk-demo.json");
var GOLDEN = join(ROOT, "tests", "visual", "golden");
var VIEWER = "u_test";
var NOW = new Date("2026-10-28T00:00:00Z");
var MODULES = [{ id: "remote-week", kind: "view", label: "Remote this week", view: { type: "role" } }];

function demo() { return JSON.parse(readFileSync(DEMO, "utf8")); }
function golden(name) { return JSON.parse(readFileSync(join(GOLDEN, name), "utf8")); }

function parentOf(p) { return String(p).slice(0, String(p).lastIndexOf("/")); }

// The static adapter over a mutable copy of the demo, made writable for viewer u_test. set and del change that
// copy, and every call is recorded. Reads are recorded as collections (a get reads its parent collection).
function recordingStore(docs) {
  var store = createStore("static", { docs: docs });
  var log = { reads: new Set(), writes: new Set(), watches: new Set() };
  var get = store.get, list = store.list, subscribe = store.subscribe;
  store.readOnly = false;
  store.log = log;
  store.get = function (p) { log.reads.add(parentOf(p)); return get.apply(store, arguments); };
  store.list = function (c) { log.reads.add(c); return list.apply(store, arguments); };
  store.subscribe = function (c) { log.reads.add(c); log.watches.add(c); return subscribe.apply(store, arguments); };
  store.set = function (p, d) {
    log.writes.add(p);
    docs[p] = { version: ((docs[p] && docs[p].version) || 0) + 1, data: JSON.parse(JSON.stringify(d)) };
    return Promise.resolve();
  };
  store.del = function (p) { log.writes.add(p); delete docs[p]; return Promise.resolve(); };
  store.viewer = function () { return Promise.resolve(VIEWER); };
  return store;
}

// Ids are replaced by "*": the last segment of every path, and the viewer id inside per-viewer paths.
function shape(path) {
  var seg = String(path).split("/").map(function (s) { return s === VIEWER ? "*" : s; });
  if (seg.length > 1) seg[seg.length - 1] = "*";
  return seg.join("/");
}

// Lets pending promises, effects and macrotasks run until the page stops changing.
async function idle() {
  for (var i = 0; i < 15; i++) {
    await act(function () { return new Promise(function (r) { setTimeout(r, 0); }); });
  }
}

// Mounts the App at hash, waits for ready() to find the action's target, clears the log, runs the action, and
// returns what the action alone read and wrote.
async function runAction(hash, ready, action, prep) {
  var docs = demo();
  if (prep) prep(docs);
  var store = recordingStore(docs);
  window.history.replaceState(null, "", hash);
  render(<App store={store} config={{ store: "static", workspace: "Demo" }} />);
  await waitFor(ready, { timeout: 4000 });
  await idle();
  store.log.reads.clear();
  store.log.writes.clear();
  await action();
  await waitFor(function () { expect(store.log.writes.size).toBeGreaterThan(0); }, { timeout: 4000 });
  await idle();
  return {
    docs: docs,
    reads: Array.from(store.log.reads).sort(),
    writes: Array.from(new Set(Array.from(store.log.writes).map(shape))).sort(),
  };
}

function click(el) { fireEvent.click(el); }
function button(name, root) { return (root ? within(root) : screen).getAllByRole("button", { name: name })[0]; }
function findButton(name, root) { return function () { expect((root ? within(root()) : screen).getAllByRole("button", { name: name }).length).toBeGreaterThan(0); }; }

// The item (card or list row) holding a button named name and the text label.
function itemWith(label, name) {
  var hit = screen.getAllByRole("button", { name: name }).map(function (b) { return b.closest("[data-id]") || b.closest("li"); })
    .filter(function (el) { return el && (!label || label.test(el.textContent)); });
  expect(hit.length).toBeGreaterThan(0);
  return hit[0];
}

var ACTIONS = {
  approve: function () {
    return runAction("#/approvals", findButton("Approve"), function () { click(button("Approve")); });
  },
  reject: function () {
    return runAction("#/approvals", findButton("Add note"), async function () {
      click(button("Add note"));
      var box = await screen.findByRole("textbox", { name: /note/i });
      fireEvent.change(box, { target: { value: "Not a fit" } });
      click(button("Decline"));
    });
  },
  accept: function () {
    return runAction("#/approvals?kind=proposals", findButton("Approve"), function () { click(button("Approve")); });
  },
  snooze: function () {
    return runAction("#/approvals?kind=proposals", findButton("Snooze"), function () { click(button("Snooze")); });
  },
  "keep view": function () {
    return runAction("#/settings/views", findButton("Keep"), function () {
      click(button("Keep", itemWith(/Senior roles in AU|Remote roles this month/, "Keep")));
    });
  },
  "save view": function () {
    return runAction("#/browse/role", findButton("Save view"), async function () {
      click(button("Save view"));
      var name = await screen.findByRole("textbox", { name: "View name" });
      fireEvent.change(name, { target: { value: "My view" } });
      click(await within(name.closest("[role=dialog]")).findByRole("button", { name: "Save view" }));
    });
  },
  pin: function () {
    return runAction("#/settings/views", findButton(/^Pin/), function () { click(button(/^Pin/)); });
  },
  star: function () {
    return runAction("#/browse/role", findButton(/^Star /), function () { click(button(/^Star /)); });
  },
  "column change": function () {
    return runAction("#/settings/views", findButton("Keep"), function () {
      click(button("Keep", itemWith(/Fit score/, "Keep")));
    });
  },
  "setting change": function () {
    function section() { return screen.getByRole("heading", { level: 3, name: "Jobs watch" }).closest("section"); }
    return runAction("#/settings/routine", function () { expect(section()).toBeTruthy(); }, async function () {
      var input = within(section()).getByRole("textbox", { name: /lookback/i });
      fireEvent.change(input, { target: { value: String(Number(input.value || 0) + 1) } });
      fireEvent.blur(input);
      click(button("Save", section()));
    });
  },
};

beforeEach(function () {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  try { localStorage.clear(); } catch (e) { /* storage blocked */ }
  notifications.clean();
});

afterEach(function () {
  cleanup();
  vi.useRealTimers();
  window.history.replaceState(null, "", "#/today");
});

var want = golden("store-calls.json");
Object.keys(want).forEach(function (name) {
  test("store calls for " + name + " match 0.8.1", async function () {
    var r = await ACTIONS[name]();
    expect({ reads: r.reads, writes: r.writes }).toEqual(want[name]);
  }, 15000);
});

test("every golden action has a trigger here", function () {
  expect(Object.keys(ACTIONS).sort()).toEqual(Object.keys(want).sort());
});

test("navModel over the demo snapshot equals the v2 nav", function () {
  var docs = demo();
  var def = docs["meta/definition"].data;
  var views = Object.keys(docs).filter(function (p) { return p.indexOf("views/") === 0; })
    .map(function (p) { return { id: p.slice(6), path: p, exists: true, data: docs[p].data }; });
  var pins = new Set(["new-roles"]);
  var nav = JSON.parse(JSON.stringify({ input: { pins: Array.from(pins) }, nav: navModel(def, views, pins, null) }));
  expect(nav).toEqual(golden("nav-v2.json"));
});

test("hide module writes settings/workspace and one settingsHistory entry", async function () {
  var before = 0;
  var r = await runAction("#/settings/modules", function () { screen.getByRole("switch", { name: /Remote this week/ }); }, function () {
    click(screen.getByRole("switch", { name: /Remote this week/ }));
    click(button("Save sidebar"));
  }, function (d) {
    before = Object.keys(d).filter(function (p) { return p.indexOf("settingsHistory/") === 0; }).length;
    d["meta/definition"].data.desk = { modules: MODULES };
  });
  expect(r.writes).toEqual(["settings/*", "settingsHistory/*"]);
  expect(r.docs["settings/workspace"].data.values.nav).toEqual({ hidden: ["remote-week"] });
  expect(Object.keys(r.docs).filter(function (p) { return p.indexOf("settingsHistory/") === 0; }).length).toBe(before + 1);
}, 15000);

// The shell's own watch: settings is read only for a definition with desk modules.
async function shellReads(prep) {
  var docs = demo();
  if (prep) prep(docs);
  var store = recordingStore(docs);
  // A page that watches nothing itself, so only the shell's watches are recorded. The boot's one-time gets
  // (meta/*, settings/workspace) are reads, not watches.
  window.history.replaceState(null, "", "#/settings/shortcuts");
  render(<App store={store} config={{ store: "static", workspace: "Demo" }} />);
  await screen.findByRole("heading", { level: 1 });
  await idle();
  cleanup();
  return Array.from(store.log.watches).sort();
}

test("the shell watches settings only when the definition has desk modules", async function () {
  var shell = ["columns", "data/users/u_test/state/pin", "data/users/u_test/state/read", "decisions", "inbox", "pending",
    "people/u_test/decisions", "runs", "views"];
  var plain = await shellReads();
  expect(plain).toEqual(shell);
  var withModules = await shellReads(function (d) { d["meta/definition"].data.desk = { modules: MODULES }; });
  expect(withModules).toEqual(shell.concat(["settings"]).sort());
}, 15000);
