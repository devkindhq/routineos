// Fix-pass behaviours from the preview-match review, kept on the Mantine Desk: phone overlays inside the viewport,
// Escape in the palette keeps the tour, the Decision control writes only on a deliberate choice, PIN labels, the
// Items read count, the boot message, a declined record export and a readable toast Undo. Selectors are roles and
// labels. Run with: bash tests/visual/run.sh.
import { test as base, expect } from "@playwright/test";
import { start, deskUrl } from "./serve.mjs";
import { fakeClaude } from "./fake-claude.mjs";

const NOW = new Date("2026-10-28T00:00:00Z");
const ROLE3 = "#/entity/role/https-jobs-example-au-00003";
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

// o: hash, snap ("v2" on the stand-in runtime, else a static snapshot), owner, writable, downloads, query (extra params).
async function open(page, o) {
  await page.clock.setFixedTime(NOW);
  const snap = o.snap || "v2";
  const q = new URLSearchParams({ store: snap === "v2" ? "db" : "static" });
  if (snap !== "v2") q.set("snapshot", "/snap/" + snap + ".json");
  for (const [k, v] of Object.entries(o.query || {})) q.set(k, v);
  if (snap === "v2") await fakeClaude(page, { viewer: "u_owner", owner: o.owner !== false, writable: !!o.writable, downloads: o.downloads });
  await page.goto(deskUrl(origin, q, o.hash));
  await expect(page.getByRole("main")).toBeVisible();
}

// Contrast ratio of two rgb() strings.
const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

for (const scheme of ["light", "dark"]) {
  test.describe("toast " + scheme, () => {
    test.use({ viewport: { width: 1280, height: 800 }, colorScheme: scheme });
    test("Undo is readable on the approval toast", async ({ page }) => {
      await open(page, { hash: "#/approvals", writable: true });
      await page.locator("[data-id]").first().getByRole("button", { name: /^Approve/ }).first().click();
      const undo = page.getByRole("alert").getByRole("button", { name: "Undo" });
      await expect(undo).toBeVisible();
      // The text colour against the first opaque background behind the button.
      const [fg, bg] = await undo.evaluate((n) => {
        let p = n;
        let c = "rgba(0, 0, 0, 0)";
        while (p && /rgba\(.*, 0\)|transparent/.test(c)) { c = getComputedStyle(p).backgroundColor; p = p.parentElement; }
        return [getComputedStyle(n).color, c];
      });
      expect(contrast(fg, bg)).toBeGreaterThan(4.5);
    });
  });
}

test.describe("phone overlays", () => {
  test.use({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
  test("the Filters panel stays inside the viewport and closes", async ({ page }) => {
    await open(page, { hash: "#/browse/role", snap: "demo" });
    await page.getByRole("button", { name: "Filters" }).click();
    const panel = page.getByRole("dialog", { name: "Filters" });
    await expect(panel).toBeVisible();
    // The drawer slides in from the right; measure once it has settled.
    const box = () => panel.evaluate((n) => { const b = n.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; });
    await expect.poll(async () => (await box()).right).toBeLessThanOrEqual(390);
    const r = await box();
    expect(r.top).toBeGreaterThanOrEqual(0);
    expect(r.bottom).toBeLessThanOrEqual(844);
    expect(r.left).toBeGreaterThanOrEqual(0);
    expect(r.right).toBeLessThanOrEqual(390);
    await page.getByRole("button", { name: "Close filters" }).click();
    await expect(panel).toHaveCount(0);
  });
});

test.describe("tour and palette", () => {
  test.use({ viewport: { width: 1280, height: 800 }, colorScheme: "light" });
  test("Escape in the palette closes the palette and keeps the tour", async ({ page }) => {
    await open(page, { hash: "#/today", query: { tour: "1" } });
    const tour = page.getByRole("dialog", { name: "Starter tour" });
    await expect(tour).toBeVisible();
    await page.keyboard.press("Control+k");
    const input = page.getByPlaceholder("Search or jump to");
    await expect(input).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(input).toHaveCount(0);
    await expect(tour).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("routineos-desk-tour-done"))).toBeNull();
  });
});

test.describe("record Decision control", () => {
  test.use({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
  test("arrow keys write nothing", async ({ page }) => {
    await open(page, { hash: ROLE3, writable: true });
    const group = page.getByRole("radiogroup", { name: "Decision" });
    await expect(group).toBeVisible();
    const pending = group.getByRole("radio", { name: "Pending" });
    await expect(pending).toBeChecked();
    await pending.focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.__deskWrites.length)).toBe(0);
    await expect(pending).toBeChecked();
    // A click is a deliberate choice and writes the decision.
    await group.getByText("Keep", { exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__deskWrites.length)).toBe(1);
    expect((await page.evaluate(() => window.__deskWrites))[0]).toMatchObject({ op: "set", data: { decision: "keep" } });
    await expect(group.getByRole("radio", { name: "Keep" })).toBeChecked();
  });
  test("a record dropped by the settings filters shows Drop as the current choice", async ({ page }) => {
    await open(page, { hash: "#/entity/role/https-jobs-example-au-00049", writable: true });
    await expect(page.getByRole("radiogroup", { name: "Decision" }).getByRole("radio", { name: "Drop" })).toBeChecked();
  });
});

test.describe("privacy PIN form", () => {
  test.use({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
  test("each PIN field is labelled once", async ({ page }) => {
    await open(page, { hash: "#/settings/lock", writable: true });
    await expect(page.getByLabel(/^New PIN/)).toHaveCount(1);
    await expect(page.getByLabel("Repeat the PIN")).toHaveCount(1);
    const texts = await page.evaluate(() => [...document.querySelectorAll("label")].map((n) => n.textContent.trim()));
    expect(texts.filter((t) => /^New PIN/.test(t)).length).toBe(1);
    expect(texts.filter((t) => t === "Repeat the PIN").length).toBe(1);
  });
});

test.describe("Items reads", () => {
  test.use({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
  test("opening Items does not read every record a second time after the count probe", async ({ page }) => {
    await open(page, { hash: "#/browse/role" });
    await expect(page.getByRole("main").locator("tbody tr").first()).toBeVisible();
    await page.waitForTimeout(500);
    const reads = await page.evaluate(() => window.__deskReads.filter((c) => c === "entities").length);
    expect(reads).toBeLessThanOrEqual(6);
  });
});

test.describe("boot", () => {
  test("a Desk whose scripts never run shows the did not load message", async ({ page }) => {
    // Drop every script so the Desk never starts; the root then keeps the template's message.
    await page.route(/\/(desk|index)\.html(\?.*)?$/, async (route) => {
      const res = await route.fetch();
      const body = (await res.text()).replace(/<script(?![^>]*application\/json)[^>]*>[\s\S]*?<\/script>/g, "");
      return route.fulfill({ response: res, body });
    });
    await page.goto(deskUrl(origin, new URLSearchParams({ store: "static", snapshot: "/snap/demo.json" }), "#/today"));
    await expect(page.locator("#root")).toHaveText(/The Desk did not load\. Reload the page to try again\./);
  });
});

test.describe("Export record", () => {
  test.use({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
  test("a declined save says Not saved and leaves the clipboard alone", async ({ page }) => {
    await page.addInitScript(() => {
      window.__clip = [];
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (t) => { window.__clip.push(t); return Promise.resolve(); } } });
    });
    await open(page, { hash: ROLE3, downloads: "decline" });
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Export record as Markdown" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Not saved." })).toBeVisible();
    expect(await page.evaluate(() => window.__deskSaves.length)).toBe(1);
    expect(await page.evaluate(() => window.__clip.length)).toBe(0);
  });
});
