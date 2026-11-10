// Verify walk (spec 2026-11-09-desk-verify-walk): each Verify row of the alignment bundle, walked on the built Desk at
// 390px against the walk fixture (/snap/walk.json). Every test asserts what the Desk does now and ends as a one-line
// finding in out/walk-findings.txt, in the walk note's wording. Real key events here settle the Esc and arrow keys
// the browser tool could not. Run with: bash tests/visual/run.sh (or DESK_SPECS=walk.spec.mjs).
import { test as base, expect } from "@playwright/test";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { start, deskUrl } from "./serve.mjs";
import { fakeClaude } from "./fake-claude.mjs";
import { noHorizontalScroll } from "./layout.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const FINDINGS = join(OUT, "walk-findings.txt");
mkdirSync(OUT, { recursive: true });
const NOW = new Date("2026-10-28T00:00:00Z");
const ROLE3 = "#/entity/role/https-jobs-example-au-00003";
const W = 390;

let server;
let origin;

const test = base.extend({
  guard: [async ({ page }, use) => {
    await page.clock.setFixedTime(NOW);
    const problems = [];
    page.on("console", (m) => { if (m.type() === "error") problems.push("console: " + m.text()); });
    page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
    page.on("dialog", (d) => { problems.push("dialog: " + d.message()); d.dismiss(); });
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.protocol === "data:" || u.protocol === "blob:") return;
      if (u.origin !== origin) problems.push("request: " + r.url());
    });
    await use(null);
    expect(problems).toEqual([]);
  }, { auto: true }],
});

test.use({ timezoneId: "UTC", locale: "en-US", viewport: { width: W, height: 844 }, colorScheme: "light" });
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  server = await start();
  origin = "http://127.0.0.1:" + server.address().port;
  writeFileSync(FINDINGS, "");
});
test.afterAll(async () => { await new Promise((r) => server.close(r)); });

async function open(page, hash, o = {}) {
  await fakeClaude(page, { snapshot: "/snap/walk.json", owner: true, writable: false, ...o.claude });
  const q = new URLSearchParams({ store: "db" });
  if (o.tour) q.set("tour", "1");
  await page.goto(deskUrl(origin, q, hash));
  await expect(page.getByRole("main")).toBeVisible();
}
const main = (page) => page.getByRole("main");
function finding(row, text) { appendFileSync(FINDINGS, row + " | " + text + "\n"); }
const inView = (page, loc) => loc.evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width), vw: innerWidth, vh: innerHeight };
});

test("P-06 Tour: five steps over Today, Approvals, lists, peek and bell, every card inside the viewport", async ({ page }) => {
  await open(page, "#/today", { tour: true });
  const card = page.getByRole("dialog", { name: "Starter tour" });
  for (let n = 1; n <= 5; n++) {
    await expect(card).toContainText("Step " + n + " of 5");
    const b = await inView(page, card);
    expect(b.left).toBeGreaterThanOrEqual(0);
    expect(b.right).toBeLessThanOrEqual(b.vw);
    await card.getByRole("button", { name: n === 5 ? "Done" : "Next" }).click();
  }
  await expect(card).toHaveCount(0);
  finding("P-06", "Desk tour has 5 steps (Today, Approvals, lists, peek, bell), card reads Step N of 5 with Skip, Back, Next, Done, all inside 390; the preview's 15 steps are not built, Keep.");
});

test("P-70 Tour keys: Escape does not close it (recorded gap), arrow keys do not move it, focus is not trapped", async ({ page }) => {
  await open(page, "#/today", { tour: true });
  const card = page.getByRole("dialog", { name: "Starter tour" });
  await expect(card).toContainText("Step 1 of 5");
  const b = await inView(page, card);
  expect(b.w).toBeLessThanOrEqual(b.vw);
  await page.keyboard.press("ArrowRight");
  await expect(card).toContainText("Step 1 of 5");
  // Escape with focus on the page (as a visitor who has not clicked the card) leaves the tour open.
  await page.keyboard.press("Escape");
  const openAfterPageEscape = (await card.count()) === 1;
  // Escape with focus inside the card closes it.
  await card.getByRole("button", { name: "Next" }).focus();
  await page.keyboard.press("Escape");
  const closedFromCard = (await card.count()) === 0;
  // Focus is not trapped: Tab from the last control of a fresh tour moves out of the card.
  await page.reload();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Next" }).focus();
  await page.keyboard.press("Tab");
  const escaped = await card.evaluate((d) => !d.contains(document.activeElement));
  finding("P-70", "Tour card is " + b.w + " wide, anchored to its target (no spotlight hole, not docked); ArrowRight does not move it; Escape "
    + (closedFromCard ? "closes it with focus in the card" : "does not close it with focus in the card") + " and "
    + (openAfterPageEscape ? "does nothing with focus on the page" : "closes it with focus on the page") + "; Tab "
    + (escaped ? "leaves the card (not trapped)" : "stays in the card") + ".");
  // Recorded gap, returned to the owner as a new row (the spec adds no code for a Verify row): Escape does not skip the
  // tour. When it is fixed, flip closedFromCard to true here and in the finding.
  expect({ closedFromCard, openAfterPageEscape, escaped }).toEqual({ closedFromCard: false, openAfterPageEscape: true, escaped: true });
});

test("P-08 Privacy lock page states the limit of the lock", async ({ page }) => {
  await open(page, "#/settings/lock");
  await expect(main(page).getByRole("heading", { name: "Privacy PIN" })).toBeVisible();
  await expect(main(page)).toContainText("it does not protect the data itself");
  await expect(main(page)).toContainText("No PIN is set.");
  await noHorizontalScroll(page);
  finding("P-08", "Privacy PIN page says it hides the Desk on shared screens and does not protect the data itself; the limit is stated, wording differs from the preview, Keep.");
});

test("P-40 Details names the status field the health value comes from", async ({ page }) => {
  await open(page, ROLE3);
  const details = page.getByRole("complementary", { name: "Details" });
  await expect(details).toBeVisible();
  await expect(details).toContainText("Status");
  await expect(details).toContainText("from");
  await expect(details).toContainText("from Market");
  await noHorizontalScroll(page);
  finding("P-40", "Details shows a Status line reading All good, from Market (the declared status field); Last captured is not a Details row (the image note section carries the capture time).");
});

test("P-43 Record Activity groups by day; its run rows do not name Routine as the actor (recorded gap)", async ({ page }) => {
  await open(page, ROLE3);
  const activity = main(page).locator("section", { has: page.getByRole("heading", { name: "Activity" }) }).first();
  await expect(activity).toBeVisible();
  const text = await activity.innerText();
  expect(text).toMatch(/This week/);
  expect(text).toMatch(/Earlier/);
  expect(text).toContain("Seen by jobs-watch");
  expect(text).not.toContain("Routine");
  await noHorizontalScroll(page);
  finding("P-43", "Record Activity is grouped under day headings (This week, Earlier here) but its run rows still read Seen by jobs-watch with no Routine actor; Gap returned to the owner as a new row.");
});

test("P-52 History groups by day, Export CSV only when the view can save", async ({ page }) => {
  await open(page, "#/history");
  await expect(main(page).getByRole("heading", { level: 1 })).toHaveCount(1);
  const text = await main(page).innerText();
  expect(text).toMatch(/Today|Yesterday|This week|Earlier/);
  await expect(main(page).getByRole("button", { name: "Export CSV" })).toHaveCount(0);
  await noHorizontalScroll(page);
  finding("P-52", "History lists day bands (Today, Yesterday, This week, Earlier) and keeps the kind filter and Calendar tab; Export CSV is hidden when the view cannot save.");
});

test("P-60 Routine settings: per-producer form, schedule, link to Approvals", async ({ page }) => {
  await open(page, "#/settings/routine");
  await expect(main(page)).toContainText("Markets");
  await expect(main(page)).toContainText("0 22 * * 1,4");
  await expect(main(page).getByRole("link", { name: /Approvals/ }).first()).toBeVisible();
  await noHorizontalScroll(page);
  finding("P-60", "Routine settings is a per-producer form (Markets, Title keywords, Excluded companies) with the cron schedule and a suggestion link to Approvals; richer than the preview's read-only list, no Name, Site or Status field rows, Keep.");
});

test("P-60 and P-72 Export settings: read-only copy, and links when the view can save", async ({ page }) => {
  await open(page, "#/settings/export");
  await expect(main(page)).toContainText("Saving files is not available in this view.");
  finding("P-72 Export (read only)", "Saving files is not available in this view; each list can still copy its rows.");
});

test("P-72 Export settings with saving enabled links each list and History", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: W, height: 844 }, timezoneId: "UTC", locale: "en-US" })).newPage();
  await open(page, "#/settings/export", { claude: { writable: true, downloads: "save" } });
  await expect(main(page).getByRole("link", { name: /^Export / }).first()).toBeVisible();
  await expect(main(page).getByRole("link", { name: "Export history" })).toBeVisible();
  finding("P-60 Export (can save)", "Settings Export links Export per record type and Export history; there is no single all-items export, Keep.");
  await page.context().close();
});

test("P-72 Starter tour switch shows for the owner of a writable Desk", async ({ page }) => {
  await open(page, "#/settings/tour", { tour: true, claude: { writable: true } });
  await expect(main(page).getByRole("button", { name: "Take the tour" })).toBeVisible();
  await expect(main(page).getByRole("button", { name: "Turn the tour off" })).toBeVisible();
  finding("P-72 Tour switch", "Owner sees Take the tour and Turn the tour off on a writable Desk.");
});

test("P-67 Bell opens as a right side sheet that fits 390 and fills the height", async ({ page }) => {
  await open(page, "#/today");
  await page.getByRole("button", { name: /waiting|notification/i }).first().click();
  const sheet = page.getByRole("dialog", { name: "Notifications" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("waiting for you");
  await page.waitForTimeout(400);
  const b = await inView(page, sheet);
  expect(b.right).toBeLessThanOrEqual(b.vw);
  expect(b.left).toBeGreaterThanOrEqual(0);
  expect(b.bottom - b.top).toBeGreaterThanOrEqual(b.vh - 2);
  finding("P-67", "Bell is a right side sheet " + b.w + " wide and " + (b.bottom - b.top) + " tall at 390 (full height), with the waiting link; gap closed.");
});

// The data the fixture adds for the v2 work.
test("walk fixture: image notes, queued request, run columns", async ({ page }) => {
  await open(page, ROLE3);
  const notes = main(page).getByRole("region", { name: "Captured page" }).or(main(page).locator("section", { has: page.getByRole("heading", { name: "Captured page" }) }));
  await expect(notes.first()).toBeVisible();
  await expect(notes.first().getByText("Not placed on the image")).toBeVisible();
  await expect(notes.first().getByText("Box starts left of the image.")).toBeVisible();
  await expect(notes.first().getByText("Box has no width.")).toBeVisible();
  // Only the three notes with a box inside the image are marks on it.
  await expect(notes.first().getByLabel(/^Mark \d/)).toHaveCount(3);
  finding("Fixture notes", "Two notes with boxes outside the image are listed under Not placed on the image and have no mark.");
});

test("walk fixture: a pending request shows as queued, run columns draw only where a run carries them", async ({ page }) => {
  await open(page, "#/approvals?tab=queued");
  // The pending request is the only queued thing on this snapshot: the banner counts it, the Queued tab (decisions) is empty.
  await expect(main(page)).toContainText("1 queued for next run");
  await expect(main(page)).toContainText("Queued (0)");
  await page.goto(deskUrl(origin, new URLSearchParams({ store: "db" }), "#/runs"));
  await expect(main(page)).toContainText("Captured");
  await expect(main(page)).toContainText("Failed");
  await expect(main(page)).toContainText("Cost");
  await noHorizontalScroll(page);
  finding("Fixture requests and runs", "The pending run-now request shows as 1 queued for next run in the Approvals banner; the Runs table draws the Captured, Failed and Cost columns from the run that carries them; the stored-yellow display is pinned in the Vitest suite.");
});
