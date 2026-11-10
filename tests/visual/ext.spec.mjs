// Desk extensions: an agent-written record section, panel and page render in the real build (tests/desk_fixtures/ext),
// a decision verb writes one decisions/<id>~x doc. That a verb the manifest did not declare does not exist is covered in
// skills/routineos/assets/desk/test/exthost.test.jsx and tests/visual/ext.test.mjs, not here.
// Run with: bash tests/visual/run.sh (DESK_SPECS="ext.spec.mjs" for this file alone).
import { test as base, expect } from "@playwright/test";
import { start, deskUrl } from "./serve.mjs";
import { fakeClaude } from "./fake-claude.mjs";

const NOW = new Date("2026-10-28T00:00:00Z");
const ROLE3 = "#/entity/role/https-jobs-example-au-00003";
const ROLE3_ID = "role--https-jobs-example-au-00003";

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
  }, { auto: true }],
});

test.use({ timezoneId: "UTC", locale: "en-US" });
test.beforeAll(async () => {
  server = await start();
  origin = "http://127.0.0.1:" + server.address().port;
});
test.afterAll(async () => { await new Promise((r) => server.close(r)); });

async function open(page, hash, opts = {}) {
  await fakeClaude(page, { viewer: "viewer" in opts ? opts.viewer : "u_owner", owner: true, writable: true });
  await page.goto(deskUrl(origin, new URLSearchParams({ store: "db", bundle: "ext" }), hash));
}
const main = (page) => page.getByRole("main");
const writes = (page) => page.evaluate(() => window.__deskWrites);

test("the section on a role record: Approve writes one decision doc, and the section shows it", async ({ page }) => {
  await open(page, ROLE3);
  await expect(main(page)).toContainText("No review yet");
  await main(page).getByRole("textbox", { name: "Reviewer note" }).fill("Looks right");
  await main(page).getByRole("button", { name: "Approve" }).click();
  await expect.poll(async () => (await writes(page)).length).toBe(1);
  expect((await writes(page))[0]).toMatchObject({ op: "set", path: "decisions/" + ROLE3_ID + "~x",
    data: { decision: "approved", note: "Looks right", entity: ROLE3_ID, by: "u_owner" } });
  await expect(main(page)).toContainText("Review: approved");
  // The built-in keep or drop doc is not touched.
  expect((await writes(page)).some((w) => w.path === "decisions/" + ROLE3_ID)).toBe(false);
});

test("ui.markdown in a section: headings are headings, marks are highlighted, no literal markers", async ({ page }) => {
  await open(page, ROLE3);
  const box = main(page).getByLabel("Rendered notes");
  await expect(box.getByRole("heading", { name: "Reviewer notes" })).toBeVisible();
  await expect(box).not.toContainText("##");
  await expect(box).not.toContainText("**");
  await expect(box.locator("mark")).toHaveText(["band", "Band"]);
  await expect(box.locator("li")).toHaveCount(2);
});

test("the section's Add comment writes one comments doc", async ({ page }) => {
  await open(page, ROLE3);
  await main(page).getByRole("textbox", { name: "Reviewer note" }).fill("Check the band");
  await main(page).getByRole("button", { name: "Add comment" }).click();
  await expect.poll(async () => (await writes(page)).length).toBe(1);
  const w = (await writes(page))[0];
  expect(w.path).toMatch(/^comments\/ext~[0-9a-z]+~[0-9a-f]{12}$/);
  expect(w.data).toMatchObject({ entity: ROLE3_ID, text: "Check the band" });
});

test("a visit with no signed-in viewer: the write buttons are disabled and nothing is written", async ({ page }) => {
  await open(page, ROLE3, { viewer: null });
  const approve = main(page).getByRole("button", { name: "Approve" });
  await expect(approve).toBeDisabled();
  await expect(approve).toHaveAttribute("title", /not available/);
  expect(await writes(page)).toEqual([]);
});

test("the panel appears on Today with records of its view", async ({ page }) => {
  await open(page, "#/today");
  await expect(main(page).getByText("To review")).toBeVisible();
  await expect(main(page)).toContainText(/\d+ to review/);
});

test("the page opens at #/x/review-page, shows in the sidebar, and its button writes a decision", async ({ page }) => {
  await open(page, "#/x/review-page");
  await expect(main(page)).toContainText(/\d+ records in the queue/);
  await main(page).getByRole("button", { name: "Approve first" }).click();
  await expect.poll(async () => (await writes(page)).length).toBe(1);
  const w = (await writes(page))[0];
  expect(w.op).toBe("set");
  expect(w.path).toMatch(/^decisions\/role--.+~x$/);
  expect(w.data.decision).toBe("approved");
  await expect(page.getByRole("link", { name: "Review queue" }).first()).toBeVisible();
});

test("an unknown extension page shows a not-found card, not a blank page", async ({ page }) => {
  await open(page, "#/x/nothing-here");
  await expect(main(page)).toContainText(/not (found|available)|No page/i);
});
