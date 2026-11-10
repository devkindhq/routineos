import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, afterAll, beforeEach, expect, test } from "vitest";
import { notifications } from "@mantine/notifications";
import App from "../app/App.jsx";
import { TOUR_KEY, TOUR_STEPS } from "../app/Tour.jsx";
import { createStore } from "../core/store.js";

var DEFINITION = {
  types: { roles: { label: "Role", plural: "Roles", fields: { title: { label: "Title", type: "text" } } } },
  producers: [{ id: "scout", label: "Scout", types: ["roles"], schedule: "0 6 * * *" }],
};

var STEP_TEXT = [
  "Today is where a visit starts: what needs you now and what the routine did since you were last here.",
  "Approvals holds everything waiting on a person. Approve, reject or snooze, one at a time or in bulk.",
  "Each record type has its own list. Filter it, sort it and save the view you come back to.",
  "Open a row to see it in the peek beside its list. Press o for the full page and Esc to close it.",
  "The bell collects gates, failed runs and caps. Pinned rows at the top need you first.",
];

function staticStore(extra) {
  return createStore("static", { docs: Object.assign({
    "meta/definition": { data: DEFINITION },
    "meta/workspace": { data: { name: "Test workspace" } },
  }, extra || {}) });
}

async function mount(config, store) {
  window.history.replaceState(null, "", "#/today");
  render(<App store={store || staticStore()} config={Object.assign({ store: "static", workspace: "Test workspace" }, config)} />);
  await screen.findByRole("heading", { level: 1, name: "Today" });
}

// jsdom lays nothing out, so every element measures 0 by 0. A tour target must be visible, so give elements a size.
var realRect;
beforeAll(() => {
  realRect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function () {
    return { x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 20, width: 100, height: 20, toJSON() {} };
  };
});
afterAll(() => { HTMLElement.prototype.getBoundingClientRect = realRect; });

beforeEach(() => {
  try { localStorage.clear(); } catch (e) { /* storage blocked */ }
  notifications.clean();
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "#/today");
});

function tour() { return screen.findByRole("dialog", { name: "Starter tour" }); }

test("there are five steps with the legacy copy", () => {
  expect(TOUR_KEY).toBe("routineos-desk-tour-done");
  expect(TOUR_STEPS.map((s) => s.text)).toEqual(STEP_TEXT);
});

test("the tour starts once, anchors each step to its target, and Next, Back and Done work", async () => {
  await mount({ tour: true });
  var box = await tour();
  expect(within(box).getByText("Step 1 of 5")).toBeTruthy();
  expect(within(box).getByText(STEP_TEXT[0])).toBeTruthy();
  await waitFor(() => expect(document.querySelector('[data-tour-target="today"]')).toBeTruthy());
  expect(document.querySelector('[data-tour-target="today"]').getAttribute("href")).toBe("#/today");
  expect(within(box).queryByRole("button", { name: "Back" })).toBeNull();

  fireEvent.click(within(box).getByRole("button", { name: "Next" }));
  expect(await within(box).findByText("Step 2 of 5")).toBeTruthy();
  await waitFor(() => expect(document.querySelector('[data-tour-target="approvals"]')).toBeTruthy());
  expect(document.querySelector('[data-tour-target="approvals"]').getAttribute("href")).toBe("#/approvals");
  expect(document.querySelector('[data-tour-target="today"]')).toBeNull();

  fireEvent.click(within(box).getByRole("button", { name: "Back" }));
  expect(await within(box).findByText("Step 1 of 5")).toBeTruthy();

  for (var i = 0; i < 4; i++) fireEvent.click(within(box).getByRole("button", { name: "Next" }));
  expect(await within(box).findByText("Step 5 of 5")).toBeTruthy();
  expect(within(box).getByText(STEP_TEXT[4])).toBeTruthy();
  await waitFor(() => expect(document.querySelector('[data-tour-target="bell"]')).toBeTruthy());
  expect(document.querySelector('[data-tour-target="bell"]').getAttribute("data-tour")).toBe("bell");
  expect(localStorage.getItem(TOUR_KEY)).toBeNull();

  fireEvent.click(within(box).getByRole("button", { name: "Done" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Starter tour" })).toBeNull());
  expect(localStorage.getItem(TOUR_KEY)).toBe("1");
});

test("Skip closes the tour and writes the tour key", async () => {
  await mount({ tour: true });
  var box = await tour();
  fireEvent.click(within(box).getByRole("button", { name: "Skip" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Starter tour" })).toBeNull());
  expect(localStorage.getItem(TOUR_KEY)).toBe("1");
});

test("the tour does not start when done, when built without it, or when the owner switched it off", async () => {
  localStorage.setItem(TOUR_KEY, "1");
  await mount({ tour: true });
  expect(screen.queryByRole("dialog", { name: "Starter tour" })).toBeNull();
  cleanup();

  localStorage.clear();
  await mount({});
  expect(screen.queryByRole("dialog", { name: "Starter tour" })).toBeNull();
  cleanup();

  await mount({ tour: true }, staticStore({ "settings/workspace": { data: { values: { tour: false } } } }));
  expect(screen.queryByRole("dialog", { name: "Starter tour" })).toBeNull();
});

test("Take the tour in the user menu starts it again", async () => {
  localStorage.setItem(TOUR_KEY, "1");
  await mount({ tour: true });
  fireEvent.click(screen.getByRole("button", { name: "Your settings" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Take the tour" }));
  var box = await tour();
  expect(within(box).getByText("Step 1 of 5")).toBeTruthy();
});
