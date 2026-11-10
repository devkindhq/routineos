// The Verify walk fixture (tests/desk_fixtures/v2-walk.json) drawn by the real Desk: these check what a person sees,
// not what the JSON holds (the Python tests cover the data).
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import App from "../app/App.jsx";
import { createStore } from "../core/store.js";

var HERE = dirname(fileURLToPath(import.meta.url));
var WALK = join(HERE, "..", "..", "..", "..", "..", "tests", "desk_fixtures", "v2-walk.json");
var ROLE = "role--https-jobs-example-au-00003";

function store() { return createStore("static", { docs: JSON.parse(readFileSync(WALK, "utf8")) }); }

async function mount(hash) {
  window.history.replaceState(null, "", hash);
  render(<App store={store()} config={{ store: "static", workspace: "Walk" }} />);
}

beforeEach(() => { try { localStorage.clear(); } catch (e) { /* blocked */ } });
afterEach(() => { cleanup(); window.history.replaceState(null, "", "#/today"); });

test("Approvals draws the queued banner for the walk's one pending request", async () => {
  await mount("#/approvals");
  expect(await screen.findByText(/^1 queued for next run/)).toBeTruthy();
});

test("Runs draws the optional columns and the cost card because a walk run carries them", async () => {
  await mount("#/runs");
  await screen.findByRole("row", { name: /jobs-watch-20261029/ });
  ["Captured", "Failed", "New reds", "Cost"].forEach((h) => expect(screen.getByRole("columnheader", { name: h })).toBeTruthy());
  expect(screen.getByText("Cost of latest runs")).toBeTruthy();
  // A run without those numbers leaves the cells empty rather than drawing zeros.
  var plain = screen.getByRole("row", { name: /jobs-watch-20261028/ });
  var cells = within(plain).getAllByRole("cell");
  expect(cells[cells.length - 1].textContent).toBe("");
});

test("the walk record draws the stored yellow note as warn, and lists the notes that cannot be placed", async () => {
  await mount("#/entity/" + ROLE.replace("--", "/"));
  var region = await screen.findByRole("region", { name: "Captured page" });
  var yellow = within(region).getByRole("button", { name: /^Mark 1:/ });
  var warn = yellow.style.border;
  expect(warn).toContain("--mantine-color-yellow-filled");
  expect(within(region).getByText("Not placed on the image")).toBeTruthy();
});
