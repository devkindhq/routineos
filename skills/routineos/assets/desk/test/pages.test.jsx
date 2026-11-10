import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { notifications } from "@mantine/notifications";
import App from "../app/App.jsx";
import { historyCsv } from "../core/exporter.js";
import { historyEvents } from "../core/pages/history.js";
import { createStore } from "../core/store.js";

var TODAY = new Date().toISOString();

var DEFINITION = {
  types: {
    roles: { label: "Role", plural: "Roles", fields: { title: { label: "Title", type: "text", summary: true }, level: { label: "Level", type: "text" } } },
  },
  producers: [{ id: "scout", label: "Scout", types: ["roles"], schedule: "0 6 * * *" }],
};

var HEALTH = Object.assign({}, DEFINITION, {
  desk: { health: { roles: { field: "level", red: ["junior"], yellow: ["mid"], green: ["senior"] } } },
});

function role(key, level) {
  return { data: { type: "roles", key: key, status: "active", display: { title: "Role " + key, level: level } } };
}

var RUN = { producer: "scout", startedAt: TODAY, endedAt: TODAY, status: "ok", parsed: 3, claimed: 3,
  counts: { new: 4, updated: 1, unchanged: 2, dropped: 1 } };

function staticStore(defn, extra) {
  return createStore("static", { docs: Object.assign({
    "meta/definition": { data: defn || DEFINITION },
    "meta/workspace": { data: { name: "Test workspace" } },
  }, extra || {}) });
}

async function mount(hash, store, title) {
  window.history.replaceState(null, "", hash);
  render(<App store={store || staticStore()} config={{ store: "static", workspace: "Test workspace" }} />);
  return screen.findByRole("heading", { level: 1, name: title });
}

var clip;
beforeEach(() => {
  try { localStorage.clear(); } catch (e) { /* storage blocked */ }
  notifications.clean();
  clip = vi.fn(() => Promise.resolve());
  Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: { writeText: clip } });
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "#/today");
});

test("Today hero shows the tone label from todayModel and one stack bar section per tone", async () => {
  var store = staticStore(HEALTH, {
    "entities/roles--a": role("a", "junior"), "entities/roles--b": role("b", "mid"),
    "entities/roles--c": role("c", "senior"), "entities/roles--d": role("d", "senior"),
    "runs/scout-1": { data: RUN },
  });
  await mount("#/today", store, "Today");
  var hero = await screen.findByRole("region", { name: "Roles by health" });
  expect(within(hero).getByText("Needs action")).toBeTruthy();
  var bars = within(hero).getAllByRole("progressbar");
  expect(bars.map((b) => b.getAttribute("aria-label"))).toEqual(["Needs action: 1", "Check: 1", "All good: 2"]);
});

test("Today before the first run names each producer and its next run, cron in UTC", async () => {
  await mount("#/today", staticStore(), "Today");
  expect(await screen.findByText("Nothing has run yet.")).toBeTruthy();
  expect(screen.getByText(/^Scout runs next /)).toBeTruthy();
  expect(screen.getByText(/0 6 \* \* \* \(cron, UTC\)/)).toBeTruthy();
});

test("History has timeline and calendar modes; the calendar is a plain table of UTC days", async () => {
  var store = staticStore(DEFINITION, { "runs/scout-1": { data: RUN } });
  await mount("#/history", store, "History");
  expect(await screen.findByText("Routine Scout run, ok")).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: "Calendar" }));
  await waitFor(() => expect(window.location.hash).toBe("#/history?mode=cal"));
  var table = await screen.findByRole("table", { name: "Runs by UTC day" });
  expect(table.querySelectorAll("td[data-date]").length).toBe(35);
  var cell = table.querySelector('td[data-date="' + TODAY.slice(0, 10) + '"]');
  expect(within(cell).getByRole("link").getAttribute("href")).toBe("#/runs/scout-1");
  expect(screen.getByText("Days are UTC, like the schedules.")).toBeTruthy();
});

test("History Export CSV saves historyCsv of the shown items through store.saveFile", async () => {
  var store = staticStore(DEFINITION, { "runs/scout-1": { data: RUN } });
  store.canDownload = () => Promise.resolve(true);
  store.saveFile = vi.fn(() => Promise.resolve());
  await mount("#/history", store, "History");
  await screen.findByText("Routine Scout run, ok");
  fireEvent.click(await screen.findByRole("button", { name: "Export CSV" }));
  await waitFor(() => expect(store.saveFile).toHaveBeenCalledTimes(1));
  var events = historyEvents({ definition: DEFINITION, runs: [{ id: "scout-1", data: RUN }] });
  expect(store.saveFile).toHaveBeenCalledWith("history.csv", historyCsv(events));
});

test("History Export CSV is hidden when this view cannot save, and a refused save says why", async () => {
  var store = staticStore(DEFINITION, { "runs/scout-1": { data: RUN } });
  await mount("#/history", store, "History");
  await screen.findByText("Routine Scout run, ok");
  expect(screen.queryByRole("button", { name: "Export CSV" })).toBeNull();
  cleanup();
  store = staticStore(DEFINITION, { "runs/scout-1": { data: RUN } });
  store.canDownload = () => Promise.resolve(true);
  store.saveFile = vi.fn(() => Promise.reject(Object.assign(new Error("no"), { code: "declined" })));
  await mount("#/history", store, "History");
  fireEvent.click(await screen.findByRole("button", { name: "Export CSV" }));
  expect(await screen.findByText("Not saved.")).toBeTruthy();
  expect(clip).not.toHaveBeenCalled();
});

test("#/runs/<id> shows that run, and an unknown id says so", async () => {
  var store = staticStore(DEFINITION, { "runs/scout-1": { data: RUN }, "runs/scout-0": { data: Object.assign({}, RUN, { status: "partial" }) } });
  await mount("#/runs/scout-1", store, "Scout run");
  expect(screen.getByText("This run parsed 3 of 3 sources.", { exact: false })).toBeTruthy();
  expect(within(screen.getByRole("region", { name: "Counts" })).getByText("4")).toBeTruthy();
  cleanup();
  await mount("#/runs/nope", staticStore(), "Run");
  expect(await screen.findByText("No run with id nope.")).toBeTruthy();
});

test("Runs lists each run with a link to its page", async () => {
  var store = staticStore(DEFINITION, { "runs/scout-1": { data: RUN } });
  await mount("#/runs", store, "Runs");
  var row = await screen.findByRole("row", { name: /scout-1/ });
  expect(row.getAttribute("data-run")).toBe("scout-1");
  expect(within(row).getByRole("link", { name: "scout-1" }).getAttribute("href")).toBe("#/runs/scout-1");
});

test("Workers copy link uses a copy button that writes the join link", async () => {
  var join = { url: "https://desk.example/join", lanes: [{ id: "roles", label: "Roles lane", match: { type: "roles" } }] };
  await mount("#/workers", staticStore(DEFINITION, { "meta/join": { data: join } }), "Workers");
  var lane = (await screen.findByText("Roles lane")).closest("[data-lane]");
  expect(within(lane).getByText("Unserved")).toBeTruthy();
  fireEvent.click(within(lane).getByRole("button", { name: "Copy link" }));
  await waitFor(() => expect(clip).toHaveBeenCalledWith("https://desk.example/join"));
  expect(await within(lane).findByRole("button", { name: "Copied" })).toBeTruthy();
});

test("Workers without join lanes says the Desk is not set up for joining", async () => {
  await mount("#/workers", staticStore(), "Workers");
  expect(await screen.findByText("This Desk is not set up for others to join.")).toBeTruthy();
});

test("Workers copy link opens the text to copy by hand when the clipboard refuses the write", async () => {
  clip.mockImplementation(() => Promise.reject(new Error("blocked")));
  var join = { url: "https://desk.example/join", lanes: [{ id: "roles", label: "Roles lane", match: { type: "roles" } }] };
  await mount("#/workers", staticStore(DEFINITION, { "meta/join": { data: join } }), "Workers");
  var lane = (await screen.findByText("Roles lane")).closest("[data-lane]");
  fireEvent.click(within(lane).getByRole("button", { name: "Copy link" }));
  var box = await screen.findByRole("textbox", { name: "Text to copy" });
  expect(box.value).toBe("https://desk.example/join");
  expect(box.readOnly).toBe(true);
  expect(within(lane).queryByRole("button", { name: "Copied" })).toBeNull();
});

test("Workers Desk id copy opens the text to copy by hand when there is no clipboard", async () => {
  Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: undefined });
  var join = { url: "https://desk.example/join", lanes: [{ id: "roles", label: "Roles lane", match: { type: "roles" } }] };
  var store = staticStore(DEFINITION, { "meta/join": { data: join } });
  store.viewer = () => Promise.resolve("viewer-1");
  await mount("#/workers", store, "Workers");
  fireEvent.click(await screen.findByRole("button", { name: "Copy id" }));
  var box = await screen.findByRole("textbox", { name: "Text to copy" });
  expect(box.value).toBe("viewer-1");
});

test("Runs copy run id writes the id, and a refused write opens the text to copy by hand", async () => {
  var store = staticStore(DEFINITION, { "runs/scout-1": { data: RUN } });
  await mount("#/runs/scout-1", store, "Scout run");
  fireEvent.click(screen.getByRole("button", { name: "Copy run id" }));
  await waitFor(() => expect(clip).toHaveBeenCalledWith("scout-1"));
  expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: "Text to copy" })).toBeNull();
  cleanup();
  clip.mockImplementation(() => Promise.reject(new Error("blocked")));
  await mount("#/runs/scout-1", staticStore(DEFINITION, { "runs/scout-1": { data: RUN } }), "Scout run");
  fireEvent.click(screen.getByRole("button", { name: "Copy run id" }));
  expect((await screen.findByRole("textbox", { name: "Text to copy" })).value).toBe("scout-1");
});

test("Runs copy run id opens the text to copy by hand when there is no clipboard", async () => {
  Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: undefined });
  await mount("#/runs/scout-1", staticStore(DEFINITION, { "runs/scout-1": { data: RUN } }), "Scout run");
  fireEvent.click(screen.getByRole("button", { name: "Copy run id" }));
  expect((await screen.findByRole("textbox", { name: "Text to copy" })).value).toBe("scout-1");
});

function healthDocs(extra) {
  return Object.assign({
    "entities/roles--a": role("a", "junior"), "entities/roles--b": role("b", "mid"),
    "entities/roles--c": role("c", "senior"), "entities/roles--d": role("d", "senior"),
    "runs/scout-1": { data: RUN },
  }, extra || {});
}

test("Today leads with the headline, lead line and three tiles that link to browse by health", async () => {
  await mount("#/today", staticStore(HEALTH, healthDocs()), "Today");
  expect(await screen.findByText("Not all green yet: 2 items need attention")).toBeTruthy();
  expect(screen.getByText("1 need action now, 1 to check")).toBeTruthy();
  var tiles = screen.getByRole("group", { name: "Health counts" });
  var links = within(tiles).getAllByRole("link");
  expect(links.map((a) => a.getAttribute("href"))).toEqual([
    "#/browse/roles?health=red", "#/browse/roles?health=yellow", "#/browse/roles?health=green"]);
  expect(within(tiles).getAllByText(/^[0-9]+$/).map((n) => n.textContent)).toEqual(["1", "1", "2"]);
  expect(screen.getByText("2 of 4 items (50%)")).toBeTruthy();
  expect(screen.getByText(/^Last refreshed at /)).toBeTruthy();
});

test("Today says All green when nothing needs attention", async () => {
  var docs = healthDocs();
  delete docs["entities/roles--a"];
  delete docs["entities/roles--b"];
  await mount("#/today", staticStore(HEALTH, docs), "Today");
  expect(await screen.findByText("All green")).toBeTruthy();
});

test("Today shows no headline, lead line or tiles without a declared status", async () => {
  await mount("#/today", staticStore(DEFINITION, { "runs/scout-1": { data: RUN } }), "Today");
  await screen.findByText(/new since the last run/);
  expect(screen.queryByText(/Not all green|All green/)).toBeNull();
  expect(screen.queryByRole("group", { name: "Health counts" })).toBeNull();
});

test("Today shows no headline when the record read was capped, and says so", async () => {
  var store = staticStore(HEALTH, healthDocs());
  var list = store.list, n = 0;
  store.list = (c, q) => {
    if (c !== "entities") return list(c, q);
    var rows = [];
    for (var i = 0; i < 1000; i++, n++) rows.push({ id: "roles--r" + n, version: 1, data: { type: "roles", key: "k" + String(n).padStart(7, "0"), status: "active", display: { level: "senior" } } });
    return Promise.resolve(rows);
  };
  await mount("#/today", store, "Today");
  expect(await screen.findByText(/^Showing the first /)).toBeTruthy();
  expect(screen.queryByText(/All green|Not all green/)).toBeNull();
});

test("Today delta reads since the previous run, only when both runs carry green and total", async () => {
  var docs = healthDocs({
    "runs/scout-0": { data: Object.assign({}, RUN, { startedAt: "2026-01-01T00:00:00Z", counts: { green: 1, total: 4 } }) },
    "runs/scout-1": { data: Object.assign({}, RUN, { counts: { green: 2, total: 4 } }) },
  });
  await mount("#/today", staticStore(HEALTH, docs), "Today");
  expect(await screen.findByText("up 25% since the previous run")).toBeTruthy();
});

test("Runs columns Captured, Failed, New reds and Cost appear only when a run doc has the field, and the cost card with them", async () => {
  await mount("#/runs", staticStore(DEFINITION, { "runs/scout-1": { data: RUN } }), "Runs");
  await screen.findByRole("row", { name: /scout-1/ });
  expect(screen.queryByRole("columnheader", { name: "Captured" })).toBeNull();
  expect(screen.queryByRole("columnheader", { name: "Cost" })).toBeNull();
  expect(screen.queryByText("Cost of latest runs")).toBeNull();
  cleanup();
  var rich = Object.assign({}, RUN, { cost: 1.5, counts: Object.assign({}, RUN.counts, { captured: 7, failed: 1, newReds: 2 }) });
  await mount("#/runs", staticStore(DEFINITION, { "runs/scout-1": { data: rich } }), "Runs");
  await screen.findByRole("row", { name: /scout-1/ });
  ["Captured", "Failed", "New reds", "Cost"].forEach((h) => expect(screen.getByRole("columnheader", { name: h })).toBeTruthy());
  expect(screen.getByText("Cost of latest runs")).toBeTruthy();
});

test("Runs header names the next run without an id and counts queued approvals", async () => {
  var docs = { "runs/scout-1": { data: RUN }, "pending/g1": { data: { producer: "scout", title: "Send", createdAt: TODAY, status: "pending" } },
    "decisions/g1": { data: { decision: "approve", by: "u1", at: TODAY } } };
  await mount("#/runs", staticStore(DEFINITION, docs), "Runs");
  expect(await screen.findByText(/^Next run .*, with 1 approval queued\.$/)).toBeTruthy();
});

function writableStore(defn, extra) {
  var docs = Object.assign({ "meta/definition": { data: defn || DEFINITION }, "meta/workspace": { data: { name: "Test workspace" } } }, extra || {});
  var store = createStore("static", { docs: docs });
  store.readOnly = false;
  store.viewer = () => Promise.resolve("u1");
  store.set = vi.fn((p, d) => { docs[p] = { version: 1, data: JSON.parse(JSON.stringify(d)) }; return Promise.resolve(); });
  return store;
}

var LIMITS = /The routine reads this at its next scheduled run.*daily cap still applies.*Cancelling a queued request is not available yet/;

test("Runs: Run now queues one request, shows Queued for next run with its age and the limits, and a second click queues nothing more", async () => {
  var store = writableStore(DEFINITION, { "runs/scout-1": { data: RUN } });
  await mount("#/runs", store, "Runs");
  fireEvent.click(await screen.findByRole("button", { name: "Run now: Scout" }));
  expect(await screen.findByText(/^Queued for next run, asked /)).toBeTruthy();
  expect(store.set).toHaveBeenCalledTimes(1);
  expect(store.set.mock.calls[0][0]).toMatch(/^requests\//);
  expect(store.set.mock.calls[0][1]).toMatchObject({ kind: "run-now", routine: "scout", status: "pending", by: "u1" });
  expect(screen.getByText(LIMITS)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Run now: Scout" }));
  await waitFor(() => expect(screen.getAllByText(/^Queued for next run, asked /).length).toBe(1));
  expect(store.set).toHaveBeenCalledTimes(1);
});

test("Runs: a partial run offers Retry next run; an ok run does not; the button writes a retry request", async () => {
  var store = writableStore(DEFINITION, { "runs/scout-1": { data: Object.assign({}, RUN, { status: "partial" }) },
    "runs/scout-0": { data: Object.assign({}, RUN, { startedAt: "2026-01-01T00:00:00Z", endedAt: "2026-01-01T00:01:00Z" }) } });
  await mount("#/runs", store, "Runs");
  var rows = await screen.findAllByRole("row", { name: /scout-/ });
  var partial = rows.filter((r) => r.getAttribute("data-run") === "scout-1")[0];
  var ok = rows.filter((r) => r.getAttribute("data-run") === "scout-0")[0];
  expect(within(ok).queryByRole("button", { name: /Retry next run/ })).toBeNull();
  fireEvent.click(within(partial).getByRole("button", { name: "Retry next run: Scout" }));
  await waitFor(() => expect(store.set).toHaveBeenCalledTimes(1));
  expect(store.set.mock.calls[0][1]).toMatchObject({ kind: "retry", routine: "scout" });
});

test("Runs: a visit that cannot write sees no Run now or Retry button, and nothing is written", async () => {
  var store = staticStore(DEFINITION, { "runs/scout-1": { data: Object.assign({}, RUN, { status: "partial" }) } });
  await mount("#/runs", store, "Runs");
  await screen.findByRole("row", { name: /scout-1/ });
  expect(screen.queryByRole("button", { name: /Run now|Retry next run/ })).toBeNull();
});

test("History groups the timeline by day in order and names the routine as the actor of a run", async () => {
  var yesterday = new Date(Date.now() - 86400000).toISOString();
  var old = new Date(Date.now() - 30 * 86400000).toISOString();
  var store = staticStore(DEFINITION, {
    "runs/scout-1": { data: RUN },
    "runs/scout-0": { data: Object.assign({}, RUN, { startedAt: yesterday, endedAt: yesterday }) },
    "runs/scout-old": { data: Object.assign({}, RUN, { startedAt: old, endedAt: old }) },
  });
  await mount("#/history", store, "History");
  await screen.findAllByText(/Routine Scout run, ok/);
  var heads = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent).filter((t) => /^(Today|Yesterday|This week|Earlier)$/.test(t));
  expect(heads).toEqual(["Today", "Yesterday", "Earlier"]);
});
