// The weekly marketing report Overview, a spec page (desk.pages) drawn by the Desk over the demo snapshot
// (templates/weekly-marketing-report/demo/pages-demo.json, served as /snap/weekly.json). Charts, Refresh, the source
// filter, show-as-table, phone stacking, light and dark, no console error and no request off the local server.
// Run with: DESK_SPECS=specpages.spec.mjs bash tests/visual/run.sh. DESK_SHOTS moves the screenshots.
import { test as base, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { start, deskUrl } from "./serve.mjs";
import { noHorizontalScroll } from "./layout.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = process.env.DESK_SHOTS || join(HERE, "out", "shots");
mkdirSync(SHOTS, { recursive: true });

const SIZES = [{ width: 1280, height: 900 }, { width: 390, height: 844 }];
const THEMES = ["light", "dark"];
// A Wednesday after the last demo week; the routine runs Sundays at 21:00 UTC.
const NOW = new Date("2026-11-11T10:00:00Z");
const SNAP = "/snap/weekly.json";

let server;
let origin;
let snapshotReads = 0;

const test = base.extend({
  guard: [async ({ page }, use) => {
    const problems = [];
    snapshotReads = 0;
    page.on("console", (m) => { if (m.type() === "error") problems.push("console: " + m.text()); });
    page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
    page.on("dialog", (d) => { problems.push("dialog: " + d.message()); d.dismiss(); });
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.protocol === "data:" || u.protocol === "blob:") return;
      if (u.origin !== origin) problems.push("request: " + r.url());
      else if (u.pathname === SNAP) snapshotReads++;
    });
    await use();
    expect(problems).toEqual([]);
  }, { auto: true }],
});

test.use({ timezoneId: "UTC", locale: "en-US" });
test.beforeAll(async () => {
  server = await start();
  origin = "http://127.0.0.1:" + server.address().port;
});
test.afterAll(async () => { await new Promise((r) => server.close(r)); });

const url = () => deskUrl(origin, new URLSearchParams({ store: "static", snapshot: SNAP, workspace: "Weekly marketing report" }), "#/p/overview");
const main = (page) => page.getByRole("main");
const figure = (page, name) => page.getByRole("figure", { name, exact: true });
const block = (page, id) => page.locator(`[data-block="${id}"]`);

async function open(page) {
  await page.goto(url());
  await expect(main(page).getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await expect(block(page, "sessions")).toContainText("Sessions");
  await expect(page.locator("[aria-busy=true]")).toHaveCount(0);
}

// The tile's big number as an integer.
async function tileNumber(page, id) {
  const text = await block(page, id).innerText();
  return Number(text.match(/\$?([\d,]+)/)[1].replace(/,/g, ""));
}

for (const size of SIZES) {
  for (const theme of THEMES) {
    test.describe(`${size.width}px ${theme}`, () => {
      test.use({ viewport: size, colorScheme: theme });

      test("the Overview draws six tiles, charts and the table", async ({ page }) => {
        await open(page);
        for (const id of ["sessions", "conversions", "revenue"]) {
          await expect(block(page, id)).toBeVisible();
          expect(await tileNumber(page, id)).toBeGreaterThan(0);
          await expect(block(page, id)).toContainText(/up|down|no change/);
        }
        await expect(block(page, "revenue")).toContainText("$");
        for (const id of ["clicks", "impressions", "position"]) {
          await expect(block(page, id)).toBeVisible();
          expect(await tileNumber(page, id)).toBeGreaterThan(0);
        }
        for (const name of ["Sessions by source", "Search clicks by source", "Search impressions by source", "Conversions by source"]) {
          const fig = figure(page, name);
          await expect(fig).toBeVisible();
          // The chart is drawn: recharts writes an svg with marks into the figure.
          await expect(fig.locator("svg").first()).toBeVisible();
          // Search has one source, so its line is one path; the others have three sources.
          expect(await fig.locator("svg path, svg rect").count()).toBeGreaterThan(name.startsWith("Search") ? 1 : 3);
        }
        await expect(main(page).getByRole("table").first()).toBeVisible();
        await expect(main(page)).toContainText("https://shop.example/pricing");
        await expect(main(page)).toContainText("About this page");
        await expect(main(page)).toContainText(/Updated/);
        await noHorizontalScroll(page);
        await page.screenshot({ path: join(SHOTS, `overview-${size.width}-${theme}.png`), fullPage: true });
      });
    });
  }
}

test.describe("1280px behaviour", () => {
  test.use({ viewport: SIZES[0], colorScheme: "light" });

  test("Refresh reads the snapshot again and Updated says just now", async ({ page }) => {
    await page.clock.install({ time: NOW });
    await open(page);
    await expect(main(page).getByText(/^Updated /)).toHaveText("Updated just now");
    const reads = snapshotReads;
    expect(reads).toBeGreaterThan(0);
    await page.clock.setFixedTime(new Date(NOW.getTime() + 2 * 3600 * 1000));
    await main(page).getByRole("button", { name: "Refresh" }).click();
    await expect.poll(() => snapshotReads).toBeGreaterThan(reads);
    // "Updated" is relative to the viewer's clock, so a fresh read at the later time reads "just now" again.
    await expect(main(page).getByText(/^Updated /)).toHaveText("Updated just now");
  });

  test("the source filter changes the tile number and shows in the address", async ({ page }) => {
    await open(page);
    const all = await tileNumber(page, "sessions");
    await main(page).getByLabel("Source", { exact: true }).selectOption("search-ads");
    await expect.poll(() => tileNumber(page, "sessions")).toBeLessThan(all);
    expect(page.url()).toContain("filter=search-ads");
  });

  test("Show as table swaps the chart for its numbers, by keyboard", async ({ page }) => {
    await open(page);
    const fig = figure(page, "Sessions by source");
    const toggle = fig.getByRole("switch", { name: "Show as table" });
    await toggle.focus();
    await page.keyboard.press("Space");
    await expect(fig.getByRole("table")).toBeVisible();
    await expect(fig.locator("svg.recharts-surface")).toHaveCount(0);
    expect(await fig.getByRole("row").count()).toBeGreaterThan(5);
    await page.keyboard.press("Space");
    await expect(fig.getByRole("table")).toHaveCount(0);
  });

  test("the page refreshes once on its own after the next scheduled run", async ({ page }) => {
    // Thursday 20:59 UTC; the cron is 0 21 * * 4, so a run is due in one minute plus the grace period.
    await page.clock.install({ time: new Date("2026-11-12T20:59:00Z") });
    await open(page);
    const reads = snapshotReads;
    await page.clock.fastForward(5 * 60 * 1000);
    await expect.poll(() => snapshotReads).toBeGreaterThan(reads);
  });
});

test.describe("390px behaviour", () => {
  test.use({ viewport: SIZES[1], colorScheme: "light" });

  test("the blocks stack in one column", async ({ page }) => {
    await open(page);
    const boxes = [];
    for (const id of ["sessions", "conversions", "revenue"]) boxes.push(await block(page, id).boundingBox());
    expect(new Set(boxes.map((b) => Math.round(b.x))).size).toBe(1);
    expect(boxes[0].y + boxes[0].height).toBeLessThanOrEqual(boxes[1].y + 1);
    expect(boxes[1].y + boxes[1].height).toBeLessThanOrEqual(boxes[2].y + 1);
    const line = await figure(page, "Sessions by source").boundingBox();
    const share = await figure(page, "Search clicks by source").boundingBox();
    expect(Math.round(line.x)).toBe(Math.round(share.x));
    expect(line.y + line.height).toBeLessThanOrEqual(share.y + 1);
    expect(line.width).toBeGreaterThan(300);
  });
});

test.describe("1280px layout", () => {
  test.use({ viewport: SIZES[0], colorScheme: "light" });

  test("three tiles sit side by side and the sessions line chart sits beside the search clicks chart", async ({ page }) => {
    await open(page);
    const tiles = [];
    for (const id of ["sessions", "conversions", "revenue"]) tiles.push(await block(page, id).boundingBox());
    expect(new Set(tiles.map((b) => Math.round(b.y))).size).toBe(1);
    const line = await figure(page, "Sessions by source").boundingBox();
    const share = await figure(page, "Search clicks by source").boundingBox();
    expect(Math.abs(line.y - share.y)).toBeLessThan(40);
  });
});
