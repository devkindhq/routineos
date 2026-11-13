// The Blueprint page (build variant): the authored fixture plus one requirement nothing serves ("audit"), built by
// routineos.desk_page. Read only: no write reaches the store.
// Run with: bash tests/visual/run.sh (DESK_SPECS="blueprint.spec.mjs" for this file alone).
import { test as base, expect } from "@playwright/test";
import { start, deskUrl } from "./serve.mjs";
import { fakeClaude } from "./fake-claude.mjs";

const NOW = new Date("2026-11-13T00:00:00Z");
const IDS = ["http:web", "infra:review-worker", "output:desk", "routine:authored", "stage:fetch", "stage:write", "store:artifact-db", "trigger:schedule"];

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
    await use();
    expect(problems).toEqual([]);
    expect(await page.evaluate(() => window.__deskWrites || [])).toEqual([]);
  }, { auto: true }],
});

test.use({ timezoneId: "UTC", locale: "en-US" });
test.beforeAll(async () => {
  server = await start();
  origin = "http://127.0.0.1:" + server.address().port;
});
test.afterAll(async () => { await new Promise((r) => server.close(r)); });

async function open(page) {
  await fakeClaude(page, { viewer: "u_owner", owner: true, writable: true });
  await page.goto(deskUrl(origin, new URLSearchParams({ store: "db", bundle: "blueprint" }), "#/x/blueprint"));
  await expect(page.getByTestId("bp-canvas")).toBeVisible();
  await expect(page.getByTestId("bp-node-" + IDS[0])).toBeVisible();
}
const node = (page, id) => page.getByTestId("bp-node-" + id);
const viewport = (page) => page.locator(".react-flow__viewport").evaluate((el) => {
  const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
  return { x: m.e, y: m.f, k: m.a };
});
const settle = (page) => page.waitForTimeout(500);
async function paneCenter(page) {
  const b = await page.locator(".react-flow__pane").boundingBox();
  return { x: b.x + b.width / 2, y: b.y + 8, b };
}

test("the canvas renders every node", async ({ page }) => {
  await open(page);
  for (const id of IDS) await expect(node(page, id)).toBeAttached();
});

test("dragging the pane moves the viewport", async ({ page }) => {
  await open(page);
  await settle(page);
  const before = await viewport(page);
  const c = await paneCenter(page);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 60, c.y + 30, { steps: 6 });
  await page.mouse.up();
  const after = await viewport(page);
  expect(after.x).not.toBe(before.x);
  expect(after.k).toBeCloseTo(before.k, 5);
});

test("the wheel zooms the canvas", async ({ page }) => {
  await open(page);
  await settle(page);
  const before = await viewport(page);
  const c = await paneCenter(page);
  await page.mouse.move(c.x, c.y + 100);
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => (await viewport(page)).k).toBeGreaterThan(before.k);
});

test("with Scroll zooms canvas off, the wheel scrolls the page and leaves the zoom", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 500 });
  await open(page);
  await settle(page);
  await expect(page.getByTestId("bp-scrollzoom")).toBeChecked();
  await page.getByTestId("bp-scrollzoom").click({ force: true });
  await expect(page.getByTestId("bp-scrollzoom")).not.toBeChecked();
  const before = await viewport(page);
  const c = await paneCenter(page);
  await page.mouse.move(c.x, c.y + 100);
  const scroller = () => page.evaluate(() => {
    let max = window.scrollY;
    document.querySelectorAll("*").forEach((el) => { if (el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY !== "visible") max = Math.max(max, el.scrollTop); });
    return max;
  });
  const top = await scroller();
  await page.mouse.wheel(0, 200);
  await expect.poll(scroller).toBeGreaterThan(top);
  expect((await viewport(page)).k).toBeCloseTo(before.k, 5);
});

test("a covered requirement brings its nodes into view and dims the others; Show all restores", async ({ page }) => {
  await open(page);
  await page.getByTestId("bp-req-fresh").click();
  await settle(page);
  const box = await page.getByTestId("bp-canvas").boundingBox();
  for (const id of ["stage:fetch", "infra:review-worker"]) {
    const b = await node(page, id).boundingBox();
    expect(b.x).toBeGreaterThanOrEqual(box.x - 1);
    expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width + 1);
    expect(b.y).toBeGreaterThanOrEqual(box.y - 1);
    expect(b.y + b.height).toBeLessThanOrEqual(box.y + box.height + 1);
  }
  const opacity = (id) => node(page, id).evaluate((el) => Number(getComputedStyle(el).opacity));
  expect(await opacity("stage:fetch")).toBe(1);
  expect(await opacity("output:desk")).toBeCloseTo(0.25, 2);
  await page.getByTestId("bp-showall").click();
  await expect.poll(() => opacity("output:desk")).toBe(1);
});

test("a gap requirement says so and leaves the viewport alone", async ({ page }) => {
  await open(page);
  await settle(page);
  const before = await viewport(page);
  await expect(page.getByTestId("bp-gap-audit")).toHaveText("nothing serves this yet");
  await page.getByTestId("bp-req-audit").click();
  await settle(page);
  expect(await viewport(page)).toEqual(before);
});

test("clicking a node opens the drawer with its source key", async ({ page }) => {
  await open(page);
  await node(page, "infra:review-worker").click();
  const drawer = page.getByTestId("bp-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("infra[0]");
  await expect(drawer).toContainText("routine.toml");
});

test("clicking a node highlights the requirements it serves", async ({ page }) => {
  await open(page);
  await expect(page.getByTestId("bp-req-fresh")).toHaveAttribute("data-highlighted", "false");
  await node(page, "infra:review-worker").click();
  await expect(page.getByTestId("bp-req-fresh")).toHaveAttribute("data-highlighted", "true");
  await expect(page.getByTestId("bp-req-report")).toHaveAttribute("data-highlighted", "false");
});

test("ctrl-wheel still zooms with Scroll zooms canvas off", async ({ page }) => {
  await open(page);
  await settle(page);
  await page.getByTestId("bp-scrollzoom").click({ force: true });
  await expect(page.getByTestId("bp-scrollzoom")).not.toBeChecked();
  const before = await viewport(page);
  const c = await paneCenter(page);
  await page.mouse.move(c.x, c.y + 100);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -300);
  await page.keyboard.up("Control");
  await expect.poll(async () => (await viewport(page)).k).toBeGreaterThan(before.k);
});

test.describe("touch", () => {
  test.use({ hasTouch: true, viewport: { width: 700, height: 500 } });
  async function touch(page) {
    const cdp = await page.context().newCDPSession(page);
    const send = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map((p, id) => ({ id, x: p[0], y: p[1] })) });
    return send;
  }
  const scrollTop = (page) => page.evaluate(() => {
    let max = window.scrollY;
    document.querySelectorAll("*").forEach((el) => { if (el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY !== "visible") max = Math.max(max, el.scrollTop); });
    return max;
  });

  test("one finger scrolls the page and leaves the viewport alone", async ({ page }) => {
    await open(page);
    await settle(page);
    const send = await touch(page);
    const before = await viewport(page);
    const top = await scrollTop(page);
    const c = await paneCenter(page);
    const x = c.x, y = c.y + 250;
    await send("touchStart", [[x, y]]);
    for (let i = 1; i <= 8; i++) await send("touchMove", [[x, y - i * 20]]);
    await send("touchEnd", []);
    await expect.poll(() => scrollTop(page)).toBeGreaterThan(top);
    expect(await viewport(page)).toEqual(before);
  });

  test("two fingers spreading zoom the canvas", async ({ page }) => {
    await open(page);
    await settle(page);
    const send = await touch(page);
    const before = await viewport(page);
    const c = await paneCenter(page);
    const x = c.x, y = c.y + 150;
    await send("touchStart", [[x - 40, y]]);
    await send("touchStart", [[x - 40, y], [x + 40, y]]);
    for (let i = 1; i <= 8; i++) await send("touchMove", [[x - 40 - i * 15, y], [x + 40 + i * 15, y]]);
    await send("touchEnd", []);
    await expect.poll(async () => (await viewport(page)).k).toBeGreaterThan(before.k * 1.3);
  });
});

test("at 400px the minimap is hidden and the page does not scroll sideways", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 800 });
  await open(page);
  await expect(page.getByTestId("bp-minimap")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

for (const scheme of ["light", "dark"]) {
  test("screenshot, " + scheme, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1100, height: 900 });
    await open(page);
    await settle(page);
    await page.screenshot({ path: info.outputPath("blueprint-" + scheme + ".png"), fullPage: true });
    await expect(page.getByTestId("bp-canvas")).toBeVisible();
  });
}
