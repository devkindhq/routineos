// Image notes on a real, long capture (about 50 notes). The snapshot is local data and never lives in this repo: set
// DESK_REAL_SNAPSHOT to a snapshot file and DESK_REAL_HASH to the entity route (for example #/entity/page/some-id).
// Without them every test here is skipped, and the run reports the skips. Run: bash tests/visual/run.sh with
// DESK_SPECS="imagenotes-real.spec.mjs". DESK_SHOTS=<dir> also writes screenshots there (names fix-NN-*.png).
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { start } from "./serve.mjs";

const SNAP = process.env.DESK_REAL_SNAPSHOT, HASH = process.env.DESK_REAL_HASH, SHOTS = process.env.DESK_SHOTS;
let server, origin;
test.beforeAll(async () => { server = await start(); origin = "http://127.0.0.1:" + server.address().port; });
test.afterAll(async () => { await new Promise((r) => server.close(r)); });
test.skip(!SNAP || !HASH, "DESK_REAL_SNAPSHOT and DESK_REAL_HASH are not set");

async function open(page, scheme) {
  const body = readFileSync(SNAP);
  await page.route("**/snap/real.json", (r) => r.fulfill({ contentType: "application/json", body }));
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto(origin + "/desk.html?store=static&snapshot=/snap/real.json&workspace=Real" + HASH);
  await expect(page.getByRole("toolbar", { name: "Zoom the captured page" })).toBeVisible({ timeout: 30000 });
  await expect(page.locator("[data-mark]").first()).toBeVisible();
}
const shot = (page, name) => SHOTS ? page.screenshot({ path: SHOTS + "/" + name }) : null;

test.describe("real capture, 1480px", () => {
  test.use({ viewport: { width: 1480, height: 900 }, timezoneId: "UTC", locale: "en-US" });

  test("every two-digit tag shows all its digits, at fit and zoomed", async ({ page }) => {
    await open(page, "light");
    const n = await page.locator("[data-mark]").count();
    expect(n).toBeGreaterThanOrEqual(40);
    const clipped = () => page.evaluate(() => [...document.querySelectorAll("[data-mark]")].map((m) => {
      const t = m.querySelector('[aria-hidden="true"]');
      const lab = t && t.querySelector(".mantine-Badge-label");
      return { n: m.getAttribute("data-mark"), text: t && t.textContent, bad: !t || t.scrollWidth > t.clientWidth + 0.5 || (lab && lab.scrollWidth > lab.clientWidth + 0.5) };
    }).filter((x) => x.bad));
    expect(await clipped()).toEqual([]);
    await shot(page, "fix-02-tags-fit.png");
    await page.getByRole("button", { name: "Zoom to 100%" }).click();
    await expect(page.getByText("Zoom 100%")).toBeVisible();
    await page.locator('[data-mark="30"]').scrollIntoViewIfNeeded();
    expect(await clipped()).toEqual([]);
    for (const i of [9, 30, 31, 32, 49]) {
      const t = await page.locator('[data-mark="' + i + '"] [aria-hidden="true"]').textContent();
      expect(t).toBe(String(i + 1));
    }
    await shot(page, "fix-02-tags-zoomed.png");
  });

  for (const scheme of ["light", "dark"]) {
    test("an active box keeps the page text beneath it readable (" + scheme + ")", async ({ page }) => {
      await open(page, scheme);
      const mark = page.locator('[data-mark="49"]');
      await mark.click();
      await expect(mark).toHaveAttribute("aria-pressed", "true");
      const bg = await mark.evaluate((el) => getComputedStyle(el).backgroundColor);
      const m = /^(?:rgba?|color)\(([^)]+)\)$/.exec(bg);
      expect(m, "computed fill " + bg).toBeTruthy();
      const slash = m[1].split("/");
      const parts = m[1].split(/[ ,]+/).filter(Boolean);
      const alpha = slash.length > 1 ? Number(slash[1]) : (/^rgba/.test(bg) && parts.length > 3 ? Number(parts[3]) : 1);
      expect(alpha, "active fill " + bg).toBeLessThanOrEqual(0.15);
      await mark.scrollIntoViewIfNeeded();
      await shot(page, "fix-01-active-" + scheme + ".png");
    });
  }
});

test.describe("real capture, linking and keyboard", () => {
  test.use({ viewport: { width: 1480, height: 900 }, timezoneId: "UTC", locale: "en-US" });

  test("a mark click pins and reveals its card inside the strip", async ({ page }) => {
    await open(page, "light");
    const mark = page.locator('[data-mark="45"]');
    await mark.click();
    await expect(page.getByRole("listitem", { name: /^Note 46:/ })).toHaveAttribute("aria-current", "true");
    await expect.poll(() => page.evaluate(() => {
      const c = document.getElementById("image-note-45"), v = c.closest("[data-scrollarea-viewport], .mantine-ScrollArea-viewport");
      const a = c.getBoundingClientRect(), b = v.getBoundingClientRect();
      return a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
    })).toBe(true);
    await shot(page, "fix-04-mark-to-card.png");
  });

  test("a card click recentres its mark, and a Tab-focused mark is recentred in the window", async ({ page }) => {
    await open(page, "light");
    const win = page.getByRole("group", { name: /^Captured page/ });
    const centred = (i) => page.evaluate((i) => {
      const m = document.querySelector('[data-mark="' + i + '"]').getBoundingClientRect(), w = document.querySelector('[role="group"][aria-label^="Captured page"]').getBoundingClientRect();
      const cx = m.left + m.width / 2, cy = m.top + m.height / 2;
      return cx > w.left && cx < w.right && cy > w.top && cy < w.bottom;
    }, i);
    await page.getByRole("listitem", { name: /^Note 30:/ }).click();
    await expect.poll(() => centred(29)).toBe(true);
    await win.focus();
    await page.keyboard.press("Tab");
    await page.locator('[data-mark="47"]').focus();
    await expect.poll(() => centred(47)).toBe(true);
    await expect(page.getByText(/^Zoom \d+%$/)).toBeVisible();
    await shot(page, "fix-04-tab-focus.png");
  });
});

test.describe("real capture, narrow", () => {
  test.use({ viewport: { width: 500, height: 900 }, timezoneId: "UTC", locale: "en-US" });

  test("stacked layout: no horizontal scroll, and a card click scrolls back to the image", async ({ page }) => {
    await open(page, "light");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await shot(page, "fix-04-narrow.png");
    const card = page.getByRole("listitem", { name: /^Note 20:/ });
    await card.scrollIntoViewIfNeeded();
    await card.click();
    await expect.poll(() => page.evaluate(() => {
      const w = document.querySelector('[role="group"][aria-label^="Captured page"]').getBoundingClientRect();
      return w.bottom > 0 && w.top < innerHeight;
    })).toBe(true);
    await shot(page, "fix-04-narrow-card-click.png");
  });
});
