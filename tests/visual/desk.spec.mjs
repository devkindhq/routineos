// Playwright checks for the Mantine Desk: the committed single-file page on the static store and on a stand-in db
// (fake-claude.mjs). Selectors are roles and labels. Run with: bash tests/visual/run.sh. Screenshots go to
// $DESK_SHOTS (default tests/visual/out/shots) and are not committed.
import { test as base, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { start, HOSTILE, HOSTILE_ID, deskUrl } from "./serve.mjs";
import { fakeClaude } from "./fake-claude.mjs";
import { noHorizontalScroll, tableFits as fitsTable } from "./layout.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = process.env.DESK_SHOTS || join(HERE, "out", "shots");
mkdirSync(SHOTS, { recursive: true });

const SIZES = [{ width: 390, height: 844 }, { width: 1024, height: 768 }, { width: 1280, height: 800 }];
const THEMES = ["light", "dark"];

// Routes from recon 1.1, each with text its page must show on the demo snapshot.
const PAGES = [
  ["today", "#/today", /parsed 2 of 3/],
  ["approvals", "#/approvals", /Introduction about the/],
  ["approvals-proposals", "#/approvals?kind=proposals", /Add GB to markets/],
  ["browse-roles", "#/browse/role", /Roles/],
  ["browse-companies", "#/browse/company", /Companies/],
  ["entity-company-merged", "#/entity/company/ithfax-home-example", /Jobs watch, Lead signals/],
  ["entity-role-dropped", "#/entity/role/https-jobs-example-au-00049", /Dropped: not in title_keywords/],
  ["entity-role-active", "#/entity/role/https-jobs-example-au-00003", /Owns the headless commerce architecture/],
  ["entity-role-kept", "#/entity/role/https-jobs-example-au-00174", /Kept by a person, Oct 21\b/],
  ["entity-role-kept-pending", "#/entity/role/https-jobs-example-de-00323", /Kept \(pending next run\)/],
  ["history", "#/history", /Jobs watch/],
  ["history-calendar", "#/history?mode=cal", /Jobs watch|Mon/],
  ["runs", "#/runs", /Jobs watch/],
  ["run-partial", "#/runs/jobs-watch-20261027", /2 of 3/],
  ["workers", "#/workers", /Workers/],
  ["settings-appearance", "#/settings/appearance", /Theme/],
  ["settings-views", "#/settings/views", /Remote roles this month/],
  ["settings-routine", "#/settings/routine", /Jobs watch/],
  ["settings-shortcuts", "#/settings/shortcuts", /palette/i],
  ["settings-about", "#/settings/about", /About/],
];

// States from recon 1.2 (the lazy-loading and CDN states went with the split build).
const STATES = [
  ["not-set-up", { snap: "empty" }, /is not set up yet/],
  ["first-run", { snap: "first-run" }, /Nothing has run yet/],
  ["loading", { snap: "slow" }, /Loading the workspace/],
  ["read-error", { snap: "missing", allow: /404/ }, /The Desk could not start/],
  ["browse-read-error", { store: "db", fakeDb: true, hash: "#/browse/role" }, /Try again/],
  ["no-db", { store: "db" }, /needs the db capability/],
  ["empty-filter", { hash: "#/browse/role?q=no-such-role-anywhere" }, /No Roles match these filters/],
];

let server;
let origin;

// Every test fails on a console error, a page error, a dialog or a request that leaves the local server (data: and
// blob: URLs stay local). Pages run at a fixed time (timers still run), in en-US and UTC, so dates do not drift.
const NOW = new Date("2026-10-28T00:00:00Z");
const test = base.extend({
  guard: [async ({ page }, use) => {
    await page.clock.setFixedTime(NOW);
    const problems = [];
    const g = { allow: null, pageerror: null };
    page.on("console", (m) => { if (m.type() === "error" && !(g.allow && g.allow.test(m.text()))) problems.push("console: " + m.text()); });
    page.on("pageerror", (e) => { if (!(g.pageerror && g.pageerror.test(e.message))) problems.push("pageerror: " + e.message); });
    page.on("dialog", (d) => { problems.push("dialog: " + d.message()); d.dismiss(); });
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.protocol === "data:" || u.protocol === "blob:") return;
      if (u.origin !== origin) problems.push("request: " + r.url());
    });
    await use(g);
    expect(problems).toEqual([]);
  }, { auto: true }],
});

test.use({ timezoneId: "UTC", locale: "en-US" });

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
  if (o.bundle) q.set("bundle", o.bundle);
  return deskUrl(origin, q, o.hash || "#/today");
}

// The artifact runtime on the demo snapshot. Read only: every read of `entities` fails and there is no viewer.
// With writable, reads succeed, writes land in window.__deskWrites and the viewer is u_test.
function fakeDb(page, opts = {}) {
  return fakeClaude(page, { snapshot: "/snap/demo.json", writable: !!opts.writable,
    viewer: opts.writable ? "u_test" : null, failCollections: opts.writable ? null : /^entities$/ });
}

function main(page) { return page.getByRole("main"); }
function sidebar(page) { return page.getByRole("navigation", { name: "Desk" }); }

// The Browse table and every scrolling box around it fit their width (layout.mjs settles and polls).
function tableFits(page) {
  return fitsTable(main(page).getByRole("table").first());
}

async function navForWidth(page, width) {
  if (width < 768) {
    await expect(page.getByRole("button", { name: "Toggle navigation" })).toBeVisible();
    await expect(sidebar(page)).not.toBeInViewport();
  } else {
    await expect(sidebar(page)).toBeInViewport();
    await expect(page.getByRole("button", { name: "Toggle navigation" })).toBeHidden();
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
      for (const [name, hash, text] of PAGES) {
        test(`page ${name}`, async ({ page }) => {
          await page.goto(url({ hash }));
          await expect(main(page)).toContainText(text);
          await expect(main(page).getByRole("heading", { level: 1 })).toHaveCount(1);
          await navForWidth(page, size.width);
          await backgroundMatches(page, theme);
          await noHorizontalScroll(page);
          if (name.startsWith("browse-") && size.width >= 1024) await tableFits(page);
          await shot(page, `${name}-${size.width}-${theme}`);
        });
      }
    });
  }
  test.describe(`${size.width}px states`, () => {
    test.use({ viewport: size, colorScheme: "light" });
    for (const [name, o, text] of STATES) {
      test(`state ${name}`, async ({ page, guard }) => {
        if (o.allow) guard.allow = o.allow;
        if (o.fakeDb) await fakeDb(page);
        await page.goto(url({ snap: o.snap, store: o.store, hash: o.hash }));
        await expect(page.locator("body")).toContainText(text);
        await noHorizontalScroll(page);
        await shot(page, `state-${name}-${size.width}`);
      });
    }
  });
}

// The layout checks read the settled page: a page that is wide for its first frames and then fits passes, and one
// that stays wide still fails (reviewer HIGH-1).
test.describe("layout checks settle", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  const late = (ms) => `<main><div id="w" style="width:2000px;height:10px"></div><div style="overflow-x:auto"><table id="t"><tr><td>
    <div id="c" style="width:2000px">x</div></td></tr></table></div></main><script>setTimeout(() => {
    document.getElementById("w").style.width = "10px"; document.getElementById("c").style.width = "10px"; }, ${ms});</script>`;

  test("a page that settles narrow after a reflow passes", async ({ page }) => {
    await page.setContent(late(400));
    await noHorizontalScroll(page);
    await fitsTable(page.locator("#t"));
  });

  test("a page that stays wide fails", async ({ page }) => {
    await page.setContent(late(1e9));
    await expect(noHorizontalScroll(page)).rejects.toThrow(/horizontal page scroll/);
    await expect(fitsTable(page.locator("#t"))).rejects.toThrow(/horizontal scroll inside the Browse table/);
  });
});

test.describe("Desk behaviour at 1280px", () => {
  test.use({ viewport: { width: 1280, height: 800 }, colorScheme: "light" });

  test("old addresses redirect to their v2 page", async ({ page }) => {
    for (const [from, to] of [
      ["#/inbox", /#\/approvals$/],
      ["#/suggestions", /#\/approvals\?kind=proposals$/],
      ["#/views", /#\/settings\/views$/],
      ["#/history/jobs-watch-20261027", /#\/runs\/jobs-watch-20261027$/],
      ["#/settings?section=about", /#\/settings\/about$/],
    ]) {
      await page.goto(url({ hash: from }));
      await expect(page).toHaveURL(to);
      await expect(main(page).getByRole("heading", { level: 1 })).toHaveCount(1);
    }
  });

  test("Ctrl K opens the palette, typing filters it and Enter goes to the page", async ({ page }) => {
    await page.goto(url({ hash: "#/today" }));
    await expect(main(page)).toContainText(/parsed 2 of 3/);
    await page.keyboard.press("Control+k");
    const search = page.getByRole("dialog").getByRole("textbox").first();
    await expect(search).toBeVisible();
    await search.fill("Approvals");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#\/approvals/);
  });

  test("g then i goes to Approvals, and ? lists the shortcuts", async ({ page }) => {
    await page.goto(url({ hash: "#/today" }));
    await expect(main(page)).toContainText(/parsed 2 of 3/);
    await page.keyboard.press("g");
    await page.keyboard.press("i");
    await expect(page).toHaveURL(/#\/approvals/);
    await page.keyboard.press("Shift+?");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/palette/i);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("[ toggles the sidebar and / focuses the Browse search", async ({ page }) => {
    await page.goto(url({ hash: "#/browse/role" }));
    await expect(main(page).getByRole("table").first()).toBeVisible();
    await expect(sidebar(page)).toBeInViewport();
    await page.keyboard.press("[");
    await expect(sidebar(page)).not.toBeInViewport();
    await page.keyboard.press("[");
    await expect(sidebar(page)).toBeInViewport();
    await page.keyboard.press("/");
    await expect.poll(() => page.evaluate(() => document.activeElement && document.activeElement.tagName)).toBe("INPUT");
  });

  test("a stored <img onerror> title renders as text", async ({ page }) => {
    for (const hash of ["#/entity/role/" + HOSTILE_ID.slice("role--".length), "#/browse/role?q=onerror"]) {
      await page.goto(url({ snap: "hostile", hash }));
      await expect(main(page)).toContainText(HOSTILE);
      await expect(main(page).locator("img[src=x]")).toHaveCount(0);
    }
  });

  test("Approve on a writable store offers Undo, and Undo puts the request back", async ({ page }) => {
    await fakeDb(page, { writable: true });
    await page.goto(url({ store: "db", hash: "#/approvals" }));
    await expect(main(page).getByRole("button", { name: "Approve" }).first()).toBeVisible();
    const count = await main(page).getByRole("button", { name: "Approve" }).count();
    await main(page).getByRole("button", { name: "Approve" }).first().click();
    await expect.poll(() => page.evaluate(() => window.__deskWrites.length)).toBe(1);
    const first = (await page.evaluate(() => window.__deskWrites))[0];
    expect(first).toMatchObject({ op: "set", data: { decision: "approve" } });
    expect(first.path).toMatch(/^decisions\//);
    await page.getByRole("button", { name: "Undo" }).first().click();
    await expect.poll(() => page.evaluate(() => window.__deskWrites.length)).toBe(2);
    expect((await page.evaluate(() => window.__deskWrites))[1]).toMatchObject({ op: "delete", path: first.path });
    await expect(main(page).getByRole("button", { name: "Approve" })).toHaveCount(count);
  });

  test("on the static store Browse offers no Star or Save view and says it is read only", async ({ page }) => {
    await page.goto(url({ hash: "#/browse/role" }));
    await expect(main(page).getByRole("table").first()).toBeVisible();
    await expect(main(page).getByRole("button", { name: /^Star / })).toHaveCount(0);
    await expect(main(page).getByRole("button", { name: "Save view" })).toHaveCount(0);
    await expect(page.locator("body")).toContainText(/Changes cannot be saved on this page/);
  });
});

test.describe("Member and owner views", () => {
  test.use({ viewport: { width: 1280, height: 800 }, colorScheme: "light" });

  test("a member sees the PIN as owner only", async ({ page }) => {
    await fakeClaude(page, { writable: true, viewer: "u_member", owner: false });
    await page.goto(url({ store: "db", hash: "#/settings/lock" }));
    await expect(main(page)).toContainText("Only the owner can set, change or remove the PIN.");
    await expect(main(page).getByLabel("New PIN (6 digits)")).toHaveCount(0);
  });

  test("the owner gets the PIN form", async ({ page }) => {
    await fakeClaude(page, { writable: true, viewer: "u_owner", owner: true });
    await page.goto(url({ store: "db", hash: "#/settings/lock" }));
    await expect(main(page).getByLabel("New PIN (6 digits)")).toBeVisible();
  });
});

test.describe("Export through the downloads capability", () => {
  test.use({ viewport: { width: 1280, height: 800 }, colorScheme: "light" });

  async function openExport(page) {
    await page.goto(url({ store: "db", hash: "#/browse/role" }));
    await expect(main(page).getByRole("table").first()).toBeVisible();
    await main(page).getByRole("button", { name: "Export", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Export Roles" });
    await expect(dialog).toBeVisible();
    return dialog;
  }

  test("Download saves the shown CSV once through claude.use(\"downloads\").save", async ({ page }) => {
    await fakeClaude(page, { snapshot: "/snap/demo.json", viewer: null, downloads: "save" });
    const dialog = await openExport(page);
    const data = await dialog.getByRole("textbox", { name: "Export data" }).inputValue();
    expect(data).toContain("Title");
    await dialog.getByRole("button", { name: "Download" }).click();
    await expect(dialog.getByRole("status")).toContainText(/^Saved .+\.csv\.$/);
    const saves = await page.evaluate(() => window.__deskSaves);
    expect(saves.length).toBe(1);
    expect(saves[0].filename).toMatch(/^[a-z0-9-]+-roles-2026-10-28\.csv$/);
    expect(saves[0].type).toBe("string");
    // A textarea reports CSV line ends (CRLF) as LF; the saved data keeps CRLF.
    expect(saves[0].data).toContain("\r\n");
    expect(saves[0].data.replace(/\r\n/g, "\n")).toBe(data);
  });

  test("a declined save says Not saved and the data stays in the box", async ({ page }) => {
    await fakeClaude(page, { snapshot: "/snap/demo.json", viewer: null, downloads: "decline" });
    const dialog = await openExport(page);
    const data = await dialog.getByRole("textbox", { name: "Export data" }).inputValue();
    await dialog.getByRole("button", { name: "Download" }).click();
    await expect(dialog.getByRole("status")).toHaveText("Not saved.");
    expect((await page.evaluate(() => window.__deskSaves)).length).toBe(1);
    await expect(dialog.getByRole("textbox", { name: "Export data" })).toHaveValue(data);
    expect(data.length).toBeGreaterThan(0);
  });

  test("without the downloads capability Export offers Copy and no Download", async ({ page }) => {
    await fakeClaude(page, { snapshot: "/snap/demo.json", viewer: null });
    const dialog = await openExport(page);
    await expect(dialog.getByRole("button", { name: "Copy" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Download" })).toHaveCount(0);
  });
});

test.describe("Custom field components", () => {
  test.use({ viewport: { width: 1280, height: 800 }, colorScheme: "light" });

  test("the module page draws the salary band through its component and sits in the sidebar", async ({ page }) => {
    await page.goto(url({ snap: "desk", bundle: "desk", hash: "#/m/senior-pay" }));
    await expect(main(page).getByRole("table").first()).toBeVisible();
    await expect(main(page)).toContainText(/\d+ to \d+/);
    await expect(sidebar(page).getByRole("link", { name: /Senior pay/ })).toBeVisible();
    await noHorizontalScroll(page);
    await tableFits(page);
  });

  test("without the bundle the salary band falls back to plain text", async ({ page }) => {
    await page.goto(url({ snap: "desk", hash: "#/m/senior-pay" }));
    await expect(main(page).getByRole("table").first()).toBeVisible();
    await expect(main(page)).not.toContainText(/\d+ to \d+/);
  });

  test("a broken component and a const el component cost only themselves", async ({ page, guard }) => {
    guard.pageerror = /Unexpected token/;
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url({ snap: "desk", bundle: "bad-components", hash: "#/m/senior-pay" }));
    await expect(main(page).getByRole("table").first()).toBeVisible();
    await expect(main(page)).toContainText(/\d+ to \d+/);
    expect(await page.evaluate(() => Object.keys(window.DESK_COMPONENTS).sort())).toEqual(["salary-band", "shadow-el"]);
    expect(errors.length, errors.join("; ")).toBe(1);
    expect(errors[0]).toMatch(/Unexpected token/);
  });
});

test.describe("Phone shell at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 }, colorScheme: "light" });

  test("the menu opens the sidebar and a link goes to the page", async ({ page }) => {
    await page.goto(url({ hash: "#/today" }));
    await expect(main(page)).toContainText(/parsed 2 of 3/);
    await page.getByRole("button", { name: "Toggle navigation" }).click();
    await expect(sidebar(page)).toBeInViewport();
    await sidebar(page).getByRole("link", { name: /Approvals/ }).first().click();
    await expect(page).toHaveURL(/#\/approvals/);
    await expect(main(page)).toContainText(/Introduction about the/);
    await noHorizontalScroll(page);
  });
});
