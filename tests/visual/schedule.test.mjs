// node --test tests/visual/schedule.test.mjs: cron helpers live in schedule.js; nextRunFor picks a producer's next run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE = join(HERE, "..", "..", "skills", "routineos", "assets", "desk", "core");
const require = createRequire(import.meta.url);
const schedule = require(join(CORE, "schedule.js"));
const runs = require(join(CORE, "pages", "runs.js"));

const NOW = Date.parse("2026-10-28T00:00:00Z");
const DEF = { producers: [{ id: "p1", schedule: "0 6 * * *" }, { id: "p2", schedule: "30 2 * * *" }] };

test("schedule.js exports the cron helpers and runs.js no longer does", () => {
  for (const n of ["cronField", "cronParts", "fireTimes", "scheduleInterval", "isLate", "nextRun", "nextRunFor"]) {
    assert.equal(typeof schedule[n], "function", n);
    assert.equal(runs[n], undefined, n + " left runs.js");
  }
});

test("nextRunFor gives the earliest next run across all producers", () => {
  assert.deepEqual(schedule.nextRunFor(DEF, null, NOW), { at: "2026-10-28T02:30:00.000Z", certain: true });
});

test("nextRunFor reads only the named producers", () => {
  assert.deepEqual(schedule.nextRunFor(DEF, ["p1"], NOW), { at: "2026-10-28T06:00:00.000Z", certain: true });
});

test("nextRunFor is not certain when a named schedule does not parse", () => {
  const def = { producers: [{ id: "p1", schedule: "0 6 * * *" }, { id: "p3", schedule: "whenever" }] };
  assert.deepEqual(schedule.nextRunFor(def, null, NOW), { at: null, certain: false });
  assert.deepEqual(schedule.nextRunFor(def, ["p1"], NOW), { at: "2026-10-28T06:00:00.000Z", certain: true });
});

test("nextRunFor with no producers has no next run", () => {
  assert.deepEqual(schedule.nextRunFor({}, null, NOW), { at: null, certain: true });
});
