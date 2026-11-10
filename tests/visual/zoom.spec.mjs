// Pinch zoom: what the zoom lock does to a real pinch gesture in Chromium (mobile emulation, touch), standalone and
// inside a cross-origin iframe the way the host page embeds the Desk. WebKit is not installed here, so iOS Safari is
// NOT measured by this spec; its gesturestart handling is covered only by the vitest unit tests. Run: bash tests/visual/run.sh.
import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { start } from "./serve.mjs";

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, colorScheme: "light" };
let server;
let host;
let hostOrigin;
let origin;

test.use({ ...PHONE, timezoneId: "UTC", locale: "en-US" });
// The host page is a second server on another port, so the Desk iframe is cross-origin to it, as it is in claude.ai.
test.beforeAll(async () => {
  server = await start();
  origin = "http://127.0.0.1:" + server.address().port;
  host = createServer((req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(hostHtml(req.url.startsWith("/host-first"))); });
  await new Promise((r) => host.listen(0, "127.0.0.1", r));
  hostOrigin = "http://127.0.0.1:" + host.address().port;
});
test.afterAll(async () => { await new Promise((r) => server.close(r)); await new Promise((r) => host.close(r)); });

const deskUrl = () => origin + "/desk.html?store=static&snapshot=/snap/demo.json#/today";

// The host page: its own viewport meta (the one that governs the real page zoom), a heading outside the iframe, and the
// Desk in a cross-origin iframe.
function hostHtml(hostFirst) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0">${hostFirst ? '<h1 id="outside" style="height:844px;margin:0">Host page</h1>' : ""}
<iframe id="desk" src="${deskUrl()}" style="border:0;width:100%;height:844px"></iframe></body></html>`;
}

async function pinch(page, x, y, scaleFactor) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.synthesizePinchGesture", { x, y, scaleFactor, relativeSpeed: 400, gestureSourceType: "touch" });
  await page.waitForTimeout(300);
}
const scale = (page) => page.evaluate(() => window.visualViewport.scale);

async function openDesk(page, zoom) {
  if (zoom) await page.addInitScript((z) => { try { localStorage.setItem("routineos-desk-zoom", z); } catch (e) { /* none */ } }, zoom);
  await page.goto(deskUrl());
  await expect(page.getByRole("main")).toBeVisible();
}

async function openHosted(page, zoom, hostFirst) {
  if (zoom) await page.addInitScript((z) => { try { localStorage.setItem("routineos-desk-zoom", z); } catch (e) { /* none */ } }, zoom);
  await page.goto(hostOrigin + (hostFirst ? "/host-first" : "/"));
  const frame = page.frameLocator("#desk");
  await expect(frame.getByRole("main")).toBeVisible();
  return frame;
}

test.describe("standalone Desk page", () => {
  test("zoom allowed: a pinch zooms the page (the control)", async ({ page }) => {
    await openDesk(page, "allow");
    await pinch(page, 195, 400, 2);
    const s = await scale(page);
    expect(s).toBeGreaterThan(1.2);
  });
  test("zoom locked (default): a pinch does not zoom the page", async ({ page }) => {
    await openDesk(page);
    await pinch(page, 195, 400, 2);
    const s = await scale(page);
    expect(s).toBe(1);
  });
});

test.describe("Desk in a cross-origin iframe", () => {
  test("zoom allowed: a pinch on the Desk zooms the host page (the control)", async ({ page }) => {
    await openHosted(page, "allow");
    await pinch(page, 195, 400, 2);
    const s = await scale(page);
    expect(s).toBeGreaterThan(1.2);
  });
  test("zoom locked: a pinch on the Desk", async ({ page }) => {
    await openHosted(page);
    await pinch(page, 195, 400, 2);
    const s = await scale(page);
    expect(s).toBe(1);
  });
  test("zoom locked: a pinch on the host page outside the Desk is not ours to stop", async ({ page }) => {
    await openHosted(page, undefined, true);
    await pinch(page, 195, 400, 2);
    const s = await scale(page);
    expect(s).toBeGreaterThan(1.2);
  });
});

// Which part of the lock does the work, measured by applying one part at a time to a Desk with zoom allowed.
const PARTS = {
  "viewport meta only": () => document.querySelector('meta[name="viewport"]').setAttribute("content", "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"),
  "touch-action only": () => { document.documentElement.style.touchAction = "pan-x pan-y"; },
  "cancelled gesture and multi-touch events only": () => {
    const stop = (e) => e.preventDefault();
    document.addEventListener("gesturestart", stop, { passive: false });
    document.addEventListener("touchmove", (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
  },
};
test.describe("one part at a time (zoom allowed, Chromium)", () => {
  for (const [name, part] of Object.entries(PARTS)) {
    test("standalone: " + name, async ({ page }) => {
      await openDesk(page, "allow");
      await page.evaluate(part);
      await pinch(page, 195, 400, 2);
      // The viewport meta did nothing to a pinch in Chromium; the other two parts each stop it alone.
      if (name === "viewport meta only") expect(await scale(page)).toBeGreaterThan(1.2);
      else expect(await scale(page)).toBe(1);
    });
  }
});

test.describe("what the lock leaves alone", () => {
  test("one-finger scrolling still works while locked", async ({ page }) => {
    await openDesk(page);
    const cdp = await page.context().newCDPSession(page);
    const before = await page.evaluate(() => [...document.querySelectorAll("*")].map((n) => n.scrollTop).reduce((a, b) => a + b, 0) + scrollY);
    await cdp.send("Input.synthesizeScrollGesture", { x: 195, y: 600, yDistance: -400, gestureSourceType: "touch" });
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => [...document.querySelectorAll("*")].map((n) => n.scrollTop).reduce((a, b) => a + b, 0) + scrollY);
    expect(after).toBeGreaterThan(before);
  });
  test("the browser's default font size still scales the Desk's rem text while locked", async ({ page }) => {
    await openDesk(page);
    const size = () => page.evaluate(() => ({ root: parseFloat(getComputedStyle(document.documentElement).fontSize),
      body: parseFloat(getComputedStyle(document.querySelector("h1")).fontSize) }));
    const small = await size();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Page.setFontSizes", { fontSizes: { standard: 24, fixed: 24 } });
    await page.reload();
    await expect(page.getByRole("main")).toBeVisible();
    const large = await size();
    expect(large.root).toBe(24);
    expect(large.body / small.body).toBeCloseTo(1.5, 1);
  });
});
