// Raw React pages (spec 2026-11-17-raw-react-pages-design, section 18): the sample routine in
// tests/desk_fixtures/raw-pages renders in the real build, light and dark, at 1280 and 390 wide. Pages S1 to S7 are
// built into a read-only preview by `routineos desk preview` and served here; writes go through fake-claude (store=db).
// Screenshots go to out/raw-pages/<id>-<desktop|phone>-<light|dark>.png (S2 is the page route).
// Run with: bash tests/visual/run.sh (DESK_SPECS="rawpages.spec.mjs" for this file alone).
import { test as base, expect } from "@playwright/test";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeClaude } from "./fake-claude.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const NOW = new Date("2026-11-01T00:00:00Z");
const SHOTS = join(HERE, "out", "raw-pages");
const CONFIG_RE = /(<script type="application\/json" id="desk-config">)([\s\S]*?)(<\/script>)/;

let server;
let origin;
let previewDir;

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
    await use();
    expect(problems.filter((p) => !(test.info().annotations.some((a) => a.type === "expect-errors") && /S7 test error|The above error|boundary/i.test(p)))).toEqual([]);
  }, { auto: true }],
});

test.use({ timezoneId: "UTC", locale: "en-US" });

test.beforeAll(async () => {
  previewDir = mkdtempSync(join(tmpdir(), "raw-preview-"));
  execFileSync("python3", [join(ROOT, "skills", "routineos", "scripts", "routineos.py"), "desk", "preview",
    "--routine", join(ROOT, "tests", "desk_fixtures", "raw-pages"), "--out", previewDir], { encoding: "utf8" });
  mkdirSync(SHOTS, { recursive: true });
  const html = readFileSync(join(previewDir, "index.html"), "utf8");
  server = await new Promise((resolve) => {
    const s = createServer((req, res) => {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/index.html") {
        const cfg = url.searchParams.get("store") === "db"
          ? { store: "db" } : { store: "static", snapshot: "snapshot.json" };
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html.replace(CONFIG_RE, (_m, a, _b, c) => a + JSON.stringify(cfg) + c));
        return;
      }
      if (url.pathname === "/snapshot.json" && existsSync(join(previewDir, "snapshot.json"))) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(readFileSync(join(previewDir, "snapshot.json")));
        return;
      }
      res.writeHead(404);
      res.end("not found");
    });
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
  origin = "http://127.0.0.1:" + server.address().port;
});
test.afterAll(async () => { await new Promise((r) => server.close(r)); });

const main = (page) => page.getByRole("main");
const SIZES = { desktop: { width: 1280, height: 900 }, phone: { width: 390, height: 844 } };

async function openStatic(page, hash) {
  await page.goto(origin + "/index.html" + hash);
}
async function openDb(page, hash, opts = {}) {
  await fakeClaude(page, { snapshot: "/snapshot.json", owner: true, writable: true, ...opts });
  await page.goto(origin + "/index.html?store=db" + hash);
}
async function settle(page) {
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.waitForTimeout(400);
}
async function noHScroll(page) {
  const w = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(w.s).toBeLessThanOrEqual(w.c);
}

// One entry per page: the route and the "Must show" locators (one per item of the spec table).
const PAGES = [
  { id: "s1", hash: "#/x/s1-listing", show: [
    (m) => m.getByRole("textbox", { name: "Search tasks" }),
    (m) => m.locator("table").first(),
    (m) => m.locator("thead th", { hasText: "Title" }),
    (m) => m.getByText("Draft pricing page 01").first(),
    (m) => m.getByText(/\d+ of 30 tasks/),
  ] },
  { id: "s2", hash: "#/x/s2-detail", show: [
    (m) => m.getByRole("tab", { name: "Summary" }),
    (m) => m.getByRole("tab", { name: "Activity" }),
    (m) => m.getByRole("heading", { level: 2 }),
    (m) => m.getByText(/^Owner: /),
    (m) => m.getByRole("button", { name: "All fields" }),
    (m) => m.getByRole("button", { name: "Edit" }),
  ] },
  { id: "s3", hash: "#/x/s3-dashboard", show: [
    (m) => m.getByText("Task overview"),
    (m) => m.getByText("Total amount (spec tile)"),
    (m) => m.getByText("Amount in range"),
    (m) => m.getByText("Amount by due date"),
    (m) => m.locator(".recharts-line").first(),
    (m) => m.locator(".recharts-bar-rectangle").first(),
    (m) => m.locator(".recharts-pie-sector").first(),
    (m) => m.getByRole("button", { name: /Due between/ }),
  ] },
  { id: "s4", hash: "#/x/s4-form", show: [
    (m) => m.getByRole("textbox", { name: /Title/ }),
    (m) => m.getByRole("combobox", { name: /Owner/ }),
    (m) => m.getByRole("combobox", { name: /Labels/ }),
    (m) => m.getByRole("button", { name: /Due date/ }),
    (m) => m.getByLabel("Urgent"),
    (m) => m.getByRole("button", { name: "Save task" }),
  ] },
  { id: "s5", hash: "#/x/s5-board", show: [
    (m) => m.getByRole("heading", { name: "todo" }),
    (m) => m.getByRole("heading", { name: "doing" }),
    (m) => m.getByRole("heading", { name: "done" }),
    (m) => m.getByRole("button", { name: /^Move / }).first(),
  ] },
  { id: "s6", hash: "#/x/s6-settings", show: [
    (m) => m.getByRole("button", { name: "Layout" }),
    (m) => m.getByRole("button", { name: "Lists" }),
    (m) => m.getByText("comfortable").first(),
    (m) => m.getByRole("button", { name: "Reset to defaults" }),
  ] },
  { id: "s7", hash: "#/x/s7-errors", show: [
    (m) => m.getByRole("button", { name: "Show success" }),
    (m) => m.getByRole("button", { name: "Show error" }),
    (m) => m.getByRole("button", { name: "Try a write" }),
    (m) => m.getByRole("button", { name: "Throw on next render" }),
  ] },
];

for (const size of Object.keys(SIZES)) {
  for (const scheme of ["light", "dark"]) {
    test.describe(`${size} ${scheme}`, () => {
      test.use({ viewport: SIZES[size], colorScheme: scheme });
      for (const p of PAGES) {
        test(`${p.id} renders with its must-show elements`, async ({ page }) => {
          await openStatic(page, p.hash);
          for (const loc of p.show) await expect(loc(main(page)).first()).toBeVisible();
          if (size === "phone") await noHScroll(page);
          await settle(page);
          await page.screenshot({ path: join(SHOTS, `${p.id}-${size}-${scheme}.png`), fullPage: true });
        });
      }
    });
  }
}

test.describe("interactions", () => {
  test.use({ viewport: SIZES.desktop, colorScheme: "light" });

  test("S1 shows real task data, sorts, pages, searches and a row click opens S2 for that task", async ({ page }) => {
    await openStatic(page, "#/x/s1-listing");
    const rows = main(page).locator("tbody tr");
    await expect(rows).toHaveCount(10);
    await expect(rows.first()).toContainText("Audit backup job 04");
    await main(page).locator("thead th", { hasText: "Title" }).click();
    await expect(rows.first()).not.toContainText("Audit backup job 04");
    await main(page).getByRole("button", { name: "2", exact: true }).click();
    await expect(rows).toHaveCount(10);
    await main(page).getByRole("textbox", { name: "Search tasks" }).fill("zzzz-no-match");
    await expect(main(page)).toContainText("No tasks match this search");
    await main(page).getByRole("textbox", { name: "Search tasks" }).fill("pricing page 07");
    await expect(rows).toHaveCount(1);
    await rows.first().click();
    await expect(page).toHaveURL(/#\/x\/s2-detail\/task--t07$/);
    await expect(main(page).getByRole("heading", { level: 2 })).toContainText("07");
  });

  test("S2 tabs, Timeline, Drawer and edit Modal open above the Desk", async ({ page }) => {
    await openStatic(page, "#/x/s2-detail/task--t07");
    await expect(main(page).getByText("Owner: ")).toBeVisible();
    await main(page).getByRole("tab", { name: "Activity" }).click();
    await expect(main(page).getByText(/Seen /).first()).toBeVisible();
    await main(page).getByRole("button", { name: "All fields" }).click();
    const drawer = page.getByRole("dialog", { name: "Record fields" });
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("owner");
    await expect(drawer).toContainText("status");
    await page.waitForTimeout(600);
    const top = await drawer.evaluate((el) => { const r = el.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return el.contains(e); });
    expect(top).toBe(true);
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await main(page).getByRole("button", { name: "Edit" }).click();
    const modal = page.getByRole("dialog", { name: "Edit task" });
    await expect(modal).toBeVisible();
    const modalTop = await modal.evaluate((el) => { const r = el.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return el.contains(e); });
    expect(modalTop).toBe(true);
    await modal.getByRole("button", { name: "Close", exact: true }).click();
    await expect(modal).toBeHidden();
  });

  test("S2 section shows on a task record", async ({ page }) => {
    await openStatic(page, "#/entity/task/t07");
    await expect(main(page).getByText(/\d+ sightings/)).toBeVisible();
    await expect(main(page).getByText(/Seen /).first()).toBeVisible();
    await page.screenshot({ path: join(SHOTS, "s2-section-desktop-light.png"), fullPage: true });
  });

  test("S3 date range filters the line chart and the spec block shows a number", async ({ page }) => {
    await openStatic(page, "#/x/s3-dashboard");
    await expect(main(page).locator(".recharts-line").first()).toBeVisible();
    const tile = main(page).getByText("Total amount (spec tile)").locator("xpath=ancestor::*[self::div][2]");
    await expect(tile).toContainText(/\d/);
    const amount = main(page).getByText("Amount in range").locator("xpath=following-sibling::*[1]");
    const before = await amount.innerText();
    await main(page).getByRole("button", { name: /Due between/ }).click();
    await page.getByRole("dialog").locator("button", { hasText: /^1$/ }).first().click();
    await page.getByRole("dialog").locator("button", { hasText: /^2$/ }).first().click();
    await expect.poll(async () => amount.innerText()).not.toBe(before);
  });

  test("S4 validation messages show, a refused save shows Not saved, an allowed save shows Saved", async ({ page }) => {
    await openDb(page, "#/x/s4-form", { canWrite: false });
    await main(page).getByRole("button", { name: "Save task" }).click();
    await expect(main(page)).toContainText("Enter a title of at least 3 characters");
    await expect(main(page)).toContainText("Pick an owner");
    await expect(main(page)).toContainText("Pick a due date");
    await main(page).getByRole("textbox", { name: /Title/ }).fill("Refused task");
    await main(page).getByRole("combobox", { name: /Owner/ }).click();
    await page.getByRole("option", { name: "Blake Sample" }).click();
    await main(page).getByRole("combobox", { name: /Labels/ }).click();
    await page.getByRole("option", { name: "infra" }).click();
    await page.keyboard.press("Escape");
    await main(page).getByLabel("Urgent").check({ force: true });
    await main(page).getByRole("button", { name: /Due date/ }).click();
    await page.getByRole("dialog").locator("button", { hasText: /^15$/ }).first().click();
    await main(page).getByRole("button", { name: "Save task" }).click();
    await expect(main(page).getByText(/^Not saved: /)).toBeVisible();
    await expect(page.locator(".mantine-Notifications-root").getByText("Not saved")).toBeVisible();
    expect(await page.evaluate(() => window.__deskWrites)).toEqual([]);
  });

  test("S4 an allowed save writes one task doc", async ({ page }) => {
    await openDb(page, "#/x/s4-form");
    await main(page).getByRole("textbox", { name: /Title/ }).fill("Brand new task");
    await main(page).getByRole("combobox", { name: /Owner/ }).click();
    await page.getByRole("option", { name: "Casey Demo" }).click();
    await main(page).getByRole("combobox", { name: /Labels/ }).click();
    await page.getByRole("option", { name: "billing" }).click();
    await page.getByRole("option", { name: "support" }).click();
    await page.keyboard.press("Escape");
    await main(page).getByRole("button", { name: /Due date/ }).click();
    await page.getByRole("dialog").locator("button", { hasText: /^15$/ }).first().click();
    await main(page).getByRole("button", { name: "Save task" }).click();
    await expect(main(page).getByText("Saved Brand new task")).toBeVisible();
    await expect(page.locator(".mantine-Notifications-root").getByText("Saved")).toBeVisible();
    const writes = await page.evaluate(() => window.__deskWrites);
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.some((w) => w.path.startsWith("entities/task--brand-new-task"))).toBe(true);
  });

  test("S5 board columns, a move writes, a refused move shows Not saved", async ({ page }) => {
    await openDb(page, "#/x/s5-board");
    await expect(main(page).getByRole("heading", { name: "todo" })).toBeVisible();
    const todoBadge = main(page).getByRole("heading", { name: "todo" }).locator("xpath=following-sibling::*[1]");
    const before = Number(await todoBadge.innerText());
    await main(page).getByRole("button", { name: /^Move / }).first().click();
    await page.getByRole("menuitem", { name: "doing" }).click();
    await expect.poll(async () => (await page.evaluate(() => window.__deskWrites)).length).toBeGreaterThan(0);
    await expect.poll(async () => Number(await todoBadge.innerText())).toBe(before - 1);
  });

  test("S5 refused move shows Not saved in the Desk notification stack", async ({ page }) => {
    await openDb(page, "#/x/s5-board", { canWrite: false });
    await main(page).getByRole("button", { name: /^Move / }).first().click();
    await page.getByRole("menuitem").first().click();
    await expect(page.locator(".mantine-Notifications-root").getByText("Not saved")).toBeVisible();
    expect(await page.evaluate(() => window.__deskWrites)).toEqual([]);
  });

  test("S6 accordion, segmented control, number input and the confirm modal", async ({ page }) => {
    await openStatic(page, "#/x/s6-settings");
    await main(page).getByText("spacious").click();
    await expect(main(page).getByRole("radio", { name: "spacious" })).toBeChecked();
    await main(page).getByRole("button", { name: "Lists" }).click();
    const rows = main(page).getByRole("textbox", { name: "Rows per page" });
    await expect(rows).toBeVisible();
    await rows.fill("25");
    await expect(rows).toHaveValue("25");
    await main(page).getByRole("button", { name: "Reset to defaults" }).click();
    const modal = page.getByRole("dialog", { name: "Reset settings" });
    await expect(modal).toBeVisible();
    const modalTop = await modal.evaluate((el) => { const r = el.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return el.contains(e); });
    expect(modalTop).toBe(true);
    await modal.getByRole("button", { name: "Reset", exact: true }).click();
    await expect(modal).toBeHidden();
    await expect(rows).toHaveValue("10");
    await main(page).getByRole("button", { name: "Layout" }).click();
    await expect(main(page).getByRole("radio", { name: "comfortable" })).toBeChecked();
  });

  test("S7 notifications appear in the Desk stack, a refused write shows Not saved, the boundary offers Try again", async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: "expect-errors" });
    await openDb(page, "#/x/s7-errors", { canWrite: false });
    const stack = page.locator(".mantine-Notifications-root");
    await main(page).getByRole("button", { name: "Show success" }).click();
    await expect(stack.getByText("All good")).toBeVisible();
    await main(page).getByRole("button", { name: "Show error" }).click();
    await expect(stack.getByText("Something failed")).toBeVisible();
    await main(page).getByRole("button", { name: "Try a write" }).click();
    await expect(main(page).getByText("Not saved").first()).toBeVisible();
    await expect(stack.getByText("Not saved")).toBeVisible();
    await page.screenshot({ path: join(SHOTS, "s7-notifications-desktop-light.png"), fullPage: true });
    await main(page).getByRole("button", { name: "Throw on next render" }).click();
    await expect(main(page)).toContainText("This page stopped");
    const retry = main(page).getByRole("button", { name: "Try again" });
    await expect(retry).toBeVisible();
    await page.screenshot({ path: join(SHOTS, "s7-boundary-desktop-light.png"), fullPage: true });
    await retry.click();
    await expect(main(page).getByRole("button", { name: "Show success" })).toBeVisible();
  });
});
