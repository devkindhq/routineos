// Phone timing (spec 12): a throttled phone opening the single-file Mantine Desk, measured without route() so every
// byte crosses the throttled network path to the local server. Opt-in: PHONE=1 bash tests/visual/run.sh. Writes
// out/phone-timing.json. There is one bundle mode now (the split build is gone), so there are no split gates; the
// run records numbers and checks only that Today became useful in every sample.
import { test, expect, devices } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { start } from "./serve.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const SAMPLES = 5;
const PATH = "/desk.html?store=static&snapshot=/snap/phone.json";
// This spec's choice of a slow phone connection (spec 12.1), not a named preset.
const PROFILE = { device: "Pixel 7", cpuRate: 4, latency: 150, down: 1.6e6 / 8, up: 750e3 / 8 };
const BIAS = "The local server gzips text and caches static files; the snapshot is a 40-record cut of the v2 fixture, " +
  "so the times reflect the built code and not the fixture. Items opens are timed from a hash change, not a tap.";
// After Today is useful, wait for the page to go idle before the first Items open.
const IDLE_MS = 5000;

// Recorded in the page from its first script, so the Desk sources carry no instrumentation. Landmarks and the main
// h1 mark the points: the shell is drawn when the banner and the Desk navigation exist; Today is useful when main has
// its "Today" h1 and nothing in main is busy.
function observer() {
  const p = (window.__phone = { longTasks: [] });
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (e.name === "first-contentful-paint") p.fcp = e.startTime; }))
      .observe({ type: "paint", buffered: true });
  } catch (e) { /* no paint timing */ }
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => p.longTasks.push([e.startTime, e.duration])))
      .observe({ type: "longtask", buffered: true });
  } catch (e) { /* no long task timing */ }
  const check = () => {
    if (p.shell === undefined && document.querySelector("header") && document.querySelector('nav[aria-label="Desk"]')) p.shell = performance.now();
    const h1 = document.querySelector("main h1");
    if (p.todaySeen === undefined && h1 && h1.textContent.trim() === "Today" && !document.querySelector('main [aria-busy="true"]')) {
      p.todaySeen = performance.now();
      requestAnimationFrame(() => requestAnimationFrame(() => { p.todayUseful = performance.now(); }));
    }
  };
  new MutationObserver(check).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-busy"] });
}

async function cold(page) {
  await page.waitForFunction(() => window.__phone && window.__phone.todayUseful !== undefined, null, { timeout: 120000 });
  return page.evaluate(() => {
    const p = window.__phone;
    const longTasks = p.longTasks.filter(([s]) => s < p.todayUseful).reduce((a, [, d]) => a + d, 0);
    return { fcp: p.fcp ?? null, shell: p.shell ?? null, todayUseful: p.todayUseful, longTasks };
  });
}

// From a hash change to main's h1 reading `title` with nothing busy, drawn and painted.
async function go(page, hash, title) {
  return page.evaluate(([hash, title]) => new Promise((resolve) => {
    const t0 = performance.now();
    const look = () => {
      const h1 = document.querySelector("main h1");
      if (h1 && h1.textContent.trim() === title && !document.querySelector('main [aria-busy="true"]')) {
        obs.disconnect();
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - t0)));
      }
    };
    const obs = new MutationObserver(look);
    obs.observe(document, { childList: true, subtree: true, attributes: true });
    location.hash = hash;
  }), [hash, title]);
}

async function sample(browser, origin) {
  const context = await browser.newContext({ ...devices[PROFILE.device] });
  await context.addInitScript(observer);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: PROFILE.cpuRate });
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: PROFILE.latency,
    downloadThroughput: PROFILE.down, uploadThroughput: PROFILE.up });
  await page.goto(origin + PATH + "#/today", { timeout: 120000 });
  const out = await cold(page);
  await page.waitForTimeout(IDLE_MS);
  out.itemsFirst = await go(page, "#/browse/role", "Roles");
  await go(page, "#/today", "Today");
  out.itemsSecond = await go(page, "#/browse/role", "Roles");
  await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toHaveText("Roles");
  await page.goto("about:blank");
  await page.goto(origin + PATH + "#/today", { timeout: 120000 });
  out.warm = await cold(page);
  await context.close();
  return out;
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const round = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);
function summary(samples, pick) {
  const keys = ["fcp", "shell", "todayUseful", "longTasks", "itemsFirst", "itemsSecond"];
  const of = (f) => Object.fromEntries(keys.map((k) => [k, round(f(samples.map((s) => pick(s)[k]).filter((v) => typeof v === "number")))]));
  return { median: of(median), max: of((xs) => (xs.length ? Math.max(...xs) : null)) };
}

function machine() {
  const sh = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: "utf8" }).trim(); } catch (e) { return ""; } };
  return [sh("uname", ["-m"]), sh("sysctl", ["-n", "machdep.cpu.brand_string"])].filter(Boolean).join(", ");
}

const results = { profile: PROFILE, chromium: null, machine: machine(), bias: BIAS, modes: {} };
let server;
let origin;
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  server = await start();
  origin = "http://127.0.0.1:" + server.address().port;
});
test.afterAll(async () => {
  await new Promise((r) => server.close(r));
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "phone-timing.json"), JSON.stringify(results, null, 2) + "\n");
});

test("phone timing: single", async ({ browser }) => {
  test.setTimeout(15 * 60 * 1000);
  results.chromium = browser.version();
  const samples = [];
  for (let i = 0; i < SAMPLES; i++) samples.push(await sample(browser, origin));
  const c = summary(samples, (s) => s);
  results.modes.single = { samples, median: c.median, max: c.max, warm: summary(samples, (s) => s.warm) };
  console.log("phone single: " + JSON.stringify({ median: c.median, max: c.max }));
  for (const s of samples) expect(typeof s.todayUseful).toBe("number");
});
