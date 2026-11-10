// Desk v2 pages on the Mantine Desk: every V2_ROUTES entry (routes-v2.mjs) at 390, 1024 and 1280 px in light and
// dark, plus the v2 behaviours that write (approvals undo, comments, owner PIN) and the lock, boot error and offline
// states. Selectors are roles and labels. Run with: bash tests/visual/run.sh.
import { test as base, expect } from "@playwright/test";
import { pbkdf2Sync } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { start, deskUrl } from "./serve.mjs";
import { fakeClaude } from "./fake-claude.mjs";
import { V2_ROUTES } from "./routes-v2.mjs";
import { noHorizontalScroll } from "./layout.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = process.env.DESK_SHOTS || join(HERE, "out", "shots");
mkdirSync(SHOTS, { recursive: true });

const SIZES = [{ width: 390, height: 844 }, { width: 1024, height: 768 }, { width: 1280, height: 800 }];
const THEMES = ["light", "dark"];
const NOW = new Date("2026-10-28T00:00:00Z");
const ROLE3 = "#/entity/role/https-jobs-example-au-00003";
const ROLE3_ID = "role--https-jobs-example-au-00003";
const SUBMIT = process.platform === "darwin" ? "Meta+Enter" : "Control+Enter";

let server;
let origin;

// As in desk.spec.mjs: a console error, page error, dialog or request off the local server fails the test.
const test = base.extend({
  guard: [async ({ page }, use) => {
    await page.clock.setFixedTime(NOW);
    const problems = [];
    const g = { allow: null };
    page.on("console", (m) => { if (m.type() === "error" && !(g.allow && g.allow.test(m.text()))) problems.push("console: " + m.text()); });
    page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
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

function url(route) {
  const snap = route.snap || "v2";
  const q = new URLSearchParams({ store: snap === "v2" ? "db" : "static" });
  if (snap !== "v2") q.set("snapshot", "/snap/" + snap + ".json");
  return deskUrl(origin, q, route.hash);
}

// Opens a route: v2 routes run on the stand-in runtime (fake-claude.mjs), the others on the static store.
async function open(page, route) {
  if ((route.snap || "v2") === "v2") {
    await fakeClaude(page, { viewer: route.viewer === undefined ? "u_owner" : route.viewer, owner: !!route.owner,
      writable: !!route.writable, canWrite: route.canWrite, extra: route.extra, failDocs: route.failDocs, failCollections: route.failCollections });
  }
  await page.goto(url(route));
}

function main(page) { return page.getByRole("main"); }
const writes = (page) => page.evaluate(() => window.__deskWrites);

// Visible buttons, links and fields with no accessible name.
function unnamedControls(page) {
  return page.evaluate(() => [...document.querySelectorAll("button, a[href], [role=button], input, textarea, select")]
    .filter((n) => n.type !== "hidden" && n.getClientRects().length && getComputedStyle(n).visibility !== "hidden")
    .filter((n) => !(n.getAttribute("aria-label") || n.getAttribute("aria-labelledby") || n.getAttribute("title")
      || (n.labels && n.labels.length) || n.textContent.trim()))
    .map((n) => n.outerHTML.slice(0, 160)));
}

for (const route of V2_ROUTES) {
  for (const size of SIZES) {
    for (const theme of THEMES) {
      test.describe(`${size.width}px ${theme}`, () => {
        test.use({ viewport: size, colorScheme: theme });
        test(`v2 ${route.key}`, async ({ page }) => {
          await open(page, route);
          const h1 = main(page).getByRole("heading", { level: 1 });
          await expect(h1).toHaveCount(1);
          await expect(main(page)).not.toContainText(/needs the db capability|could not/);
          await expect(page.getByRole("main")).toHaveCount(1);
          expect(await page.getByRole("navigation").count()).toBeGreaterThan(0);
          await expect(page.locator("[aria-busy=true]")).toHaveCount(0);
          expect(await unnamedControls(page)).toEqual([]);
          await noHorizontalScroll(page);
          await page.screenshot({ path: join(SHOTS, `v2-${route.key}-${size.width}-${theme}.png`), fullPage: true });
        });
      });
    }
  }
}

test.describe("v2 lock", () => {
  for (const size of SIZES) {
    test(`the lock hides the Desk, refuses a wrong PIN and opens on the right one (${size.width})`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto(url({ snap: "lock", hash: "#/today" }));
      const pin = page.getByLabel("PIN");
      await expect(pin).toBeVisible();
      await expect(page.getByRole("navigation")).toHaveCount(0);
      await expect(main(page)).toContainText("Forgot the PIN? Ask the owner to remove it in Settings.");
      await expect(pin).toHaveAttribute("type", "password");
      await expect(pin).toHaveAttribute("inputmode", "numeric");
      await expect(pin).toHaveAttribute("maxlength", "6");
      await pin.fill("111111");
      await pin.press("Enter");
      await expect(main(page)).toContainText("That PIN is not right.");
      await pin.fill("12");
      await page.getByRole("button", { name: "Open the Desk" }).click();
      await expect(main(page)).toContainText("Enter the six digits of the PIN.");
      await noHorizontalScroll(page);
      await page.screenshot({ path: join(SHOTS, `v2-lock-${size.width}.png`) });
      await pin.fill("246810");
      await pin.press("Enter");
      await expect(page.getByLabel("PIN")).toHaveCount(0);
      await expect(main(page).getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("navigation", { name: "Desk" })).toHaveCount(1);
      await noHorizontalScroll(page);
      await page.reload();
      await expect(main(page).getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByLabel("PIN")).toHaveCount(0);
    });
  }
});

test.describe("v2 boot error and offline", () => {
  for (const size of SIZES) {
    // The Mantine Desk draws the boot error as an alert in main (recon 1.2: Alert + retry), inside the shell.
    test(`a boot read failure shows the error in plain words with Try again (${size.width})`, async ({ page }) => {
      await page.setViewportSize(size);
      await open(page, { hash: "#/today", failDocs: /.*/, failCollections: /.*/ });
      const alert = main(page).getByRole("alert", { name: "Could not read the workspace" });
      await expect(alert).toBeVisible();
      await expect(alert).toContainText("The Desk could not start.");
      await expect(alert).toContainText("forced read failure");
      await expect(alert.getByRole("button", { name: "Try again" })).toBeVisible();
      await noHorizontalScroll(page);
      await page.screenshot({ path: join(SHOTS, `v2-boot-error-${size.width}.png`) });
    });
  }
  test("going offline shows the banner and coming back clears it", async ({ page, context }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, { hash: "#/today", owner: true });
    await expect(main(page).getByRole("heading", { level: 1 })).toHaveCount(1);
    const banner = page.getByRole("status").filter({ hasText: "You are offline. Changes are paused." });
    await expect(banner).toHaveCount(0);
    await context.setOffline(true);
    await expect(banner).toBeVisible();
    await page.screenshot({ path: join(SHOTS, "v2-offline-1280.png") });
    await context.setOffline(false);
    await expect(banner).toHaveCount(0);
  });
});

test.describe("v2 writes at 1280px", () => {
  test.use({ viewport: { width: 1280, height: 800 }, colorScheme: "light" });

  test("approve with a note writes the note; Undo deletes the decision", async ({ page }) => {
    const GATE = "jobs-watch-20261027--g1";
    await open(page, { hash: "#/approvals", owner: true, writable: true });
    // The card is the element the Approvals page tags with the request id (the same hook the Vitest parity uses).
    const card = page.locator(`[data-id="${GATE}"]`);
    await card.getByRole("button", { name: "Add note" }).click();
    await card.getByRole("textbox", { name: "Note for the routine" }).fill("Send after nine");
    await card.getByRole("button", { name: "Approve with instructions" }).click();
    await expect.poll(async () => (await writes(page)).length).toBe(1);
    expect((await writes(page))[0]).toMatchObject({ op: "set", path: "decisions/" + GATE,
      data: { decision: "approve", note: "Send after nine", by: "u_owner" } });
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => (await writes(page)).length).toBe(2);
    expect((await writes(page))[1]).toMatchObject({ op: "delete", path: "decisions/" + GATE });
    await expect(page.locator(`[data-id="${GATE}"]`)).toBeVisible();
  });

  test("posting a comment writes one comments doc", async ({ page }) => {
    await open(page, { hash: ROLE3, owner: true, writable: true });
    await expect(main(page)).toContainText("Agreed. I will check the salary band first.");
    const box = main(page).getByRole("textbox", { name: "Comment" });
    await box.fill("Shortlisted for Friday.");
    await box.press(SUBMIT);
    await expect(main(page)).toContainText("Shortlisted for Friday.");
    const w = await writes(page);
    expect(w.length).toBe(2);
    expect(w[0]).toMatchObject({ op: "set", path: "people/u_owner" });
    expect(w[1].op).toBe("set");
    expect(w[1].path).toMatch(new RegExp("^people/u_owner/comments/" + ROLE3_ID + "--[0-9a-z]+$"));
    expect(Object.keys(w[1].data).sort()).toEqual(["at", "text"]);
    expect(w[1].data).toMatchObject({ text: "Shortlisted for Friday." });
  });

  // A Commenter (user.can("data.write") false). The refusal of writes is the harness's model, so this proves the Desk's
  // behaviour, not the platform's.
  test("a Commenter sees write controls and the comment box disabled with the reason, and nothing is written", async ({ page }) => {
    await open(page, { hash: ROLE3, viewer: "u_member", writable: true, canWrite: false });
    await expect(main(page)).toContainText("Agreed. I will check the salary band first.");
    await expect(main(page).locator("fieldset[disabled]").first()).toBeVisible();
    await expect(main(page).locator("[title='Saving needs Contributor access or above']").first()).toBeVisible();
    await expect(main(page).getByRole("textbox", { name: "Comment" })).toBeDisabled();
    expect(await writes(page)).toEqual([]);
  });

  test("a visit without a viewer has no comment box", async ({ page }) => {
    await open(page, { hash: ROLE3, viewer: null });
    await expect(main(page)).toContainText("Agreed. I will check the salary band first.");
    await expect(main(page).getByRole("textbox", { name: "Comment" })).toHaveCount(0);
  });

  test("Members lists the owner with (you) and the member, each with a role", async ({ page }) => {
    await open(page, { hash: "#/settings/members", owner: true });
    const rows = main(page).getByRole("table").getByRole("row").filter({ has: page.getByRole("cell") });
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("Robin Vale (you)");
    await expect(rows.nth(0)).toContainText("Owner");
    await expect(rows.nth(1)).toContainText("Kit Marlow");
    await expect(rows.nth(1)).toContainText("Member");
  });

  test("the owner sets the PIN: meta/lock holds a PBKDF2 hash of it", async ({ page }) => {
    await open(page, { hash: "#/settings/lock", owner: true, writable: true });
    const lockWrites = async () => (await writes(page)).filter((x) => x.path === "meta/lock");
    await expect(main(page)).toContainText("No PIN is set.");
    await page.getByLabel("New PIN (6 digits)").fill("135790");
    await page.getByLabel("Repeat the PIN").fill("135791");
    await page.getByRole("button", { name: "Set PIN" }).click();
    await expect(main(page)).toContainText("The two PINs do not match.");
    expect(await lockWrites()).toEqual([]);
    await page.getByLabel("Repeat the PIN").fill("135790");
    await page.getByRole("button", { name: "Set PIN" }).click();
    await expect(main(page)).toContainText("A PIN is set.");
    const [w] = await lockWrites();
    expect(w.op).toBe("set");
    expect(Object.keys(w.data).sort()).toEqual(["algo", "hash", "iterations", "salt", "setAt", "setBy"]);
    expect(w.data).toMatchObject({ iterations: 310000, algo: "PBKDF2-SHA-256", setBy: "u_owner" });
    expect(w.data.hash).toBe(pbkdf2Sync("135790", Buffer.from(w.data.salt, "hex"), 310000, 32, "sha256").toString("hex"));
    await expect(page.getByLabel("PIN", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Remove PIN" }).click();
    const confirm = page.getByRole("button", { name: "Remove the PIN" });
    await expect(confirm).toBeDisabled();
    await page.getByLabel("Type remove to take the PIN off").fill("remove");
    await confirm.click();
    await expect(main(page)).toContainText("No PIN is set.");
    expect((await lockWrites()).map((x) => x.op)).toEqual(["set", "delete"]);
  });
});
