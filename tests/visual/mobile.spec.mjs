// Phone and narrow-screen behaviour: 16px fields,
// sidebar parents that navigate, Today's read error, a header that fits at 320 and 200% text, record and badge reflow,
// 44px touch targets, an on-screen tour and readable dimmed and link text. Run with: bash tests/visual/run.sh.
import { test as base, expect } from "@playwright/test";
import { start, deskUrl } from "./serve.mjs";
import { fakeClaude } from "./fake-claude.mjs";

const NOW = new Date("2026-10-28T00:00:00Z");
const ROLE3 = "#/entity/role/https-jobs-example-au-00003";
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, colorScheme: "light" };
let server;
let origin;

// As in desk.spec.mjs: a console error, page error, dialog or request off the local server fails the test.
const test = base.extend({
  guard: [async ({ page }, use) => {
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

test.use({ timezoneId: "UTC", locale: "en-US" });
test.beforeAll(async () => { server = await start(); origin = "http://127.0.0.1:" + server.address().port; });
test.afterAll(async () => { await new Promise((r) => server.close(r)); });

// o: hash, owner, writable, failCollections, query (extra params); the v2 fixture on the stand-in runtime.
async function open(page, o) {
  await page.clock.setFixedTime(NOW);
  await fakeClaude(page, { viewer: "u_owner", owner: o.owner !== false, writable: !!o.writable, failCollections: o.failCollections });
  const q = new URLSearchParams({ store: "db" });
  for (const [k, v] of Object.entries(o.query || {})) q.set(k, v);
  await page.goto(deskUrl(origin, q, o.hash));
  await expect(page.getByRole("main")).toBeVisible();
}

// Font sizes of the visible text fields.
const fieldSizes = (page) => page.evaluate(() => [...document.querySelectorAll("input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select, textarea")]
  .filter((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
  .map((n) => ({ label: n.getAttribute("aria-label") || n.placeholder || n.name || n.id, size: parseFloat(getComputedStyle(n).fontSize) })));

async function expectFields16(page, where) {
  await page.waitForTimeout(100);
  const sizes = await fieldSizes(page);
  expect(sizes.length, where + " has fields").toBeGreaterThan(0);
  expect(sizes.filter((s) => s.size < 16), where).toEqual([]);
}

test.describe("fields on a phone", () => {
  test.use(PHONE);
  test("every text field is at least 16px so iOS does not zoom on focus", async ({ page }) => {
    await open(page, { hash: "#/browse/role", writable: true });
    await expect(page.getByRole("checkbox").nth(1)).toBeVisible();
    await expectFields16(page, "browse");
    await page.getByRole("checkbox").nth(1).check();
    await expect(page.getByLabel("Tag name")).toBeVisible();
    await expectFields16(page, "bulk bar");
    await page.getByRole("checkbox").nth(1).uncheck();
    await page.getByRole("button", { name: "Filters" }).click();
    await expect(page.getByRole("dialog", { name: "Filters" })).toBeVisible();
    await expectFields16(page, "filters");
    for (const hash of [ROLE3, "#/approvals", "#/settings/routine"]) {
      await page.goto(deskUrl(origin, new URLSearchParams({ store: "db" }), hash));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.waitForLoadState("networkidle");
      const sizes = await fieldSizes(page);
      expect(sizes.filter((s) => s.size < 16), hash).toEqual([]);
    }
    const meta = await page.evaluate(() => document.querySelector("meta[name=viewport]").content);
    expect(meta).not.toMatch(/maximum-scale|user-scalable\s*=\s*no/);
  });
});

test.describe("fields on a desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  test("a mouse keeps Mantine's 14px fields", async ({ page }) => {
    await open(page, { hash: "#/browse/role" });
    const search = page.getByRole("textbox").first();
    await expect(search).toBeVisible();
    expect(await search.evaluate((n) => getComputedStyle(n).fontSize)).toBe("14px");
  });
});

test.describe("sidebar on a phone", () => {
  test.use(PHONE);
  test("tapping a parent goes to its list and closes the drawer; the chevron keeps it open", async ({ page }) => {
    await open(page, { hash: "#/today" });
    const nav = page.getByRole("navigation", { name: "Desk" });
    await page.getByRole("button", { name: "Toggle navigation" }).tap();
    await expect(nav).toBeInViewport();
    await nav.getByRole("link", { name: "Roles", exact: true }).tap();
    await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/browse/role");
    await expect(nav).not.toBeInViewport();
    await page.getByRole("button", { name: "Toggle navigation" }).tap();
    await expect(nav).toBeInViewport();
    await nav.getByRole("button", { name: /Roles views/ }).tap();
    await page.waitForTimeout(300);
    await expect(nav).toBeInViewport();
    expect(await page.evaluate(() => location.hash)).toBe("#/browse/role");
  });
});

test.describe("Today on a phone", () => {
  test.use(PHONE);
  test("a failed records read shows the error and Try again, not All good", async ({ page }) => {
    await open(page, { hash: "#/today", failCollections: /^entities$/ });
    const alert = page.getByRole("alert").filter({ hasText: "Could not read" });
    await expect(alert).toBeVisible();
    await expect(alert.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(page.getByText("All good", { exact: true })).toHaveCount(0);
  });
});

// Every header control inside the viewport, no sideways scroll, the bell in place, search reachable from the menu.
async function headerFits(page) {
  await expect(page.locator("[data-tour=bell]")).toBeVisible();
  const r = await page.evaluate(() => ({
    w: innerWidth,
    scroll: document.documentElement.scrollWidth,
    boxes: [...document.querySelectorAll("header button, header a")].map((n) => { const b = n.getBoundingClientRect(); return { name: n.getAttribute("aria-label") || n.textContent, left: b.left, right: b.right, width: b.width }; }).filter((b) => b.width > 0),
  }));
  expect(r.scroll).toBeLessThanOrEqual(r.w);
  expect(r.boxes.filter((b) => b.left < 0 || b.right > r.w + 0.5)).toEqual([]);
  await page.getByRole("button", { name: "Search and settings" }).tap();
  await page.getByRole("menuitem", { name: "Search or jump to" }).tap();
  await expect(page.getByPlaceholder("Search or jump to")).toBeVisible();
}

for (const [label, size, zoom] of [["320 wide", { width: 320, height: 640 }, null], ["195 wide", { width: 195, height: 422 }, null], ["390 wide at 200% text", { width: 390, height: 844 }, "200%"]]) {
  test.describe("header at " + label, () => {
    test.use(Object.assign({}, PHONE, { viewport: size }));
    test("every header control is on screen and search stays reachable", async ({ page }) => {
      if (zoom) await page.addInitScript((z) => { document.addEventListener("DOMContentLoaded", () => { document.documentElement.style.fontSize = z; }); }, zoom);
      await open(page, { hash: "#/today" });
      await headerFits(page);
    });
  });
}

for (const width of [375, 320]) {
  test.describe("record page at " + width, () => {
    test.use(Object.assign({}, PHONE, { viewport: { width: width, height: 800 } }));
    test("the record page does not scroll sideways and More actions is on screen", async ({ page }) => {
      await open(page, { hash: ROLE3, writable: true });
      const more = page.getByRole("button", { name: "More actions" });
      await expect(more).toBeVisible();
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over).toBeLessThanOrEqual(0);
      const box = await more.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    });
  });
}

// Controls smaller than 44x44 on screen: buttons, nav links, segmented items and the cell around each row checkbox.
// Inline text links are exempt (WCAG 2.5.8 inline exception).
const smallTargets = (page) => page.evaluate(() => {
  const els = new Set();
  document.querySelectorAll("button, [role=button], nav[aria-label=Desk] a").forEach((n) => els.add(n));
  document.querySelectorAll("input[type=checkbox]").forEach((n) => els.add(n.closest("td, th") || n));
  document.querySelectorAll("[class*=SegmentedControl-label]").forEach((n) => els.add(n));
  return [...els].map((n) => { const b = n.getBoundingClientRect(); return { name: (n.getAttribute("aria-label") || n.textContent || n.tagName).trim().slice(0, 40), w: Math.round(b.width), h: Math.round(b.height), x: b.x, y: b.y }; })
    .filter((b) => b.w > 0 && b.h > 0 && b.x < innerWidth && b.y < innerHeight * 3 && b.x + b.w > 0)
    .filter((b) => b.w < 43.5 || b.h < 43.5);
});

test.describe("touch targets on a phone", () => {
  test.use(PHONE);
  test("buttons, nav links and row checkboxes are at least 44px on Today, Browse and the navbar", async ({ page }) => {
    await open(page, { hash: "#/today", writable: true });
    await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(await smallTargets(page), "today").toEqual([]);
    await page.goto(deskUrl(origin, new URLSearchParams({ store: "db" }), "#/browse/role"));
    await expect(page.getByRole("checkbox").nth(1)).toBeVisible();
    expect(await smallTargets(page), "browse").toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), "browse scroll").toBeLessThanOrEqual(0);
    await page.getByRole("button", { name: "Toggle navigation" }).tap();
    await expect(page.getByRole("navigation", { name: "Desk" })).toBeInViewport();
    await page.waitForTimeout(300);
    expect(await smallTargets(page), "navbar").toEqual([]);
  });
});

test.describe("Approvals on a phone", () => {
  test.use(PHONE);
  test("every card's kind badge shows in full", async ({ page }) => {
    await open(page, { hash: "#/approvals" });
    await expect(page.locator("[data-id]").first()).toBeVisible();
    const cut = await page.evaluate(() => [...document.querySelectorAll("[data-id] [class*=Badge-label]")]
      .filter((n) => n.scrollWidth > n.clientWidth).map((n) => n.textContent));
    expect(cut).toEqual([]);
  });
});

test.describe("tour on a phone", () => {
  test.use(PHONE);
  test("every step's popover stays inside the screen", async ({ page }) => {
    await open(page, { hash: "#/today", query: { tour: "1" } });
    const tour = page.getByRole("dialog", { name: "Starter tour" });
    for (let i = 1; i <= 5; i++) {
      await expect(tour).toContainText("Step " + i + " of 5");
      await page.waitForTimeout(250);
      const box = await tour.boundingBox();
      expect(box, "step " + i).not.toBeNull();
      expect(box.x, "step " + i + " left").toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, "step " + i + " right").toBeLessThanOrEqual(390);
      await tour.getByRole("button", { name: i === 5 ? "Done" : "Next" }).click();
    }
    await expect(tour).toBeHidden();
  });
});

const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const colorOf = (loc) => loc.evaluate((n) => getComputedStyle(n).color);
const bodyBg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

for (const scheme of ["light", "dark"]) {
  test.describe("contrast in " + scheme, () => {
    test.use({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
    test("dimmed text and links reach 4.5:1 on the page background", async ({ page }) => {
      await open(page, { hash: "#/today" });
      const date = page.getByRole("main").locator("p").filter({ hasText: /^Wednesday, October 28$/ });
      await expect(date).toBeVisible();
      const bg = await bodyBg(page);
      expect(contrast(await colorOf(date), bg), "Today date line on " + bg).toBeGreaterThanOrEqual(4.5);
      await page.goto(page.url().replace(/#.*$/, "#/browse/role"));
      const link = page.getByRole("main").locator('a[href^="#/entity/"]').first();
      await expect(link).toBeVisible();
      expect(contrast(await colorOf(link), await bodyBg(page)), "Browse link").toBeGreaterThanOrEqual(4.5);
    });
  });
}
