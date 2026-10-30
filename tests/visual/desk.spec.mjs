// Playwright checks for the Desk on the static store and a stand-in db (Task 13).
// Run with: bash tests/visual/run.sh. Screenshots go to $DESK_SHOTS (default tests/visual/out/shots),
// timings to tests/visual/out/perf.json.
import { test as base, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { start, HOSTILE, HOSTILE_ID } from "./serve.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const SHOTS = process.env.DESK_SHOTS || join(OUT, "shots");
mkdirSync(SHOTS, { recursive: true });

const SIZES = [{ width: 390, height: 844 }, { width: 1280, height: 800 }];
const THEMES = ["light", "dark"];
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

const PAGES = [
  ["today", "#/today", /parsed 2 of 3/],
  ["inbox", "#/inbox", /Add GB to markets/],
  ["browse-roles", "#/browse/role", /Showing the first \d+ Roles/],
  ["browse-companies", "#/browse/company", /Showing the first \d+ Companies/],
  ["entity-company-merged", "#/entity/company/ithfax-home-example", /Jobs watch, Lead signals/],
  ["entity-role-dropped", "#/entity/role/https-jobs-example-au-00049", /Dropped: not in title_keywords/],
  ["entity-role-active", "#/entity/role/https-jobs-example-au-00003", /Owns the headless commerce architecture/],
  ["entity-role-kept", "#/entity/role/https-jobs-example-au-00174", /Kept by a person on 2026-10-21 02:40/],
  ["entity-role-kept-pending", "#/entity/role/https-jobs-example-de-00323", /Kept \(pending next run\)/],
  ["inbox-suggestions", "#/inbox?tab=suggestions", /setting markets/],
  ["approvals", "#/approvals", /Introduction about the/],
  ["views", "#/views", /Remote roles this month/],
  ["history", "#/history", /Jobs watch/],
  ["history-calendar", "#/history?mode=cal", /Jobs watch|Mon/],
  ["history-health", "#/history?mode=health", /Jobs watch/],
  ["history-activity", "#/history?mode=activity", /Someone|Nothing/],
  ["run-partial", "#/history/jobs-watch-20261027", /2 of 3/],
  ["settings", "#/settings", /About/],
];

const STATES = [
  ["not-set-up", { snap: "empty" }, /is not set up yet/],
  ["first-run", { snap: "first-run" }, /Nothing has run yet/],
  ["loading", { snap: "slow" }, /Loading the workspace/],
  ["read-error", { snap: "missing", allow: /404/ }, /Try again/],
  ["browse-read-error", { store: "db", fakeDb: true, hash: "#/browse/role" }, /Try again/],
  ["no-db", { store: "db" }, /needs the db capability/],
  ["empty-filter", { hash: "#/browse/role?q=no-such-role-anywhere" }, /No Roles match these filters/],
];

let server;
let origin;

// Every test fails on a console error, a page error, a dialog or a request outside the local server and Google Fonts.
const test = base.extend({
  guard: [async ({ page }, use) => {
    const problems = [];
    const g = { allow: null };
    page.on("console", (m) => { if (m.type() === "error" && !(g.allow && g.allow.test(m.text()))) problems.push("console: " + m.text()); });
    page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
    page.on("dialog", (d) => { problems.push("dialog: " + d.message()); d.dismiss(); });
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.origin !== origin && FONT_HOSTS.indexOf(u.hostname) === -1 && u.protocol !== "data:") problems.push("request: " + r.url());
    });
    await use(g);
    expect(problems).toEqual([]);
  }, { auto: true }],
});

test.beforeAll(async () => {
  server = await start();
  origin = "http://127.0.0.1:" + server.address().port;
});
test.afterAll(async () => { await new Promise((r) => server.close(r)); });

function url(o = {}) {
  const store = o.store || "static";
  const q = new URLSearchParams({ store });
  if (store === "static") q.set("snapshot", "/snap/" + (o.snap || "demo") + ".json");
  if (o.workspace) q.set("workspace", o.workspace);
  return origin + "/desk.html?" + q + (o.hash || "#/today");
}

// A stand-in for the artifact runtime's db: serves the demo snapshot, fails every read of `entities`.
// With writable, reads succeed and set/delete change an in-page copy, listed in window.__deskWrites, and re-run live queries.
async function fakeDb(page, opts = {}) {
  await page.addInitScript((writable) => {
    const snapshot = fetch("/snap/demo.json").then((r) => r.json());
    const fail = (c) => !writable && c === "entities";
    const listeners = [];
    window.__deskWrites = [];
    function docSnap(path, docs) {
      const d = docs[path];
      return { id: path.split("/").pop(), exists: !!d, data: () => (d ? d.data : undefined) };
    }
    function query(collection, where) {
      const run = () => snapshot.then((docs) => {
        if (fail(collection)) throw new Error("forced read failure: " + collection);
        const ids = Object.keys(docs).sort().filter((p) => p.slice(0, p.lastIndexOf("/")) === collection);
        const rows = ids.filter((p) => where.every(([f, op, v]) => op === "==" && docs[p].data[f] === v));
        return { docs: rows.map((p) => docSnap(p, docs)) };
      });
      return {
        where: (f, op, v) => query(collection, where.concat([[f, op, v]])),
        orderBy: function () { return this; },
        limit: function () { return this; },
        get: run,
        onSnapshot: (cb, err) => {
          const l = { run, cb, err, live: true };
          if (writable) listeners.push(l);
          run().then(cb, err);
          return () => { l.live = false; };
        },
      };
    }
    function write(path, data) {
      if (!writable) return Promise.resolve();
      return snapshot.then((docs) => {
        window.__deskWrites.push({ op: data === undefined ? "delete" : "set", path, data });
        if (data === undefined) delete docs[path];
        else docs[path] = { version: ((docs[path] && docs[path].version) || 0) + 1, data: JSON.parse(JSON.stringify(data)) };
        listeners.filter((l) => l.live).forEach((l) => l.run().then(l.cb, l.err));
      });
    }
    const db = {
      collection: (c) => query(c, []),
      doc: (path) => ({ get: () => snapshot.then((docs) => docSnap(path, docs)), set: (data) => write(path, data), delete: () => write(path, undefined) }),
    };
    const user = { id: () => Promise.resolve("u_test") };
    window.claude = { use: (name) => Promise.resolve(name === "db" ? db : name === "user" && writable ? user : null) };
  }, !!opts.writable);
}

async function noHorizontalScroll(page) {
  const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(sw, "horizontal scroll").toBeLessThanOrEqual(cw);
}

async function navForWidth(page, width) {
  if (width < 900) {
    await expect(page.locator(".bottom-nav")).toBeVisible();
    await expect(page.locator(".rail")).toBeHidden();
  } else {
    await expect(page.locator(".rail")).toBeVisible();
    await expect(page.locator(".bottom-nav")).toBeHidden();
  }
}

// Relative luminance of the body background: the dark theme must be dark and the light theme light.
async function backgroundMatches(page, theme) {
  const lum = await page.evaluate(() => {
    const m = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g).map(Number);
    const ch = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * ch(m[0]) + 0.7152 * ch(m[1]) + 0.0722 * ch(m[2]);
  });
  if (theme === "dark") expect(lum, "dark background").toBeLessThan(0.1);
  else expect(lum, "light background").toBeGreaterThan(0.7);
}

async function shot(page, name) {
  await page.screenshot({ path: join(SHOTS, name + ".png"), fullPage: true });
}

for (const size of SIZES) {
  for (const theme of THEMES) {
    test.describe(`${size.width}px ${theme}`, () => {
      test.use({ viewport: size, colorScheme: theme });

      for (const [name, hash, expected] of PAGES) {
        test(`page ${name}`, async ({ page }) => {
          await page.goto(url({ hash }));
          await expect(page.locator("#outlet")).toContainText(expected);
          await page.evaluate(() => document.fonts.ready);
          await noHorizontalScroll(page);
          await navForWidth(page, size.width);
          await backgroundMatches(page, theme);
          await shot(page, `${name}-${size.width}-${theme}`);
        });
      }

      for (const [name, o, expected] of STATES) {
        test(`state ${name}`, async ({ page, guard }) => {
          guard.allow = o.allow || null;
          if (o.fakeDb) await fakeDb(page);
          await page.goto(url(o));
          await expect(page.locator("#outlet")).toContainText(expected);
          await noHorizontalScroll(page);
          await backgroundMatches(page, theme);
          await shot(page, `state-${name}-${size.width}-${theme}`);
        });
      }
    });
  }
}

test.describe("Desk pages on demo data (static store)", () => {
  test.use({ viewport: { width: 1280, height: 800 }, colorScheme: "light" });

  test("Today lists the partial run, 2 proposed views, the proposed column, the setting proposal and the gate", async ({ page }) => {
    await page.goto(url({ hash: "#/today" }));
    const main = page.locator("#outlet");
    await expect(main).toContainText("parsed 2 of 3");
    await expect(main).toContainText("Proposed view: Remote roles this month");
    await expect(main).toContainText("Proposed view: Senior roles in AU");
    await expect(main).toContainText("Proposed column: Fit score");
    await expect(main).toContainText("Add GB to markets");
    await expect(main).toContainText("Draft an intro note to the hiring lead");
  });

  test("Inbox shows 5 messages newest first", async ({ page }) => {
    await page.goto(url({ hash: "#/inbox" }));
    await expect(page.locator("#outlet")).toContainText("Add GB to markets");
    const text = await page.locator("#outlet").innerText();
    const stamps = [...text.matchAll(/^(?:Jobs watch|Content radar|Lead signals) (\d{4}-\d\d-\d\d \d\d:\d\d) Run /gm)].map((m) => m[1]);
    expect(stamps).toHaveLength(5);
    expect([...stamps].sort().reverse()).toEqual(stamps);
    // The alert refers to a Company and its Role, which share the domain; one exclusion button.
    await expect(page.getByRole("button", { name: "Add peltine-works.example to excluded_companies" })).toHaveCount(1);
  });

  test("Browse filters Roles by market and keeps the filter in the hash", async ({ page }) => {
    await page.goto(url({ hash: "#/browse/role" }));
    await page.getByText("Filters", { exact: true }).click();
    // The Columns panel has a "Market" checkbox too; the filter is the select.
    await page.getByRole("combobox", { name: "Market", exact: true }).selectOption("NZ");
    await expect(page).toHaveURL(/#\/browse\/role\?.*f\.market=NZ/);
    const count = await page.locator(".count").innerText();
    const shown = Number(count.match(/of (\d+) matching/)[1]);
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(400);
    const markets = await page.locator("table tbody tr td:nth-child(5)").allInnerTexts();
    expect(markets.length).toBeGreaterThan(0);
    expect(new Set(markets)).toEqual(new Set(["NZ"]));
    await page.reload();
    await expect(page.locator(".count")).toHaveText(count);
  });

  test("Starring on static shows the read-only note", async ({ page }) => {
    await page.goto(url({ hash: "#/browse/role" }));
    const star = page.locator("table tbody tr").first().getByRole("button", { name: "Star" });
    await expect(star).toBeDisabled();
    await expect(page.locator("#outlet")).toContainText("Demo data, read only");
  });

  test("A Company merged across two producers shows both sources", async ({ page }) => {
    await page.goto(url({ hash: "#/entity/company/ithfax-home-example" }));
    const main = page.locator("#outlet");
    await expect(main).toContainText("Jobs watch, Lead signals");
    await expect(main).toContainText("Run lead-signals-20260924");
    await expect(main).toContainText("Run jobs-watch-20261027");
    // Fields follow the definition's declared order and labels, not alphabetical keys.
    await expect(main.locator("section").first().locator("dt")).toHaveText(["Name", "Domain", "Industry", "Size", "Country"]);
  });

  test("A dropped Role shows its reason", async ({ page }) => {
    await page.goto(url({ hash: "#/entity/role/https-jobs-example-au-00049" }));
    await expect(page.locator("#outlet")).toContainText("Dropped: not in title_keywords");
  });

  test("A stored <img onerror> title renders as text", async ({ page }) => {
    for (const hash of ["#/entity/role/" + HOSTILE_ID.slice("role--".length), "#/browse/role?q=onerror"]) {
      await page.goto(url({ snap: "hostile", hash }));
      await expect(page.locator("#outlet")).toContainText(HOSTILE);
      await expect(page.locator("#outlet img")).toHaveCount(0);
    }
  });

  test("Settings shows all three demo producers, the About block and the read-only schedule", async ({ page }) => {
    await page.goto(url({ hash: "#/settings" }));
    const main = page.locator("#outlet");
    for (const p of ["Jobs watch", "Content radar", "Lead signals"]) await expect(main.getByRole("heading", { name: p })).toBeVisible();
    await expect(main.getByRole("heading", { name: "About" })).toBeVisible();
    await expect(main).toContainText("Edit the schedule on the routines page.");
  });

  test("Views shows 2 agent-made views and 1 agent-made column with badges", async ({ page }) => {
    await page.goto(url({ hash: "#/views" }));
    const main = page.locator("#outlet");
    await expect(main).toContainText("Remote roles this month");
    const columns = main.locator("section").filter({ has: page.getByRole("heading", { name: "Columns", exact: true }) });
    const all = (await main.innerText()).match(/agent made, Jobs watch/g) || [];
    const inColumns = (await columns.innerText()).match(/agent made, Jobs watch/g) || [];
    expect([all.length - inColumns.length, inColumns.length]).toEqual([2, 1]);
  });

  test("The partial run shows its parsed of claimed line, a drop reason link and a settings difference", async ({ page }) => {
    await page.goto(url({ hash: "#/runs/jobs-watch-20261027" }));
    const main = page.locator("#outlet");
    await expect(main).toContainText("2 of 3");
    await expect(main.locator('a[href*="reason="]').first()).toBeVisible();
    await expect(main).toContainText(/excluded_companies|markets|title_keywords/);
  });

  test("A long workspace name still shows the shell name on a 390px phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url({ snap: "first-run", workspace: "x" }));
    await page.evaluate(() => { document.querySelector(".ws-name").textContent = "A very long workspace name for the northern region hiring watch"; });
    await expect(page.locator(".ws-shell")).toBeVisible();
    const box = await page.locator(".ws-shell").boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await noHorizontalScroll(page);
    await shot(page, "long-name-390-light");
  });

  test("The theme toggle switches to dark inside a light system", async ({ page }) => {
    await page.goto(url({ hash: "#/today" }));
    await backgroundMatches(page, "light");
    const btn = page.locator(".theme-toggle");
    for (let i = 0; i < 3 && !String(await btn.getAttribute("aria-label")).startsWith("Theme: Dark"); i++) await btn.click();
    await expect(btn).toHaveAttribute("aria-label", "Theme: Dark. Change theme");
    await backgroundMatches(page, "dark");
  });
});

test.describe("Desk v2 shell: sidebar, palette, notifications, shortcuts", () => {
  test.use({ viewport: { width: 1280, height: 800 }, colorScheme: "light" });

  test("The sidebar lists Today, Inbox, Approvals, each type, History and Settings", async ({ page }) => {
    await page.goto(url({ hash: "#/today" }));
    const labels = (await page.locator(".rail ul.nl > li > a .lbl").allInnerTexts()).map((t) => t.trim());
    expect(labels[0]).toBe("Today");
    expect(labels.slice(1, 3)).toEqual(["Inbox", "Approvals"]);
    expect(labels.slice(-2)).toEqual(["History", "Settings"]);
    expect(labels).toContain("Roles");
  });

  test("[ makes the sidebar slim, it stays slim after a reload, and [ makes it full again", async ({ page }) => {
    await page.goto(url({ hash: "#/today" }));
    await page.locator("#outlet").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("[");
    await expect(page.locator(".app")).toHaveClass(/slim/);
    const w = (await page.locator(".rail").boundingBox()).width;
    expect(w).toBeLessThan(100);
    await shot(page, "shell-slim-1280-light");
    // icons only, and every link and the toggle keep a name and a title
    expect((await page.locator(".rail ul.nl > li > a .lbl").first().boundingBox()).width).toBeLessThanOrEqual(1);
    await expect(page.getByRole("link", { name: "Today", exact: true })).toHaveAttribute("title", "Today");
    await expect(page.getByRole("link", { name: "Roles", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Full sidebar" })).toHaveAttribute("title", "Full sidebar ([)");
    await page.reload();
    await expect(page.locator(".app")).toHaveClass(/slim/);
    await page.keyboard.press("[");
    await expect(page.locator(".app")).not.toHaveClass(/slim/);
    await page.getByRole("button", { name: "Slim sidebar" }).click();
    await expect(page.locator(".app")).toHaveClass(/slim/);
    await page.getByRole("button", { name: "Full sidebar" }).click();
    await expect(page.locator(".app")).not.toHaveClass(/slim/);
    await expect(page.getByRole("button", { name: "Open the menu" }), "the drawer menu is phone only").toBeHidden();
  });

  test("Sidebar entries show an icon, the type's own when the definition names one", async ({ page }) => {
    await page.goto(url({ hash: "#/today" }));
    for (const [name, ic] of [["Today", "house"], ["Roles", "briefcase"], ["Companies", "building-2"], ["Settings", "settings"]]) {
      const a = page.getByRole("link", { name, exact: true }).first();
      await expect(a.locator("use")).toHaveAttribute("href", "#icon-" + ic);
    }
  });

  test("Ctrl K opens the palette, typing filters it and Enter goes to the page", async ({ page }) => {
    await page.goto(url({ hash: "#/today" }));
    await page.keyboard.press("Control+k");
    const input = page.locator(".pal-input");
    await expect(input).toBeFocused();
    await input.fill("go appro");
    await expect(page.locator(".pal-item").first()).toHaveText("Go to Approvals");
    await shot(page, "palette-1280-light");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#\/approvals/);
    await expect(page.locator(".pal")).toHaveCount(0);
  });

  test("g then i goes to the Inbox, and ? lists the shortcuts", async ({ page }) => {
    await page.goto(url({ hash: "#/today" }));
    await page.keyboard.press("g");
    await page.keyboard.press("i");
    await expect(page).toHaveURL(/#\/inbox/);
    await page.keyboard.press("Shift+Slash");
    await expect(page.locator(".keys-dialog")).toContainText("Command palette");
    await page.keyboard.press("Escape");
    await expect(page.locator(".keys-dialog")).toHaveCount(0);
  });

  test("The bell opens the notifications column beside the page and Esc closes it", async ({ page }) => {
    await page.goto(url({ hash: "#/today" }));
    await page.getByRole("button", { name: /^Notifications/ }).click();
    const panel = page.locator(".notif-panel");
    await expect(panel.getByRole("heading", { name: "Notifications" })).toBeVisible();
    const p = await panel.boundingBox();
    const o = await page.locator("#outlet").boundingBox();
    expect(p.x).toBeGreaterThanOrEqual(o.x + o.width - 1);
    await noHorizontalScroll(page);
    await shot(page, "notifications-1280-light");
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  });

  test("On a 390px phone the menu opens the sidebar as a drawer and the bell opens a panel", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url({ hash: "#/today" }));
    await expect(page.locator(".rail")).toBeHidden();
    // bottom nav: icon over label, 44px targets, the current entry is a pill behind the icon, not an outline
    const items = page.locator(".bottom-nav a");
    await expect(items).toHaveCount(5);
    for (const box of await items.evaluateAll((as) => as.map((a) => a.getBoundingClientRect().toJSON()))) {
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
    const current = page.locator('.bottom-nav a[aria-current="page"]');
    await expect(current).toHaveAccessibleName("Today");
    await expect(current.locator("use")).toHaveAttribute("href", "#icon-house");
    const look = await current.evaluate((a) => [getComputedStyle(a).boxShadow, getComputedStyle(a.querySelector(".bn-icon")).backgroundColor]);
    expect(look[0]).toBe("none");
    expect(look[1]).not.toBe("rgba(0, 0, 0, 0)");
    await page.getByRole("button", { name: "Open the menu" }).click();
    await expect(page.locator(".rail")).toBeVisible();
    await expect(page.locator(".side-toggle"), "slim is desktop only").toBeHidden();
    await shot(page, "drawer-390-light");
    await page.keyboard.press("Escape");
    await expect(page.locator(".rail")).toBeHidden();
    await page.getByRole("button", { name: /^Notifications/ }).click();
    await expect(page.locator(".notif-panel")).toBeVisible();
    await noHorizontalScroll(page);
    await shot(page, "notifications-390-light");
  });

  test("Approvals shows the draft, the recipient by role and no address", async ({ page }) => {
    await page.goto(url({ hash: "#/approvals" }));
    const main = page.locator("#outlet");
    await expect(main).toContainText("Introduction about the");
    await expect(main).toContainText("hiring lead");
    expect(await main.innerText()).not.toMatch(/@[a-z0-9-]+\./i);
  });

  test("History has List, Calendar, Health and Activity, and old run links redirect", async ({ page }) => {
    await page.goto(url({ hash: "#/history" }));
    for (const m of ["List", "Calendar", "Health", "Activity"]) await expect(page.locator("#outlet").getByRole("link", { name: m, exact: true })).toBeVisible();
    await page.goto(url({ hash: "#/runs/jobs-watch-20261027" }));
    await expect(page).toHaveURL(/#\/history\/jobs-watch-20261027/);
    await expect(page.locator("#outlet")).toContainText("2 of 3");
  });

  test("Inbox has the Inbox and Suggestions tabs and the read filters", async ({ page }) => {
    await page.goto(url({ hash: "#/inbox" }));
    const main = page.locator("#outlet");
    await expect(main.getByRole("tab", { name: "Suggestions" })).toBeVisible();
    for (const f of ["Unread", "Done", "Snoozed"]) await expect(main.getByText(f, { exact: true }).first()).toBeVisible();
  });

  test("Settings shows the demo person's change under Recent changes", async ({ page }) => {
    await page.goto(url({ hash: "#/settings" }));
    await expect(page.locator("#outlet")).toContainText("Recent changes");
  });
});

test.describe("Record page: two panes, summary and keep", () => {
  const DROPPED = "#/entity/role/https-jobs-example-au-00049";
  const DROPPED_ID = "role--https-jobs-example-au-00049";

  async function boxes(page) {
    await expect(page.locator(".record-pane")).toBeVisible();
    return { main: await page.locator(".record-main").boundingBox(), pane: await page.locator(".record-pane").boundingBox() };
  }

  test("two columns at 1280px: the pane sits right of the main column, 18rem wide and sticky", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(url({ hash: DROPPED }));
    const { main, pane } = await boxes(page);
    expect(pane.x).toBeGreaterThanOrEqual(main.x + main.width);
    expect(Math.abs(pane.y - main.y)).toBeLessThan(2);
    expect(Math.round(pane.width)).toBe(288);
    expect(await page.locator(".record-pane").evaluate((n) => getComputedStyle(n).position)).toBe("sticky");
    await page.mouse.wheel(0, 2000);
    await expect.poll(async () => (await page.locator(".record-pane").boundingBox()).y).toBeGreaterThanOrEqual(56);
    await noHorizontalScroll(page);
  });

  test("one column at 390px: the pane follows the main column at full width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url({ hash: DROPPED }));
    const { main, pane } = await boxes(page);
    expect(pane.y).toBeGreaterThanOrEqual(main.y + main.height);
    expect(Math.abs(pane.x - main.x)).toBeLessThan(1);
    expect(Math.abs(pane.width - main.width)).toBeLessThan(1);
    await noHorizontalScroll(page);
  });

  test("main column holds title, Summary, Fields, History; the pane holds Status, notes, Links, Seen by, Merge", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(url({ hash: "#/entity/role/https-jobs-example-au-00003" }));
    await expect(page.locator(".record-main > h1")).toHaveCount(1);
    await expect(page.locator(".record-main > section > h2")).toHaveText(["Summary", "Fields", "Agent fields agent made", "History"]);
    await expect(page.locator(".record-pane > section > h2")).toHaveText(["Status", "Your notes", "Links", "Seen by", "Merge"]);
    await expect(page.locator(".record-main section.summary p")).toHaveText(/^Owns the headless commerce architecture for Valtine Home/);
    await expect(page.locator(".record-main .fieldlist").first().locator("dt")).not.toContainText(["Summary"]);
  });

  test("a kept Role reads Kept with Drop again, read only on static", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(url({ hash: "#/entity/role/https-jobs-example-au-00174" }));
    const pane = page.locator(".record-pane");
    await expect(pane.locator("section").first()).toContainText("Kept by a person on 2026-10-21 02:40");
    await expect(pane.getByRole("button", { name: "Drop again" })).toBeDisabled();
    await expect(page.locator(".record-main")).toContainText("Note: kept by person");
  });

  test("Keep this role stores a keep decision, shows Kept (pending next run), and Drop again removes it", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await fakeDb(page, { writable: true });
    await page.goto(url({ store: "db", hash: DROPPED }));
    const pane = page.locator(".record-pane");
    await expect(pane).toContainText("Dropped: not in title_keywords");
    await pane.getByRole("button", { name: "Keep this role" }).click();
    await expect(pane.locator("section").first()).toContainText("Kept (pending next run)");
    await expect(page.locator(".record-main > p.fields")).toContainText("Kept (pending next run)");
    await expect(pane).toContainText("A keep is recorded now. Applies from the next run, which keeps this record active.");
    let writes = await page.evaluate(() => window.__deskWrites);
    expect(writes.map((w) => [w.op, w.path])).toEqual([["set", "decisions/" + DROPPED_ID]]);
    expect(writes[0].data.decision).toBe("keep");
    expect(writes[0].data.by).toBe("u_test");
    expect(writes[0].data.at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d/);
    await pane.getByRole("button", { name: "Drop again" }).click();
    await expect(pane.getByRole("button", { name: "Keep this role" })).toBeVisible();
    writes = await page.evaluate(() => window.__deskWrites);
    expect(writes.map((w) => [w.op, w.path])).toEqual([["set", "decisions/" + DROPPED_ID], ["delete", "decisions/" + DROPPED_ID]]);
  });

  test("Browse offers Restore on a dropped row and shows it kept pending", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await fakeDb(page, { writable: true });
    await page.goto(url({ store: "db", hash: "#/browse/role?status=dropped&q=00049" }));
    const row = page.locator("table tbody tr").first();
    await row.getByRole("button", { name: "Restore" }).click();
    await expect(row).toContainText("Kept (pending next run)");
    const writes = await page.evaluate(() => window.__deskWrites);
    expect(writes.map((w) => [w.op, w.path, w.data && w.data.decision])).toEqual([["set", "decisions/" + DROPPED_ID, "keep"]]);
  });
});

test.describe("Browse timings", () => {
  test.use({ viewport: { width: 1280, height: 800 }, colorScheme: "light" });
  test.describe.configure({ mode: "serial" });
  const perf = {};
  test.afterAll(() => writeFileSync(join(OUT, "perf.json"), JSON.stringify(perf, null, 2) + "\n"));

  for (const [n, limit] of [[1000, 300], [5000, 1000]]) {
    test(`Browse at ${n} roles`, async ({ page }) => {
      await page.goto(url({ snap: "perf-" + n, hash: "#/today" }));
      await expect(page.locator("#outlet h1").first()).toHaveText("Today");
      const got = await page.evaluate(async () => {
        const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const until = (fn) => new Promise((resolve) => {
          const obs = new MutationObserver(() => { if (fn()) { obs.disconnect(); resolve(); } });
          obs.observe(document.body, { subtree: true, childList: true, characterData: true });
          if (fn()) { obs.disconnect(); resolve(); }
        });
        const count = () => (document.querySelector(".count") || {}).textContent || "";
        let t0 = performance.now();
        location.hash = "#/browse/role";
        await until(() => /^Showing /.test(count()));
        await frames();
        const first = performance.now() - t0;
        const before = count();
        const label = [...document.querySelectorAll("label.field")].find((l) => (l.querySelector("span") || {}).textContent === "Market");
        const select = label.querySelector("select");
        t0 = performance.now();
        select.value = "NZ";
        select.dispatchEvent(new Event("change", { bubbles: true }));
        await until(() => count() !== before);
        await frames();
        return { firstRenderMs: Math.round(first), filterChangeMs: Math.round(performance.now() - t0), count: count() };
      });
      perf["roles-" + n] = got;
      expect(got.count).toMatch(new RegExp("\\(" + n + " in all\\)"));
      expect(got.firstRenderMs).toBeLessThan(limit);
      expect(got.filterChangeMs).toBeLessThan(limit);
    });
  }
});
