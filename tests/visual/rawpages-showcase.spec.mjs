// Raw page showcase: tests/desk_fixtures/raw-pages-showcase renders every standalone registry component, one labelled
// cell each (data-cell lists the names a cell covers). Each page is built into a read-only preview by
// `routineos desk preview` and served here. A page passes when its error boundary did not fire, no cell reported
// data-cell-failed, the console and page are error free and (phone) nothing scrolls sideways. The seen cell names are
// written to out/raw-pages-showcase/seen-<id>.json for the coverage count.
// Screenshots go to out/raw-pages-showcase/<id>-<desktop|phone>-light.png.
// Run with: DESK_SPECS="rawpages-showcase.spec.mjs" bash tests/visual/run.sh
import { test as base, expect } from "@playwright/test";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const NOW = new Date("2026-11-01T00:00:00Z");
const SHOTS = join(HERE, "out", "raw-pages-showcase");
const CONFIG_RE = /(<script type="application\/json" id="desk-config">)([\s\S]*?)(<\/script>)/;
const IDS = (process.env.SHOWCASE_IDS ||
  "sc-inputs,sc-buttons-nav,sc-overlays,sc-data-display,sc-feedback,sc-charts,sc-dates,sc-datatable-icons-hooks").split(",");

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
    expect(problems).toEqual([]);
  }, { auto: true }],
});

test.use({ timezoneId: "UTC", locale: "en-US" });

test.beforeAll(async () => {
  previewDir = mkdtempSync(join(tmpdir(), "showcase-preview-"));
  execFileSync("python3", [join(ROOT, "skills", "routineos", "scripts", "routineos.py"), "desk", "preview",
    "--routine", join(ROOT, "tests", "desk_fixtures", "raw-pages-showcase"), "--out", previewDir], { encoding: "utf8" });
  mkdirSync(SHOTS, { recursive: true });
  const html = readFileSync(join(previewDir, "index.html"), "utf8");
  server = await new Promise((resolve) => {
    const s = createServer((req, res) => {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/index.html") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html.replace(CONFIG_RE, (_m, a, _b, c) => a + JSON.stringify({ store: "static", snapshot: "snapshot.json" }) + c));
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

const SIZES = { desktop: { width: 1280, height: 900 }, phone: { width: 390, height: 844 } };
const main = (page) => page.getByRole("main").first();

async function openPage(page, id) {
  await page.goto(origin + "/index.html#/x/" + id);
  await expect(main(page).locator("[data-cell]").first()).toBeVisible({ timeout: 20000 });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.waitForTimeout(1200);
}

for (const size of Object.keys(SIZES)) {
  test.describe(size, () => {
    test.use({ viewport: SIZES[size], colorScheme: "light" });
    for (const id of IDS) {
      test(`${id} mounts every cell without the error boundary`, async ({ page }) => {
        await openPage(page, id);
        await expect(main(page)).not.toContainText("This page stopped");
        const failed = await main(page).locator("[data-cell-failed]").evaluateAll((els) => els.map((e) => e.textContent));
        expect(failed).toEqual([]);
        const seen = await main(page).locator("[data-cell]").evaluateAll((els) =>
          els.flatMap((e) => e.getAttribute("data-cell").split(/\s+/).filter(Boolean)));
        expect(seen.length).toBeGreaterThan(0);
        if (size === "desktop") writeFileSync(join(SHOTS, `seen-${id}.json`), JSON.stringify(seen, null, 1));
        if (size === "phone") {
          const w = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
          expect(w.s).toBeLessThanOrEqual(w.c);
        }
        await page.screenshot({ path: join(SHOTS, `${id}-${size}-light.png`), fullPage: true });
      });
    }
  });
}
