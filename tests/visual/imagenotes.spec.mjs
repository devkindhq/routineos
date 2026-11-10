// Image notes viewer: zoom buttons, keyboard, two-way mark and card linking, in real Chromium at a wide and a narrow
// width, on the walk fixture's captured page (5 notes). Assertions only, no screenshot compare, no golden. Run: bash tests/visual/run.sh.
import { test, expect } from "@playwright/test";
import { start } from "./serve.mjs";

let server;
let origin;
test.beforeAll(async () => { server = await start(); origin = "http://127.0.0.1:" + server.address().port; });
test.afterAll(async () => { await new Promise((r) => server.close(r)); });

const url = () => origin + "/desk.html?store=static&snapshot=/snap/walk.json#/entity/role/https-jobs-example-au-00003";
const readout = (page) => page.getByText(/^Zoom \d+%$/);
const pct = async (page) => Number((await readout(page).textContent()).replace(/\D/g, ""));

for (const [name, size] of [["wide", { width: 1480, height: 900 }], ["narrow", { width: 500, height: 900 }]]) {
  test.describe(name, () => {
    test.use({ viewport: size, timezoneId: "UTC", locale: "en-US" });

    test("toolbar zooms and fits, keys work only on the window", async ({ page }) => {
      await page.goto(url());
      await expect(page.getByRole("toolbar", { name: "Zoom the captured page" })).toBeVisible();
      const fit = await pct(page);
      await page.getByRole("button", { name: "Zoom in" }).click();
      await expect.poll(() => pct(page)).toBeGreaterThan(fit);
      await page.getByRole("button", { name: "Zoom to 100%" }).click();
      await expect.poll(() => pct(page)).toBe(100);
      await page.getByRole("button", { name: "Fit width" }).click();
      await expect.poll(() => pct(page)).toBe(fit);
      await page.getByRole("group", { name: /^Captured page/ }).focus();
      await page.keyboard.press("1");
      await expect.poll(() => pct(page)).toBe(100);
      await page.keyboard.press("0");
      await expect.poll(() => pct(page)).toBe(fit);
    });

    test("a mark and its card select each other", async ({ page }) => {
      await page.goto(url());
      const marks = page.locator("[data-mark]");
      await expect(marks.first()).toBeVisible();
      expect(await marks.count()).toBeGreaterThan(0);
      await marks.first().click();
      await expect(marks.first()).toHaveAttribute("aria-pressed", "true");
      const card = page.getByRole("listitem", { name: /^Note 1:/ });
      await expect(card).toBeVisible();
      const last = marks.last();
      const idx = Number(await last.getAttribute("data-mark"));
      await page.getByRole("listitem", { name: new RegExp("^Note " + (idx + 1) + ":") }).click();
      await expect(last).toHaveAttribute("aria-pressed", "true");
    });

    test("an active mark is a light tint, so the page text under it stays readable", async ({ page }) => {
      await page.goto(url());
      const mark = page.locator("[data-mark]").first();
      await expect(mark).toBeVisible();
      await mark.click();
      await expect(mark).toHaveAttribute("aria-pressed", "true");
      const bg = await mark.evaluate((el) => getComputedStyle(el).backgroundColor);
      const slash = /\/\s*([\d.]+)\s*\)$/.exec(bg), rgba = /^rgba\([^)]*,\s*([\d.]+)\)$/.exec(bg);
      const alpha = slash ? Number(slash[1]) : rgba ? Number(rgba[1]) : 1;
      expect(alpha, "active fill " + bg).toBeGreaterThan(0);
      expect(alpha, "active fill " + bg).toBeLessThanOrEqual(0.15);
    });

    test("no horizontal page scroll", async ({ page }) => {
      await page.goto(url());
      await expect(page.getByRole("toolbar", { name: "Zoom the captured page" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  });
}
