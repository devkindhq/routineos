// node --test tests/visual/dates.test.mjs: dates.js human dates across locales and zones with a fixed now.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE = join(HERE, "..", "..", "skills", "routineos", "assets", "desk", "core");
const require = createRequire(import.meta.url);
const { human, exact, bucket, bucketLabel, plural } = require(join(CORE, "dates.js"));

const NOW = Date.parse("2026-11-03T14:32:00Z");
const L = { locale: "en-GB", timeZone: "UTC" };
const US = { locale: "en-US", timeZone: "UTC" };

test("human: en-GB rules in UTC", () => {
  assert.equal(human("2026-11-03T14:31:40Z", NOW, L), "just now");
  assert.equal(human("2026-11-03T14:27:00Z", NOW, L), "5 minutes ago");
  assert.equal(human("2026-11-03T09:05:00Z", NOW, { ...L, style: "list" }), "09:05");
  assert.equal(human("2026-11-03T09:05:00Z", NOW, { ...L, style: "sentence" }), "today at 09:05");
  assert.equal(human("2026-11-02T14:32:00Z", NOW, L), "yesterday at 14:32");
  assert.equal(human("2026-10-28T14:32:00Z", NOW, { ...L, style: "list" }), "Wed 14:32");
  assert.equal(human("2026-10-28T14:32:00Z", NOW, { ...L, style: "sentence" }), "Wednesday at 14:32");
  assert.equal(human("2026-10-03T08:00:00Z", NOW, L), "3 Oct");
  assert.equal(human("2025-11-03T08:00:00Z", NOW, L), "3 Nov 2025");
});

test("human: future values mirror", () => {
  assert.equal(human("2026-11-04T04:32:00Z", NOW, L), "in 14 hours");
  assert.equal(human("2026-11-04T09:00:00Z", NOW, { ...L, style: "sentence" }), "tomorrow at 09:00");
  assert.equal(human("2026-11-03T14:37:00Z", NOW, L), "in 5 minutes");
});

test("human: en-US prints its own forms", () => {
  assert.equal(human("2026-10-03T08:00:00Z", NOW, US), "Oct 3");
  assert.equal(human("2025-11-03T08:00:00Z", NOW, US), "Nov 3, 2025");
  assert.equal(human("2026-11-03T09:05:00Z", NOW, { ...US, style: "list" }).replace(/\s/g, " "), "9:05 AM");
  assert.equal(human("2026-11-02T14:32:00Z", NOW, US).replace(/\s/g, " "), "yesterday at 2:32 PM");
});

test("human: de-DE follows Intl with the same options", () => {
  const D = { locale: "de-DE", timeZone: "UTC" };
  const hm = { hour: "2-digit", minute: "2-digit" }; // de-DE uses a 24-hour clock
  const fmt = (o, iso) => new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", ...o }).format(new Date(iso));
  assert.equal(human("2026-11-03T09:05:00Z", NOW, { ...D, style: "list" }), fmt(hm, "2026-11-03T09:05:00Z"));
  assert.equal(human("2026-10-28T14:32:00Z", NOW, { ...D, style: "list" }),
    fmt({ weekday: "short", ...hm }, "2026-10-28T14:32:00Z"));
  assert.equal(human("2026-10-03T08:00:00Z", NOW, D), fmt({ day: "numeric", month: "short" }, "2026-10-03T08:00:00Z"));
  assert.equal(human("2025-11-03T08:00:00Z", NOW, D), fmt({ day: "numeric", month: "short", year: "numeric" }, "2025-11-03T08:00:00Z"));
  assert.equal(human("2026-11-03T14:27:00Z", NOW, D),
    new Intl.RelativeTimeFormat("de-DE", { numeric: "auto" }).format(-5, "minute"));
});

test("bucket: the day boundary follows the zone", () => {
  // At NOW it is 3 Nov 14:32 in UTC, 3 Nov 09:32 in New York and 4 Nov 01:32 in Sydney.
  // 2026-11-03T02:00Z is 3 Nov 02:00 UTC (today), 2 Nov 21:00 New York (yesterday), 3 Nov 13:00 Sydney (yesterday).
  assert.equal(bucket("2026-11-03T02:00:00Z", NOW, { timeZone: "UTC" }), "today");
  assert.equal(bucket("2026-11-03T02:00:00Z", NOW, { timeZone: "America/New_York" }), "yesterday");
  assert.equal(bucket("2026-11-03T02:00:00Z", NOW, { timeZone: "Australia/Sydney" }), "yesterday");
  // 2026-11-03T14:00Z is 4 Nov 01:00 in Sydney, still today there.
  assert.equal(bucket("2026-11-03T14:00:00Z", NOW, { timeZone: "Australia/Sydney" }), "today");
  assert.equal(bucket("2026-11-02T22:00:00Z", NOW, { timeZone: "UTC" }), "yesterday");
  assert.equal(bucket("2026-10-31T10:00:00Z", NOW, L), "thisWeek");
  assert.equal(bucket("2026-09-24T10:00:00Z", NOW, L), "month:2026-09");
  assert.equal(bucket("2025-09-24T10:00:00Z", NOW, L), "year:2025");
});

test("human: a day boundary differs by zone", () => {
  assert.equal(human("2026-11-03T02:00:00Z", NOW, { locale: "en-GB", timeZone: "UTC", style: "sentence" }), "today at 02:00");
  assert.equal(human("2026-11-03T02:00:00Z", NOW, { locale: "en-GB", timeZone: "America/New_York", style: "sentence" }), "yesterday at 21:00");
  assert.equal(human("2026-11-03T02:00:00Z", NOW, { locale: "en-GB", timeZone: "Australia/Sydney", style: "sentence" }), "yesterday at 13:00");
});

test("bucketLabel names each group", () => {
  assert.equal(bucketLabel("today", US), "Today");
  assert.equal(bucketLabel("yesterday", US), "Yesterday");
  assert.equal(bucketLabel("thisWeek", US), "This week");
  assert.equal(bucketLabel("month:2026-10", US), "October");
  assert.equal(bucketLabel("year:2025", US), "2025");
});

test("exact gives the full local date, time and zone", () => {
  const s = exact("2026-11-03T14:32:00Z", US);
  assert.match(s, /2026/);
  assert.match(s, /UTC/);
  assert.match(s, /November/);
  assert.equal(exact("", US), "");
});

test("empty or unparsable input", () => {
  assert.equal(human("", NOW, L), "");
  assert.equal(human(null, NOW, L), "");
  assert.equal(human("nope", NOW, L), "");
  assert.equal(bucket("nope", NOW, L), null);
  assert.equal(bucket("", NOW, L), null);
});

test("plural uses Intl.PluralRules", () => {
  assert.equal(plural(1, "item", "items", "en-US"), "1 item");
  assert.equal(plural(2, "item", "items", "en-US"), "2 items");
  assert.equal(plural(0, "item", "items", "en-US"), "0 items");
  assert.equal(plural(1200, "item", "items", "en-US"), "1,200 items");
});

function jsFiles(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? jsFiles(p) : n.endsWith(".js") ? [p] : [];
  });
}

test("no file under CORE calls when(", () => {
  const hits = jsFiles(CORE).filter((p) => /\bwhen\(/.test(readFileSync(p, "utf8")));
  assert.deepEqual(hits, []);
});

test("untilText says hours under two days and days after", () => {
  assert.equal(require(join(CORE, "dates.js")).untilText(0), "under an hour");
  assert.equal(require(join(CORE, "dates.js")).untilText(1), "1 hour");
  assert.equal(require(join(CORE, "dates.js")).untilText(14), "14 hours");
  assert.equal(require(join(CORE, "dates.js")).untilText(84), "4 days");
  assert.equal(require(join(CORE, "dates.js")).untilText(48), "2 days");
});
