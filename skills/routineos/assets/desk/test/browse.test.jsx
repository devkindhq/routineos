import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { notifications } from "@mantine/notifications";
import { spotlight } from "@mantine/spotlight";
import App from "../app/App.jsx";
import { CHANGE_SETTLE_MS, readFilterState } from "../core/pages/browse.js";
import { FULL_READ_MAX, FULL_STEP } from "../core/paging.js";
import { route } from "../core/router.js";
import { createStore } from "../core/store.js";

var DEFINITION = {
  types: {
    roles: {
      plural: "Roles",
      order: ["title", "salary", "band", "level"],
      fields: {
        title: { label: "Title", type: "text", summary: true },
        salary: { label: "Salary", type: "number", summary: true },
        band: { label: "Band", type: "text", summary: true },
        level: { label: "Level", type: "choice", choices: ["junior", "senior"] },
      },
    },
  },
  producers: [{ id: "scout", label: "Scout", types: ["roles"] }],
  desk: { modules: [{ id: "senior", kind: "view", label: "Senior roles", view: { type: "roles", filters: { tag: "senior" } },
    fields: { band: "salary-band" } }] },
};

function entity(key, title, salary, lastSeen) {
  return { data: { type: "roles", key: key, status: "active", lastSeen: lastSeen, firstSeen: lastSeen, seenCount: 1, sources: ["scout"],
    display: { title: title, salary: salary, band: { min: salary / 10, max: salary / 5 }, level: salary > 150 ? "senior" : "junior" } } };
}

var TS = (1767225600000).toString(36);

function docs() {
  return {
    "meta/definition": { data: DEFINITION },
    "meta/workspace": { data: { name: "Test workspace" } },
    "entities/role--a": entity("a", "Analyst", 100, "2026-11-03T00:00:00Z"),
    "entities/role--b": entity("b", "Baker", 200, "2026-11-02T00:00:00Z"),
    "entities/role--c": entity("c", "Clerk", 300, "2026-11-01T00:00:00Z"),
    "decisions/role--a": { data: { decision: "keep", by: "uann", at: "2026-11-04T00:00:00Z" } },
    ["comments/role--b--ubob--" + TS]: { data: { entity: "role--b", by: "ubob", at: "2026-11-04T00:00:00Z", text: "hi" } },
    "userstate/role--c": { data: { tags: ["senior"] } },
    "views/v1": { data: { type: "roles", name: "Seniors", state: "kept", filters: { fields: { level: "senior" } } } },
  };
}

function staticStore() {
  return createStore("static", { docs: docs() });
}

async function mount(hash, store) {
  window.history.replaceState(null, "", hash);
  render(<App store={store || staticStore()} config={{ store: "static", workspace: "Test workspace" }} />);
  return screen.findByRole("heading", { level: 1 });
}

function query() {
  return route(window.location.hash).params.query || {};
}

function rowTitles() {
  return screen.queryAllByRole("link", { name: /^(Analyst|Baker|Clerk)$/ }).map((a) => a.textContent);
}

beforeEach(() => {
  try { localStorage.clear(); } catch (e) { /* storage blocked */ }
});

afterEach(() => {
  act(() => spotlight.close()); // the palette's open state outlives a test
  act(() => notifications.clean()); // so do toasts (an Undo from one test must not meet the next)
  cleanup();
  delete window.DESK_COMPONENTS;
  window.history.replaceState(null, "", "#/today");
});

test("Browse titles the page with the plural and lists the rows newest first", async () => {
  var h1 = await mount("#/browse/roles");
  await waitFor(() => expect(h1.textContent).toBe("Roles"));
  expect(h1.id).toBe("page-title");
  await screen.findByRole("link", { name: "Analyst" });
  expect(rowTitles()).toEqual(["Analyst", "Baker", "Clerk"]);
});

test("filters round-trip through the hash without adding a history entry", async () => {
  await mount("#/browse/roles");
  await screen.findByRole("link", { name: "Analyst" });
  var before = window.history.length;
  fireEvent.change(screen.getByRole("textbox", { name: "Search Roles" }), { target: { value: "baker" } });
  await waitFor(() => expect(rowTitles()).toEqual(["Baker"]));
  expect(window.location.hash).toBe("#/browse/roles?q=baker");
  expect(window.history.length).toBe(before);
  cleanup();
  await mount("#/browse/roles?q=baker");
  await screen.findByRole("link", { name: "Baker" });
  expect(rowTitles()).toEqual(["Baker"]);
  expect(screen.getByRole("textbox", { name: "Search Roles" }).value).toBe("baker");
});

test("a garbage hash renders every row", async () => {
  var h1 = await mount("#/browse/roles?f=%%%&zzz=1");
  await waitFor(() => expect(h1.textContent).toBe("Roles"));
  await screen.findByRole("link", { name: "Analyst" });
  expect(rowTitles()).toEqual(["Analyst", "Baker", "Clerk"]);
});

test("sorting a new column starts ascending", async () => {
  await mount("#/browse/roles");
  await screen.findByRole("link", { name: "Analyst" });
  fireEvent.click(screen.getByText("Title", { selector: "th *" }));
  await waitFor(() => expect(readFilterState(query()).sort).toEqual({ field: "title", dir: "asc" }));
  await waitFor(() => expect(rowTitles()).toEqual(["Analyst", "Baker", "Clerk"]));
  fireEvent.click(screen.getByText("Salary", { selector: "th *" }));
  await waitFor(() => expect(readFilterState(query()).sort).toEqual({ field: "salary", dir: "asc" }));
  fireEvent.click(screen.getByText("Salary", { selector: "th *" }));
  await waitFor(() => expect(readFilterState(query()).sort).toEqual({ field: "salary", dir: "desc" }));
  await waitFor(() => expect(rowTitles()).toEqual(["Clerk", "Baker", "Analyst"]));
});

test("select all, then Export selected exports only the selected rows", async () => {
  await mount("#/browse/roles");
  await screen.findByRole("link", { name: "Analyst" });
  fireEvent.click(screen.getByRole("checkbox", { name: "Select all shown" }));
  await screen.findByText("3 selected");
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Baker" }));
  await screen.findByText("2 selected");
  fireEvent.click(screen.getByRole("button", { name: "Export selected" }));
  var dialog = await screen.findByRole("dialog", { name: "Export Roles" });
  var text = within(dialog).getByRole("textbox", { name: "Export data" }).value;
  expect(text.split("\r\n")[0]).toContain("Title");
  expect(text).toContain("Analyst");
  expect(text).toContain("Clerk");
  expect(text).not.toContain("Baker");
  expect(within(dialog).getByText("2 selected")).toBeTruthy();
});

test("Download is absent when the view cannot save a file", async () => {
  await mount("#/browse/roles");
  await screen.findByRole("link", { name: "Analyst" });
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  var dialog = await screen.findByRole("dialog", { name: "Export Roles" });
  expect(within(dialog).getByRole("button", { name: "Copy" })).toBeTruthy();
  expect(within(dialog).queryByRole("button", { name: "Download" })).toBeNull();
  expect(within(dialog).getByText("3 in this view")).toBeTruthy();
});

test("Export Copy writes the export text and says Copied only once the clipboard write goes through", async () => {
  var clip = vi.fn(() => Promise.resolve());
  Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: { writeText: clip } });
  await mount("#/browse/roles");
  await screen.findByRole("link", { name: "Analyst" });
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  var dialog = await screen.findByRole("dialog", { name: "Export Roles" });
  var text = within(dialog).getByRole("textbox", { name: "Export data" }).value;
  fireEvent.click(within(dialog).getByRole("button", { name: "Copy" }));
  await waitFor(() => expect(clip).toHaveBeenCalledTimes(1));
  // The clipboard gets the CSV as built (CRLF rows); a textarea value reads with LF.
  expect(clip.mock.calls[0][0]).toContain("\r\n");
  expect(clip.mock.calls[0][0].replace(/\r\n/g, "\n")).toBe(text);
  expect(await within(dialog).findByRole("button", { name: "Copied" })).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: "Text to copy" })).toBeNull();
});

test("Export Copy with a refused clipboard write opens the text to copy by hand and never says Copied", async () => {
  var clip = vi.fn(() => Promise.reject(new Error("blocked")));
  Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: { writeText: clip } });
  await mount("#/browse/roles");
  await screen.findByRole("link", { name: "Analyst" });
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  var dialog = await screen.findByRole("dialog", { name: "Export Roles" });
  var text = within(dialog).getByRole("textbox", { name: "Export data" }).value;
  fireEvent.click(within(dialog).getByRole("button", { name: "Copy" }));
  var box = await screen.findByRole("textbox", { name: "Text to copy" });
  expect(box.value).toBe(text);
  expect(clip).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
});

test("a declined save shows the downloadToast message", async () => {
  var store = staticStore();
  store.canDownload = () => Promise.resolve(true);
  store.saveFile = vi.fn(() => Promise.reject({ code: "declined", message: "no" }));
  await mount("#/browse/roles", store);
  await screen.findByRole("link", { name: "Analyst" });
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  var dialog = await screen.findByRole("dialog", { name: "Export Roles" });
  fireEvent.click(await within(dialog).findByRole("button", { name: "Download" }));
  expect(await within(dialog).findByText("Not saved.")).toBeTruthy();
  expect(store.saveFile).toHaveBeenCalledTimes(1);
  expect(store.saveFile.mock.calls[0][0]).toMatch(/^test-workspace-roles-\d{4}-\d\d-\d\d\.csv$/);
  expect(store.saveFile.mock.calls[0][1]).toContain("Analyst");
});

test("?peek= for a missing record shows no drawer and clears the param", async () => {
  await mount("#/browse/roles?q=a&peek=role--zzz");
  await screen.findByRole("link", { name: "Analyst" });
  await waitFor(() => expect(window.location.hash).toBe("#/browse/roles?q=a"));
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("?peek= for a shown record opens the drawer, and Close clears it", async () => {
  await mount("#/browse/roles?peek=role--b");
  var drawer = await screen.findByRole("dialog", { name: "Baker" });
  expect(within(drawer).getByText("200")).toBeTruthy();
  expect(within(drawer).getByRole("link", { name: "Open record" }).getAttribute("href")).toBe("#/entity/role/b");
  fireEvent.click(within(drawer).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(window.location.hash).toBe("#/browse/roles"));
});

test("the peek shows the decision state and the record's comments", async () => {
  await mount("#/browse/roles?peek=role--b");
  var drawer = await screen.findByRole("dialog", { name: "Baker" });
  expect(within(drawer).getByText("Active")).toBeTruthy();
  expect(within(drawer).getByRole("heading", { name: "Comments (1)" })).toBeTruthy();
  expect(within(drawer).getByText("hi")).toBeTruthy();
  window.history.replaceState(null, "", "#/browse/roles?peek=role--a");
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  var other = await screen.findByRole("dialog", { name: "Analyst" });
  expect(within(other).getByText("Kept")).toBeTruthy();
  expect(within(other).getByText("No comments yet.")).toBeTruthy();
});

test("a viewer who may decide sets Keep from the peek", async () => {
  var store = createStore("static", { docs: docs() });
  store.readOnly = false;
  store.viewer = () => Promise.resolve("u1");
  store.set = vi.fn(() => Promise.resolve());
  await mount("#/browse/roles?peek=role--b", store);
  var drawer = await screen.findByRole("dialog", { name: "Baker" });
  var group = within(drawer).getByRole("radiogroup", { name: "Decision" });
  fireEvent.click(within(group).getByRole("radio", { name: "Keep", hidden: true }));
  await waitFor(() => expect(store.set).toHaveBeenCalledWith("decisions/role--b", expect.objectContaining({ decision: "keep" })));
});

test("on a joined Desk a member who is not the owner gets no decide controls in the peek or the bulk bar", async () => {
  var d = docs();
  d["meta/join"] = { data: { open: true } };
  d["meta/owner"] = { data: { by: "u1", at: "2026-11-01T00:00:00Z" } };
  var store = createStore("static", { docs: d });
  store.readOnly = false;
  store.viewer = () => Promise.resolve("u2");
  store.set = vi.fn(() => Promise.resolve());
  await mount("#/browse/roles?peek=role--b", store);
  var drawer = await screen.findByRole("dialog", { name: "Baker" });
  expect(within(drawer).getByText("Active")).toBeTruthy();
  expect(within(drawer).queryByRole("radiogroup", { name: "Decision" })).toBeNull();
  fireEvent.click(within(drawer).getByRole("button", { name: "Close" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: "Select Clerk" }));
  await screen.findByText("1 selected");
  expect(screen.queryByRole("button", { name: "Keep" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Drop" })).toBeNull();
  expect(screen.getByRole("button", { name: "Tag" })).toBeTruthy();
});

test("clicking a row opens its peek", async () => {
  await mount("#/browse/roles");
  await screen.findByRole("link", { name: "Clerk" });
  fireEvent.click(screen.getByText("300"));
  await screen.findByRole("dialog", { name: "Clerk" });
  expect(query().peek).toBe("role--c");
});

test("the Decision and Owner columns are shown", async () => {
  await mount("#/browse/roles");
  await screen.findByRole("link", { name: "Analyst" });
  expect(screen.getByText("Decision", { selector: "th *" })).toBeTruthy();
  expect(screen.getByText("Owner", { selector: "th *" })).toBeTruthy();
  expect(screen.getByText("Kept")).toBeTruthy();
  expect(screen.getAllByText("Pending").length).toBe(2);
  expect(screen.getByText("uann")).toBeTruthy();
  expect(screen.getByText("ubob")).toBeTruthy();
});

test("the calculation footer shows the totals and a calculation can be removed", async () => {
  await mount("#/browse/roles?calc=salary:sum,title:count,salary:avg");
  await screen.findByRole("link", { name: "Analyst" });
  expect(screen.getByText("Sum of Salary: 600")).toBeTruthy();
  expect(screen.getByText("Count of Title: 3")).toBeTruthy();
  expect(screen.getByText("Average of Salary: 200")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Remove calculation Sum of Salary" }));
  await waitFor(() => expect(query().calc).toBe("title:count,salary:avg"));
  expect(screen.queryByText("Sum of Salary: 600")).toBeNull();
});

test("a calculation can be added from the footer", async () => {
  await mount("#/browse/roles");
  await screen.findByRole("link", { name: "Analyst" });
  fireEvent.click(screen.getByRole("button", { name: "Add calculation" }));
  var col = await screen.findByRole("combobox", { name: "Column" });
  fireEvent.change(col, { target: { value: "salary" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Calculation" }), { target: { value: "max" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await waitFor(() => expect(query().calc).toBe("salary:max"));
  expect(await screen.findByText("Max of Salary: 300")).toBeTruthy();
});

test("#/m/<id> renders the module's view with its fixed scope and field component", async () => {
  window.DESK_COMPONENTS = Object.create(null);
  window.DESK_COMPONENTS["salary-band"] = function (ctx, props, ui) {
    return ui.el("span", null, props.value.min + " to " + props.value.max);
  };
  var h1 = await mount("#/m/senior");
  await waitFor(() => expect(h1.textContent).toBe("Senior roles"));
  await screen.findByRole("link", { name: "Clerk" });
  expect(rowTitles()).toEqual(["Clerk"]);
  expect(screen.getByText("Tag: senior")).toBeTruthy();
  expect(screen.getByText("30 to 60")).toBeTruthy();
});

test("an unknown module says so", async () => {
  var h1 = await mount("#/m/nope");
  await waitFor(() => expect(h1.textContent).toBe("Browse"));
  expect(await screen.findByText("This workspace has no view called nope.")).toBeTruthy();
});

test("an unknown type says so", async () => {
  await mount("#/browse/nope");
  expect(await screen.findByText("This workspace has no type called nope.")).toBeTruthy();
});

test("f opens the Filters panel, and a field filter narrows the list through the hash", async () => {
  await mount("#/browse/roles");
  await screen.findByRole("link", { name: "Analyst" });
  act(() => { fireEvent.keyDown(document, { key: "f" }); });
  var panel = await screen.findByRole("dialog", { name: "Filters" });
  fireEvent.change(within(panel).getByRole("combobox", { name: "Level" }), { target: { value: "senior" } });
  await waitFor(() => expect(query()["f.level"]).toBe("senior"));
  await waitFor(() => expect(rowTitles()).toEqual(["Baker", "Clerk"]));
  expect(screen.getByRole("button", { name: "Remove filter Level: senior" })).toBeTruthy();
});

function filterStore() {
  var d = docs();
  var def = JSON.parse(JSON.stringify(DEFINITION));
  def.types.roles.fields.remote = { label: "Remote", type: "bool" };
  def.types.roles.fields.market = { label: "Market", type: "choice" };
  d["meta/definition"] = { data: def };
  d["entities/role--a"].data.display.remote = true;
  d["entities/role--a"].data.display.market = "AU";
  d["entities/role--b"].data.display.remote = false;
  d["entities/role--b"].data.display.market = "US";
  d["entities/role--c"].data.status = "dropped";
  d["entities/role--c"].data.dropReason = "too far";
  return createStore("static", { docs: d });
}

async function openFilters() {
  fireEvent.click(screen.getByRole("button", { name: "Filters" }));
  return screen.findByRole("dialog", { name: "Filters" });
}

test("Filters: drop reason, bool and data-derived choice fields narrow the list", async () => {
  await mount("#/browse/roles?status=all", filterStore());
  await screen.findByRole("link", { name: "Clerk" });
  var panel = await openFilters();
  var reason = within(panel).getByRole("combobox", { name: "Drop reason" });
  expect(Array.from(reason.options).map((o) => o.textContent)).toEqual(["Any", "too far"]);
  fireEvent.change(reason, { target: { value: "too far" } });
  await waitFor(() => expect(query().reason).toBe("too far"));
  await waitFor(() => expect(rowTitles()).toEqual(["Clerk"]));
  fireEvent.change(within(panel).getByRole("combobox", { name: "Drop reason" }), { target: { value: "" } });
  var remote = within(panel).getByRole("combobox", { name: "Remote" });
  expect(Array.from(remote.options).map((o) => o.textContent)).toEqual(["Any", "yes", "no"]);
  fireEvent.change(remote, { target: { value: "true" } });
  await waitFor(() => expect(rowTitles()).toEqual(["Analyst"]));
  fireEvent.change(within(panel).getByRole("combobox", { name: "Remote" }), { target: { value: "" } });
  var market = within(panel).getByRole("combobox", { name: "Market" });
  expect(Array.from(market.options).map((o) => o.textContent)).toEqual(["Any", "AU", "US"]);
  fireEvent.change(market, { target: { value: "US" } });
  await waitFor(() => expect(rowTitles()).toEqual(["Baker"]));
});

test("Filters: a data-derived choice keeps values named like object members (__proto__, constructor)", async () => {
  await mount("#/browse/roles?status=all", (function () {
    var x = docs();
    var def = JSON.parse(JSON.stringify(DEFINITION));
    def.types.roles.fields.market = { label: "Market", type: "choice" };
    x["meta/definition"] = { data: def };
    x["entities/role--a"].data.display.market = "__proto__";
    x["entities/role--b"].data.display.market = "constructor";
    return createStore("static", { docs: x });
  })());
  await screen.findByRole("link", { name: "Clerk" });
  var panel = await openFilters();
  var market = within(panel).getByRole("combobox", { name: "Market" });
  expect(Array.from(market.options).map((o) => o.textContent)).toEqual(["Any", "__proto__", "constructor"]);
});

test("Filters: Sort by, Order and Group by write the hash, and Clear filters keeps them", async () => {
  await mount("#/browse/roles", filterStore());
  await screen.findByRole("link", { name: "Analyst" });
  var panel = await openFilters();
  fireEvent.change(within(panel).getByRole("combobox", { name: "Sort by" }), { target: { value: "salary" } });
  await waitFor(() => expect(query().sort).toBe("salary:desc"));
  fireEvent.click(within(panel).getByRole("radio", { name: "Ascending" }));
  await waitFor(() => expect(query().sort).toBe("salary:asc"));
  await waitFor(() => expect(rowTitles()).toEqual(["Analyst", "Baker"]));
  var group = within(panel).getByRole("combobox", { name: "Group by" });
  expect(Array.from(group.options).map((o) => o.textContent)).toEqual(["None", "Level", "Remote", "Market"]);
  fireEvent.change(group, { target: { value: "level" } });
  await waitFor(() => expect(query().group).toBe("level"));
  fireEvent.click(within(panel).getByRole("switch", { name: "Starred only" }));
  await waitFor(() => expect(query().starred).toBe("1"));
  fireEvent.click(within(panel).getByRole("button", { name: "Clear filters" }));
  await waitFor(() => expect(query().starred).toBeUndefined());
  expect(query().sort).toBe("salary:asc");
  expect(query().group).toBe("level");
});

test("group= shows one section per value, sorted, with a count, and (none) for rows without one", async () => {
  var d = docs();
  delete d["entities/role--a"].data.display.level;
  await mount("#/browse/roles?group=level", createStore("static", { docs: d }));
  await screen.findByRole("link", { name: "Clerk" });
  var heads = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
  expect(heads).toEqual(["(none) (1)", "senior (2)"]);
  var senior = screen.getByRole("region", { name: "senior (2)" });
  expect(within(senior).queryAllByRole("link", { name: /^(Analyst|Baker|Clerk)$/ }).map((a) => a.textContent)).toEqual(["Baker", "Clerk"]);
  var none = screen.getByRole("region", { name: "(none) (1)" });
  expect(within(none).getByRole("link", { name: "Analyst" })).toBeTruthy();
});

test("group= keeps values named like object members (constructor, __proto__) as ordinary groups", async () => {
  var d = docs();
  d["entities/role--a"].data.display.level = "constructor";
  d["entities/role--b"].data.display.level = "__proto__";
  await mount("#/browse/roles?group=level", createStore("static", { docs: d }));
  await screen.findByRole("link", { name: "Clerk" });
  var heads = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
  expect(heads).toEqual(["__proto__ (1)", "constructor (1)", "senior (1)"]);
  expect(within(screen.getByRole("region", { name: "__proto__ (1)" })).getByRole("link", { name: "Baker" })).toBeTruthy();
  expect(within(screen.getByRole("region", { name: "constructor (1)" })).getByRole("link", { name: "Analyst" })).toBeTruthy();
});

function pillStore() {
  var d = docs();
  var def = JSON.parse(JSON.stringify(DEFINITION));
  def.types.roles.fields.level.summary = true;
  d["meta/definition"] = { data: def };
  d["decisions/role--b"] = { data: { decision: "drop", reason: "too far", by: "uann", at: "2026-11-04T00:00:00Z" } };
  d["userstate/role--c"] = { data: { tags: ["senior"], star: true } };
  return createStore("static", { docs: d });
}

test("status pills carry counts and set status=; choice pills count the other filters' rows and set the field", async () => {
  await mount("#/browse/roles", pillStore());
  await screen.findByRole("link", { name: "Clerk" });
  var status = await screen.findByRole("radio", { name: "Dropped (1)" });
  expect(screen.getByRole("radio", { name: "Active (2)" }).checked).toBe(true);
  expect(screen.getByRole("radio", { name: "All (3)" })).toBeTruthy();
  expect(screen.getByRole("radio", { name: "junior (1)" })).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: "senior (1)" }));
  await waitFor(() => expect(query()["f.level"]).toBe("senior"));
  await waitFor(() => expect(rowTitles()).toEqual(["Clerk"]));
  fireEvent.click(status);
  await waitFor(() => expect(query().status).toBe("dropped"));
});

test("a pending drop shows its badge and reason, and the strip shows the type, last update and stars", async () => {
  await mount("#/browse/roles?status=all", pillStore());
  await screen.findByRole("link", { name: "Baker" });
  expect(await screen.findByText("Drop pending: too far")).toBeTruthy();
  expect(screen.getByText(/^Updated /)).toBeTruthy();
  expect(screen.getByText("1 starred")).toBeTruthy();
});

test("Select all matching selects every filtered row and asks before a bulk change, naming them", async () => {
  var store = writableStore();
  await mount("#/browse/roles", store);
  await screen.findByRole("link", { name: "Clerk" });
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Analyst" }));
  fireEvent.click(await screen.findByRole("button", { name: "Select all 3 matching" }));
  expect(await screen.findByText("3 selected")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Star" }));
  var ask = await screen.findByRole("alert");
  expect(ask.textContent).toContain("This changes 3 Roles: Analyst, Baker, Clerk.");
  expect(store.set).not.toHaveBeenCalled();
  fireEvent.click(within(ask).getByRole("button", { name: "Confirm" }));
  await waitFor(() => expect(store.set).toHaveBeenCalledTimes(3));
});

test("two selected rows offer Merge on the record page", async () => {
  await mount("#/browse/roles", writableStore());
  await screen.findByRole("link", { name: "Clerk" });
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Analyst" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Baker" }));
  var link = await screen.findByRole("link", { name: "Merge on the record page" });
  expect(link.getAttribute("href")).toBe("#/entity/role/a");
});

test("bulk actions are disabled on a read-only store", async () => {
  await mount("#/browse/roles");
  await screen.findByRole("link", { name: "Analyst" });
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Analyst" }));
  await screen.findByText("1 selected");
  expect(screen.getByRole("button", { name: "Star" }).disabled).toBe(true);
  expect(screen.getByText("Demo data, read only")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Export selected" }).disabled).toBe(false);
});

test("bulk Star writes userstate for each selected row, and Undo puts it back", async () => {
  var store = staticStore();
  store.readOnly = false;
  store.viewer = () => Promise.resolve("u1");
  store.set = vi.fn(() => Promise.resolve());
  store.del = vi.fn(() => Promise.resolve());
  await mount("#/browse/roles", store);
  await screen.findByRole("link", { name: "Analyst" });
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Analyst" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Clerk" }));
  fireEvent.click(await screen.findByRole("button", { name: "Star" }));
  await waitFor(() => expect(store.set).toHaveBeenCalledTimes(2));
  expect(store.set.mock.calls.map((c) => c[0]).sort()).toEqual(["userstate/role--a", "userstate/role--c"]);
  expect(store.set.mock.calls.find((c) => c[0] === "userstate/role--c")[1]).toEqual({ tags: ["senior"], star: true });
  fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
  await waitFor(() => expect(store.del).toHaveBeenCalledWith("userstate/role--a"));
  await waitFor(() => expect(store.set).toHaveBeenCalledWith("userstate/role--c", { tags: ["senior"] }));
});

test("bulk Restore shows only when a dropped row is selected, and restores each dropped row", async () => {
  var d = docs();
  d["entities/role--a"].data.status = "dropped";
  d["entities/role--a"].data.dropReason = "too far";
  delete d["decisions/role--a"];
  d["decisions/role--b"] = { data: { decision: "drop", reason: "not now", by: "u1", at: "2026-11-04T00:00:00Z" } };
  var store = createStore("static", { docs: d });
  store.readOnly = false;
  store.viewer = () => Promise.resolve("u1");
  store.set = vi.fn(() => Promise.resolve());
  store.del = vi.fn(() => Promise.resolve());
  await mount("#/browse/roles?status=all", store);
  await screen.findByRole("link", { name: "Clerk" });
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Clerk" }));
  await screen.findByText("1 selected");
  expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Analyst" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Baker" }));
  fireEvent.click(await screen.findByRole("button", { name: "Restore" }));
  // The routine's drop is overridden with Keep; the person's own drop is removed; the active row is left alone.
  await waitFor(() => expect(store.del).toHaveBeenCalledWith("decisions/role--b"));
  await waitFor(() => expect(store.set).toHaveBeenCalledWith("decisions/role--a", expect.objectContaining({ decision: "keep" })));
  expect(store.set.mock.calls.filter((c) => c[0] === "decisions/role--c")).toEqual([]);
  expect(await screen.findByText("Restored 2. Applies from the next run.")).toBeTruthy();
});

test("bulk Drop asks for a reason first", async () => {
  var store = staticStore();
  store.readOnly = false;
  store.viewer = () => Promise.resolve("u1");
  store.set = vi.fn(() => Promise.resolve());
  await mount("#/browse/roles", store);
  await screen.findByRole("link", { name: "Analyst" });
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Baker" }));
  fireEvent.click(await screen.findByRole("button", { name: "Drop" }));
  expect(await screen.findByText("Give a reason for the drop.")).toBeTruthy();
  expect(store.set).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox", { name: "Reason for the drop" }), { target: { value: "too far" } });
  fireEvent.click(screen.getByRole("button", { name: "Drop" }));
  await waitFor(() => expect(store.set).toHaveBeenCalledTimes(1));
  expect(store.set.mock.calls[0][0]).toBe("decisions/role--b");
  expect(store.set.mock.calls[0][1]).toMatchObject({ decision: "drop", reason: "too far", by: "u1" });
});

test("#/browse/roles?view=v1 applies the view filters", async () => {
  await mount("#/browse/roles?view=v1");
  await screen.findByRole("link", { name: "Baker" });
  await waitFor(() => expect(rowTitles()).toEqual(["Baker", "Clerk"]));
  expect(screen.getByText("View: Seniors")).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: "Search Roles" }), { target: { value: "clerk" } });
  await waitFor(() => expect(rowTitles()).toEqual(["Clerk"]));
  expect(query().view).toBe("v1");
});

test("explicit query params win over the view's stored filters", async () => {
  await mount("#/browse/roles?view=v1&q=analyst");
  await screen.findByRole("link", { name: "Analyst" });
  await waitFor(() => expect(rowTitles()).toEqual(["Analyst"]));
});

test("a view that does not exist says so and shows the plain list", async () => {
  await mount("#/browse/roles?view=gone");
  expect(await screen.findByText("That view no longer exists.")).toBeTruthy();
  await waitFor(() => expect(rowTitles()).toEqual(["Analyst", "Baker", "Clerk"]));
});

test("a field component gets props.record, and reads the row id from it", async () => {
  window.DESK_COMPONENTS = Object.create(null);
  window.DESK_COMPONENTS["salary-band"] = function (ctx, props, ui) {
    return ui.el("span", null, "row " + (props.record && props.record.id) + " field " + props.field);
  };
  await mount("#/m/senior");
  await screen.findByRole("link", { name: "Clerk" });
  expect(await screen.findByText("row role--c field band")).toBeTruthy();
});

function press(k) {
  fireEvent.keyDown(document.body, { key: k });
}

test("j and k move a row cursor over the links; o opens the peek there", async () => {
  await mount("#/browse/roles");
  await screen.findByRole("link", { name: "Clerk" });
  press("j");
  await waitFor(() => expect(document.activeElement.textContent).toBe("Analyst"));
  press("j");
  await waitFor(() => expect(document.activeElement.textContent).toBe("Baker"));
  press("k");
  await waitFor(() => expect(document.activeElement.textContent).toBe("Analyst"));
  press("o");
  await waitFor(() => expect(query().peek).toBe("role--a"));
  expect(await screen.findByRole("dialog", { name: "Analyst" })).toBeTruthy();
});

test("with the peek open, j moves the peek to the next row", async () => {
  await mount("#/browse/roles?peek=role--a");
  await screen.findByRole("dialog", { name: "Analyst" });
  press("j");
  await waitFor(() => expect(query().peek).toBe("role--b"));
});

test("/ focuses the search box on Browse instead of opening the palette", async () => {
  await mount("#/browse/roles");
  await screen.findByRole("link", { name: "Clerk" });
  press("/");
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Search Roles" })));
  expect(screen.queryByPlaceholderText("Search or jump to")).toBeNull();
});

test("a change to this type's records re-reads the list; the first answer is not a change", async () => {
  var store = staticStore();
  var list = store.list, subscribe = store.subscribe, added = false, live = null, liveQ = null, reads = 0;
  store.list = function (coll, q) {
    if (coll === "entities") reads++;
    return list.call(store, coll, q).then((rows) => (coll === "entities" && added
      ? rows.concat([Object.assign({ id: "role--d" }, entity("d", "Dancer", 400, "2026-11-04T00:00:00Z"))]) : rows));
  };
  store.subscribe = function (coll, cb, q) {
    if (coll === "entities") { live = cb; liveQ = q; return () => {}; } // the test sends every answer itself
    return subscribe.call(store, coll, cb, q);
  };
  await mount("#/browse/roles", store);
  await screen.findByRole("link", { name: "Clerk" });
  await waitFor(() => expect(live).toBeTruthy());
  expect(liveQ.where).toEqual([["type", "==", "roles"]]);
  var before = reads;
  live([]);
  await new Promise((r) => setTimeout(r, 20));
  expect(reads).toBe(before);
  added = true;
  live([]);
  expect(await screen.findByRole("link", { name: "Dancer" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Clerk" })).toBeTruthy();
});

test("a burst of changes to this type's records re-reads the list once", async () => {
  var store = staticStore();
  var list = store.list, subscribe = store.subscribe, live = null, fullReads = 0;
  store.list = function (coll, q) {
    if (coll === "entities" && q.orderBy[0] === "key") fullReads++;
    return list.call(store, coll, q);
  };
  store.subscribe = function (coll, cb, q) {
    if (coll === "entities") { live = cb; return () => {}; }
    return subscribe.call(store, coll, cb, q);
  };
  await mount("#/browse/roles", store);
  await screen.findByRole("link", { name: "Clerk" });
  await waitFor(() => expect(live).toBeTruthy());
  live([]);
  var before = fullReads;
  for (var i = 0; i < 4; i++) await act(async () => { live([]); await new Promise((r) => setTimeout(r, 40)); });
  await waitFor(() => expect(fullReads).toBe(before + 1), { timeout: 2000 });
  await new Promise((r) => setTimeout(r, CHANGE_SETTLE_MS + 100));
  expect(fullReads).toBe(before + 1);
});

test("Browse reads at most FULL_STEP * FULL_READ_MAX records and says so when it hits that cap", async () => {
  var store = staticStore();
  var list = store.list, calls = 0;
  store.list = function (coll, q) {
    if (coll !== "entities") return list.call(store, coll, q);
    if (q.orderBy[0] !== "key") return Promise.resolve([]); // the first-page read; only full-read steps count
    if (q.limit === 1) return Promise.resolve([{ id: "role--more", data: { type: "roles", key: "zzzzzz", status: "active" } }]); // the store holds more
    var n = calls++;
    var out = [];
    for (var i = 0; i < FULL_STEP; i++) {
      var k = String(n * FULL_STEP + i).padStart(6, "0");
      out.push({ id: "role--" + k, data: { type: "roles", key: k, status: "active", lastSeen: "2026-11-01T00:00:00Z", display: { title: "R" + k } } });
    }
    return Promise.resolve(out);
  };
  await mount("#/browse/roles", store);
  expect(await screen.findByText("Read the first 30000 Roles, the most this list holds. Search, filters and counts cover those only.",
    {}, { timeout: 20000 })).toBeTruthy();
  expect(calls).toBe(FULL_READ_MAX);
  expect(screen.getByText(/^Showing 100 of 30000 matching Roles/)).toBeTruthy();
}, 30000);

// A store whose full read (key order) waits for release(), or fails with fail(); page reads answer at once.
function heldStore(base) {
  var store = base || staticStore();
  var list = store.list, held = [], pageReads = [];
  store.list = function (coll, q) {
    if (coll !== "entities") return list.call(store, coll, q);
    if (q.orderBy[0] !== "key") { pageReads.push(q); return list.call(store, coll, q); }
    return new Promise((ok, no) => held.push({ ok: () => list.call(store, coll, q).then(ok, no), no: no }));
  };
  return {
    store: store, pageReads: pageReads,
    release: () => held.splice(0).forEach((h) => h.ok()),
    fail: (e) => held.splice(0).forEach((h) => h.no(e)),
    waitHeld: () => waitFor(() => expect(held.length).toBeGreaterThan(0)),
  };
}

test("the first page paints before the full read answers; search, filters and counts wait for it", async () => {
  var h = heldStore();
  await mount("#/browse/roles", h.store);
  await screen.findByRole("link", { name: "Clerk" });
  await h.waitHeld();
  expect(rowTitles()).toEqual(["Analyst", "Baker", "Clerk"]);
  expect(h.pageReads[0]).toMatchObject({ where: [["type", "==", "roles"], ["status", "==", "active"]], orderBy: ["lastSeen", "desc"], limit: 100 });
  expect(screen.getByText("Showing the first 3 Roles. Loading all Roles…")).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "Search Roles" }).disabled).toBe(true);
  expect(screen.getByRole("button", { name: "Filters" }).disabled).toBe(true);
  expect(screen.getByRole("button", { name: "Export" }).disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "Add calculation" })).toBeNull();
  await act(async () => { h.release(); });
  expect(await screen.findByText(/^Showing 3 of 3 matching Roles/)).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "Search Roles" }).disabled).toBe(false);
  expect(screen.getByRole("button", { name: "Filters" }).disabled).toBe(false);
  expect(screen.getByRole("button", { name: "Add calculation" })).toBeTruthy();
});

test("the first page reads only the records the status filter shows", async () => {
  var d = docs();
  d["entities/role--a"].data.status = "dropped";
  var h = heldStore(createStore("static", { docs: d }));
  await mount("#/browse/roles", h.store);
  await screen.findByRole("link", { name: "Clerk" });
  await h.waitHeld();
  expect(h.pageReads[0].where).toEqual([["type", "==", "roles"], ["status", "==", "active"]]);
  expect(rowTitles()).toEqual(["Baker", "Clerk"]);
  expect(screen.getByText("Showing the first 2 Roles. Loading all Roles…")).toBeTruthy();
  await act(async () => { h.release(); });
  expect(await screen.findByText(/^Showing 2 of 2 matching Roles/)).toBeTruthy();
});

test("a type with no records paints empty from the first page, then the full read agrees", async () => {
  var d = docs();
  ["a", "b", "c"].forEach((k) => { delete d["entities/role--" + k]; });
  var h = heldStore(createStore("static", { docs: d }));
  await mount("#/browse/roles", h.store);
  expect(await screen.findByText("No Roles yet.")).toBeTruthy();
  await h.waitHeld();
  expect(screen.getByText("Showing the first 0 Roles. Loading all Roles…")).toBeTruthy();
  await act(async () => { h.release(); });
  expect(await screen.findByText(/^Showing 0 of 0 matching Roles/)).toBeTruthy();
  expect(screen.getByText("No Roles yet.")).toBeTruthy();
});

// Every hook runs before the page's error return; a read that fails outright shows the error page (React #300 before).
test("a read that fails outright shows the error page with Try again", async () => {
  var store = staticStore();
  var list = store.list;
  store.list = (coll, q) => (coll === "entities" ? Promise.reject(new Error("The read was refused.")) : list.call(store, coll, q));
  await mount("#/browse/roles", store);
  expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
  expect(screen.getByText(/The read was refused\./)).toBeTruthy();
});

test("a full read that fails while the first page shows says so, keeps the rows, and Try again reads again", async () => {
  var h = heldStore();
  await mount("#/browse/roles", h.store);
  await screen.findByRole("link", { name: "Clerk" });
  await h.waitHeld();
  await act(async () => { h.fail(new Error("The read was refused.")); });
  expect(await screen.findByText("Could not read all Roles")).toBeTruthy();
  expect(screen.getByText(/^The read was refused\. Search, filters and counts need every record\./)).toBeTruthy();
  expect(rowTitles()).toEqual(["Analyst", "Baker", "Clerk"]);
  expect(screen.getByText("Showing the first 3 Roles")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await h.waitHeld();
  await act(async () => { h.release(); });
  expect(await screen.findByText(/^Showing 3 of 3 matching Roles/)).toBeTruthy();
  expect(screen.queryByText("Could not read all Roles")).toBeNull();
});

test("a list the store cannot sort waits for the full read instead of a first page", async () => {
  var h = heldStore();
  await mount("#/browse/roles?q=clerk", h.store);
  await h.waitHeld();
  expect(h.pageReads).toEqual([]);
  expect(rowTitles()).toEqual([]);
  await act(async () => { h.release(); });
  await screen.findByRole("link", { name: "Clerk" });
  expect(rowTitles()).toEqual(["Clerk"]);
});

function writableStore() {
  var store = staticStore();
  store.readOnly = false;
  store.viewer = () => Promise.resolve("u1");
  store.set = vi.fn(() => Promise.resolve());
  store.del = vi.fn(() => Promise.resolve());
  return store;
}

test("Save view stores the current filters as a kept view and opens it, with no read after", async () => {
  var store = writableStore();
  await mount("#/browse/roles?f.level=senior", store);
  await screen.findByRole("link", { name: "Clerk" });
  fireEvent.click(screen.getByRole("button", { name: "Save view" }));
  var name = await screen.findByRole("textbox", { name: "View name" });
  var dialog = name.closest("[role=dialog]");
  fireEvent.click(await within(dialog).findByRole("button", { name: "Save view" }));
  expect(await within(dialog).findByText("Name the view first.")).toBeTruthy();
  expect(store.set).not.toHaveBeenCalled();
  var get = vi.spyOn(store, "get");
  fireEvent.change(name, { target: { value: "Mine" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save view" }));
  await waitFor(() => expect(store.set).toHaveBeenCalledTimes(1));
  var [path, doc] = store.set.mock.calls[0];
  expect(path).toMatch(/^views\/v-[a-z0-9]+$/);
  expect(doc).toMatchObject({ type: "roles", name: "Mine", state: "kept", madeBy: "u1", filters: { fields: { level: "senior" } } });
  await waitFor(() => expect(query().view).toBe(path.slice(6)));
  expect(await screen.findByText("View: Mine")).toBeTruthy();
  expect(get).not.toHaveBeenCalledWith(path);
});

test("the view menu lists All, Dropped and this type's views, marks the open one, and links All views", async () => {
  await mount("#/browse/roles?view=v1");
  await screen.findByRole("link", { name: "Baker" });
  fireEvent.click(screen.getByRole("button", { name: "Views" }));
  var seniors = await screen.findByRole("menuitem", { name: "Seniors" });
  // Mantine's menu transition can leave display:none on the dropdown in jsdom, so the rest is read with hidden: true.
  var items = Array.from(seniors.closest("[role=menu]").querySelectorAll("[role=menuitem]")).map((i) => i.textContent);
  expect(items).toEqual(["All Roles", "Dropped", "Seniors", "All views"]);
  expect(seniors.getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("menuitem", { name: "All views", hidden: true }).getAttribute("href")).toBe("#/settings/views");
  expect(screen.getByRole("menuitem", { name: "Dropped", hidden: true }).getAttribute("href")).toBe("#/browse/roles?status=dropped");
});

test("a view whose filters were changed shows Modified on Save view", async () => {
  await mount("#/browse/roles?view=v1", writableStore());
  await screen.findByRole("link", { name: "Baker" });
  expect(screen.queryByText("Modified")).toBeNull();
  fireEvent.change(screen.getByRole("textbox", { name: "Search Roles" }), { target: { value: "clerk" } });
  expect(await screen.findByText("Modified")).toBeTruthy();
});

test("the palette offers Save view as new, Update view and Rename view on a view the viewer may edit", async () => {
  var store = writableStore();
  await mount("#/browse/roles?view=v1", store);
  await screen.findByRole("link", { name: "Baker" });
  fireEvent.change(screen.getByRole("textbox", { name: "Search Roles" }), { target: { value: "clerk" } });
  await waitFor(() => expect(rowTitles()).toEqual(["Clerk"]));
  act(() => spotlight.open());
  expect(await screen.findByText("Save view as new")).toBeTruthy();
  expect(screen.getByText("Rename view Seniors")).toBeTruthy();
  fireEvent.click(screen.getByText("Update view Seniors"));
  await waitFor(() => expect(store.set).toHaveBeenCalledTimes(1));
  var [path, doc] = store.set.mock.calls[0];
  expect(path).toBe("views/v1");
  expect(doc).toMatchObject({ type: "roles", name: "Seniors", filters: { q: "clerk" } });
});

test("Rename view from the palette opens Save view with the name ready to change", async () => {
  await mount("#/browse/roles?view=v1", writableStore());
  await screen.findByRole("link", { name: "Baker" });
  act(() => spotlight.open());
  fireEvent.click(await screen.findByText("Rename view Seniors"));
  var name = await screen.findByRole("textbox", { name: "View name" });
  expect(name.value).toBe("Seniors");
  expect(within(name.closest("[role=dialog]")).getByRole("button", { name: "Update view" })).toBeTruthy();
});

test("the palette has no view commands on a read-only store", async () => {
  await mount("#/browse/roles?view=v1");
  await screen.findByRole("link", { name: "Baker" });
  act(() => spotlight.open());
  await screen.findByPlaceholderText("Search or jump to");
  expect(screen.queryByText("Save view as new")).toBeNull();
  expect(screen.queryByText(/^Update view/)).toBeNull();
});

test("Save view is absent on a read-only store", async () => {
  await mount("#/browse/roles");
  await screen.findByRole("link", { name: "Analyst" });
  expect(screen.queryByRole("button", { name: "Save view" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Star Analyst" })).toBeNull();
});

test("each row has a Star toggle that writes the viewer's userstate", async () => {
  var store = writableStore();
  await mount("#/browse/roles", store);
  await screen.findByRole("link", { name: "Analyst" });
  var star = screen.getByRole("button", { name: "Star Clerk" });
  expect(star.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(star);
  await waitFor(() => expect(store.set).toHaveBeenCalledWith("userstate/role--c", { tags: ["senior"], star: true }));
  var unstar = await screen.findByRole("button", { name: "Unstar Clerk" });
  expect(unstar.getAttribute("aria-pressed")).toBe("true");
  expect(window.location.hash).not.toMatch(/peek=/);
});

// A writable store whose watches answer again after every write, as the db store does.
function liveStore() {
  var d = docs();
  var store = createStore("static", { docs: d });
  store.readOnly = false;
  store.viewer = () => Promise.resolve("u1");
  var subs = [], subscribe = store.subscribe;
  store.subscribe = function (coll, cb, q) {
    var s = { coll: coll, cb: cb, q: q };
    subs.push(s);
    var stop = subscribe.call(store, coll, cb, q);
    return () => { subs.splice(subs.indexOf(s), 1); stop(); };
  };
  function notify(path) {
    var coll = path.slice(0, path.lastIndexOf("/"));
    subs.filter((s) => s.coll === coll).forEach((s) => store.list(coll, s.q).then(s.cb));
  }
  store.set = vi.fn((path, data) => { d[path] = { data: data }; notify(path); return Promise.resolve(); });
  store.del = vi.fn((path) => { delete d[path]; notify(path); return Promise.resolve(); });
  store.write = (path, data) => act(async () => { await store.set(path, data); await new Promise((r) => setTimeout(r, 10)); });
  return store;
}

function lastSet(store, path) {
  var calls = store.set.mock.calls.filter((c) => c[0] === path);
  return calls.length ? calls[calls.length - 1][1] : undefined;
}

test("a star then a userstate change from elsewhere: the row reads the new doc and Unstar keeps its tags", async () => {
  var store = liveStore();
  await mount("#/browse/roles", store);
  await screen.findByRole("link", { name: "Clerk" });
  fireEvent.click(screen.getByRole("button", { name: "Star Clerk" }));
  await screen.findByRole("button", { name: "Unstar Clerk" });
  await store.write("userstate/role--c", { tags: ["senior", "x"], star: true });
  fireEvent.click(screen.getByRole("button", { name: "Unstar Clerk" }));
  await waitFor(() => expect(lastSet(store, "userstate/role--c")).toEqual({ tags: ["senior", "x"], star: false }));
});

test("bulk Tag after a star, then Unstar, keeps the tag", async () => {
  var store = liveStore();
  await mount("#/browse/roles", store);
  await screen.findByRole("link", { name: "Clerk" });
  fireEvent.click(screen.getByRole("button", { name: "Star Clerk" }));
  await screen.findByRole("button", { name: "Unstar Clerk" });
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Clerk" }));
  fireEvent.change(await screen.findByRole("textbox", { name: "Tag name" }), { target: { value: "x" } });
  fireEvent.click(screen.getByRole("button", { name: "Tag" }));
  await waitFor(() => expect(lastSet(store, "userstate/role--c")).toEqual({ tags: ["senior", "x"], star: true }));
  await act(() => new Promise((r) => setTimeout(r, 10)));
  fireEvent.click(screen.getByRole("button", { name: "Unstar Clerk" }));
  await waitFor(() => expect(lastSet(store, "userstate/role--c")).toEqual({ tags: ["senior", "x"], star: false }));
});

test("bulk Unstar after a star shows the row unstarred", async () => {
  var store = liveStore();
  await mount("#/browse/roles", store);
  await screen.findByRole("link", { name: "Clerk" });
  fireEvent.click(screen.getByRole("button", { name: "Star Clerk" }));
  await screen.findByRole("button", { name: "Unstar Clerk" });
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Clerk" }));
  fireEvent.click(await screen.findByRole("button", { name: "Unstar" }));
  await waitFor(() => expect(lastSet(store, "userstate/role--c")).toEqual({ tags: ["senior"], star: false }));
  expect(await screen.findByRole("button", { name: "Star Clerk" })).toBeTruthy();
});

function storeWith(extra, defPatch) {
  var d = Object.assign(docs(), extra || {});
  if (defPatch) d["meta/definition"] = { data: Object.assign({}, DEFINITION, defPatch) };
  return createStore("static", { docs: d });
}

var ACTIVE_VIEW = { "views/v2": { data: { type: "roles", name: "Active seniors", state: "kept",
  filters: { status: "active", fields: { level: "senior" } } } } };

test("on ?view= removing the view's last filter chip stays removed", async () => {
  await mount("#/browse/roles?view=v2", storeWith(ACTIVE_VIEW));
  await waitFor(() => expect(rowTitles()).toEqual(["Baker", "Clerk"]));
  fireEvent.click(screen.getByRole("button", { name: "Remove filter Level: senior" }));
  await waitFor(() => expect(rowTitles()).toEqual(["Analyst", "Baker", "Clerk"]));
  await new Promise((r) => setTimeout(r, 20));
  expect(rowTitles()).toEqual(["Analyst", "Baker", "Clerk"]);
  expect(screen.queryByRole("button", { name: "Remove filter Level: senior" })).toBeNull();
  expect(query().view).toBe("v2");
});

test("on ?view= Clear filters clears the view's filters", async () => {
  await mount("#/browse/roles?view=v2", storeWith(ACTIVE_VIEW));
  await waitFor(() => expect(rowTitles()).toEqual(["Baker", "Clerk"]));
  fireEvent.click(screen.getByRole("button", { name: "Filters" }));
  var panel = await screen.findByRole("dialog", { name: "Filters" });
  fireEvent.click(within(panel).getByRole("button", { name: "Clear filters" }));
  await waitFor(() => expect(rowTitles()).toEqual(["Analyst", "Baker", "Clerk"]));
});

test("on a module page clearing the search does not snap back to the module's search", async () => {
  var store = storeWith(null, { desk: { modules: [{ id: "senior", kind: "view", label: "Senior roles",
    view: { type: "roles", filters: { tag: "senior", status: "active", q: "cl" } } }] } });
  await mount("#/m/senior", store);
  await screen.findByRole("link", { name: "Clerk" });
  var box = screen.getByRole("textbox", { name: "Search Roles" });
  expect(box.value).toBe("cl");
  fireEvent.change(box, { target: { value: "" } });
  await new Promise((r) => setTimeout(r, 20));
  expect(screen.getByRole("textbox", { name: "Search Roles" }).value).toBe("");
  expect(screen.queryByRole("button", { name: "Remove filter Search: cl" })).toBeNull();
});

test("on a view with no status filter, choosing Active hides dropped records", async () => {
  var dancer = entity("d", "Dancer", 400, "2026-11-04T00:00:00Z");
  dancer.data.status = "dropped";
  await mount("#/browse/roles?view=v3", storeWith({ "entities/role--d": dancer,
    "views/v3": { data: { type: "roles", name: "Everything", state: "kept", filters: {} } } }));
  await screen.findByRole("link", { name: "Dancer" });
  fireEvent.click(screen.getByRole("button", { name: "Filters" }));
  var panel = await screen.findByRole("dialog", { name: "Filters" });
  fireEvent.click(within(panel).getByRole("radio", { name: "Active" }));
  await waitFor(() => expect(screen.queryByRole("link", { name: "Dancer" })).toBeNull());
  expect(rowTitles()).toEqual(["Analyst", "Baker", "Clerk"]);
});

test("browse row, o key and peek open carry the filters", async () => {
  await mount("#/browse/roles?f.level=senior&sort=salary:asc");
  var row = await screen.findByRole("link", { name: "Baker" });
  expect(row.getAttribute("href")).toBe("#/entity/role/b?f.level=senior&sort=salary%3Aasc");
  // o with the peek open goes to the record with the same filters and without the peek key.
  window.history.replaceState(null, "", "#/browse/roles?f.level=senior&sort=salary:asc&peek=role--b");
  window.dispatchEvent(new Event("desk:route"));
  var drawer = await screen.findByRole("dialog", { name: "Baker" });
  expect(within(drawer).getByRole("link", { name: "Open record" }).getAttribute("href")).toBe("#/entity/role/b?f.level=senior&sort=salary%3Aasc");
  press("o");
  await waitFor(() => expect(window.location.hash).toBe("#/entity/role/b?f.level=senior&sort=salary%3Aasc"));
});

test("a saved view in the address is expanded to explicit filter keys in the record link", async () => {
  await mount("#/browse/roles?view=v1");
  var row = await screen.findByRole("link", { name: "Baker" });
  expect(row.getAttribute("href")).toContain("f.level=senior");
  expect(row.getAttribute("href")).not.toContain("view=");
});

test("a record link from an unfiltered list stays bare", async () => {
  await mount("#/browse/roles");
  expect((await screen.findByRole("link", { name: "Baker" })).getAttribute("href")).toBe("#/entity/role/b");
});

var HEALTH_DEF = Object.assign({}, DEFINITION, { desk: { health: { roles: { field: "level", red: ["junior"], yellow: [], green: ["senior"] } } } });

function healthStore(def) {
  var d = docs();
  d["meta/definition"] = { data: def };
  return createStore("static", { docs: d });
}

test("a declared status field shows the status chips above the table and the not-green footer", async () => {
  await mount("#/browse/roles", healthStore(HEALTH_DEF));
  await screen.findByRole("link", { name: "Analyst" });
  var chips = screen.getByRole("radiogroup", { name: "Health" });
  expect(within(chips).getByText("All")).toBeTruthy();
  ["Needs action", "Check", "All good"].forEach((n) => expect(within(chips).getByText(new RegExp("^" + n))).toBeTruthy());
  var table = screen.getAllByRole("table")[0];
  expect(chips.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByText("1 item not green yet")).toBeTruthy();
});

test("with no status field declared there are no health chips and no not-green footer", async () => {
  await mount("#/browse/roles");
  await screen.findByRole("link", { name: "Analyst" });
  expect(screen.queryByRole("radiogroup", { name: "Health" })).toBeNull();
  expect(screen.queryByText(/not green yet/)).toBeNull();
});
