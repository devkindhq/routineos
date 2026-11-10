// core/keys.js and core/prefs.js: the g-chord machine and the per-viewer prefs, without a DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createChordMachine, G_WAIT_MS } from "../../skills/routineos/assets/desk/core/keys.js";
import { readPref, savePref, readConfig, THEME_KEY, MOTIONS } from "../../skills/routineos/assets/desk/core/prefs.js";

function machine(types) {
  const seen = { nav: [], run: [] };
  let t = 0;
  const m = createChordMachine({ onNav: (h) => seen.nav.push(h), onRun: (r) => seen.run.push(r), now: () => t, types });
  return { m, seen, at: (ms) => { t = ms; } };
}

test("g then a page letter goes there; a late second key is read alone", () => {
  const { m, seen, at } = machine([]);
  assert.equal(m.key({ key: "g" }), true);
  assert.equal(m.key({ key: "t" }), true);
  assert.deepEqual(seen.nav, ["#/today"]);
  m.key({ key: "g" });
  at(G_WAIT_MS + 1);
  assert.equal(m.key({ key: "t" }), false);
  assert.deepEqual(seen.nav, ["#/today"]);
});

test("g then a type letter opens that type; single keys run their action", () => {
  const { m, seen } = machine(() => [{ id: "job", plural: "Jobs" }]);
  m.key({ key: "g" });
  m.key({ key: "j" });
  assert.deepEqual(seen.nav, ["#/browse/job"]);
  assert.equal(m.key({ key: "F" }), true);
  assert.equal(m.key({ key: "?" }), true);
  assert.deepEqual(seen.run, ["filters", "help"]);
});

test("modifiers, typing and named keys are never shortcuts", () => {
  const { m, seen } = machine([]);
  assert.equal(m.key({ key: "f", metaKey: true }), false);
  assert.equal(m.key({ key: "f", target: { tagName: "TEXTAREA" } }), false);
  assert.equal(m.key({ key: "Enter" }), false);
  assert.deepEqual(seen.run, []);
});

test("prefs fall back when storage is missing or holds an unknown value", () => {
  const saved = globalThis.localStorage;
  const mem = new Map();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) } });
  try {
    assert.equal(readPref(THEME_KEY, ["system", "light", "dark"], "system"), "system");
    savePref(THEME_KEY, "dark");
    assert.equal(mem.get("routineos-desk-theme"), "dark");
    assert.equal(readPref(THEME_KEY, ["system", "light", "dark"], "system"), "dark");
    savePref(THEME_KEY, "neon");
    assert.equal(readPref(THEME_KEY, ["system", "light", "dark"], "system"), "system");
    assert.deepEqual(MOTIONS, ["system", "reduce"]);
  } finally {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: saved });
  }
});

test("readConfig parses the config node and is {} when it is missing or broken", () => {
  assert.deepEqual(readConfig({ textContent: '{"store":"db"}' }), { store: "db" });
  assert.deepEqual(readConfig(null), {});
  assert.deepEqual(readConfig({ textContent: "{nope" }), {});
});
