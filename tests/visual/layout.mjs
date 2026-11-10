// Layout checks shared by the specs. Each waits for fonts and two animation frames, then polls until the layout
// holds, so a check under load reads the settled page, not a frame mid-reflow (reviewer HIGH-1).
import { expect } from "@playwright/test";

export const SETTLE_MS = 5000;

async function settle(page) {
  await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve())
    .then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))));
}

// The page has no horizontal scroll.
export async function noHorizontalScroll(page) {
  await settle(page);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    { message: "horizontal page scroll", timeout: SETTLE_MS }).toBeLessThanOrEqual(0);
}

// The table and every scrolling box around it fit their width.
export async function tableFits(table) {
  await expect(table).toBeVisible();
  await settle(table.page());
  await expect.poll(() => table.evaluate((t) => {
    const out = [];
    for (let el = t; el && el !== document.body; el = el.parentElement) {
      if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX)) out.push(el.scrollWidth + ">" + el.clientWidth);
    }
    return out;
  }), { message: "horizontal scroll inside the Browse table", timeout: SETTLE_MS }).toEqual([]);
}
