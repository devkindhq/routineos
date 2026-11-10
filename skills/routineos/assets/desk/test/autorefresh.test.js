import { expect, test } from "vitest";
import { AUTO_GRACE_MS, msUntilRefresh } from "../core/pages/autorefresh.js";

function def(schedule) { return { producers: [{ id: "weekly", schedule: schedule }] }; }
var SUNDAY_20 = Date.UTC(2026, 10, 8, 20, 0, 0); // Sunday 2026-11-08

test("the delay is the time to the next run plus the grace", () => {
  expect(msUntilRefresh(def("0 21 * * 0"), SUNDAY_20, AUTO_GRACE_MS)).toBe(3600000 + AUTO_GRACE_MS);
  expect(msUntilRefresh(def("0 21 * * 0"), SUNDAY_20, 0)).toBe(3600000);
});

test("a schedule the Desk cannot read gives no timer", () => {
  expect(msUntilRefresh(def("0 21 1 * *"), SUNDAY_20, AUTO_GRACE_MS)).toBeNull();
});

test("no producer, or none with a due run, gives no timer", () => {
  expect(msUntilRefresh({ producers: [] }, SUNDAY_20, AUTO_GRACE_MS)).toBeNull();
  expect(msUntilRefresh(null, SUNDAY_20, AUTO_GRACE_MS)).toBeNull();
});

test("a run that fires right now still waits at least the grace", () => {
  expect(msUntilRefresh(def("0 21 * * 0"), Date.UTC(2026, 10, 8, 21, 0, 0), AUTO_GRACE_MS)).toBeGreaterThanOrEqual(AUTO_GRACE_MS);
});

test("the grace is 90 seconds", () => {
  expect(AUTO_GRACE_MS).toBe(90000);
});
