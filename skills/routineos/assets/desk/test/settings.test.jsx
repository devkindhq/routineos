import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { notifications } from "@mantine/notifications";
import App from "../app/App.jsx";
import { READ_ONLY_NOTE } from "../core/actions.js";
import { forgetLockPass, hashPin, lockPassed, rememberLockPass } from "../core/lock.js";
import { DENSITY_KEY, MOTION_KEY, THEME_KEY } from "../core/prefs.js";
import { checkSetting } from "../core/pages/settings.js";
import { SETTINGS_SECTIONS } from "../core/router.js";
import { ReadOnlyError, createStore } from "../core/store.js";

var DEFINITION = {
  types: { roles: { label: "Role", plural: "Roles", fields: { title: { label: "Title", type: "text" } } } },
  producers: [{ id: "scout", label: "Scout", types: ["roles"], schedule: "0 6 * * *",
    settings: [{ name: "max_items", label: "Max items", type: "number", min: 1, max: 50, default: 10 }] }],
};

var OWNER = { "meta/owner": { data: { by: "u1", at: "2026-11-01T00:00:00Z" } } };

function staticStore(extra) {
  return createStore("static", { docs: Object.assign({
    "meta/definition": { data: DEFINITION },
    "meta/workspace": { data: { name: "Test workspace" } },
  }, extra || {}) });
}

// A store a person can write to. The owner test also needs the host to say this viewer owns the Desk.
function writable(store, viewer, owner) {
  store.readOnly = false;
  store.viewer = () => Promise.resolve(viewer || "u1");
  store.isOwner = () => Promise.resolve(!!owner);
  store.set = vi.fn(() => Promise.resolve());
  store.del = vi.fn(() => Promise.resolve());
  return store;
}

async function mount(hash, store, config) {
  window.history.replaceState(null, "", hash);
  render(<App store={store || staticStore()} config={Object.assign({ store: "static", workspace: "Test workspace" }, config || {})} />);
  return screen.findByRole("heading", { level: 1, name: "Settings" });
}

var HEADINGS = {
  appearance: "Appearance", notifications: "Routine notifications", shortcuts: "Shortcuts", routine: "Routine",
  "routine-notifications": "Routine notifications", members: "Members", modules: "Modules", views: "Saved views",
  tour: "Starter tour", lock: "Privacy PIN", export: "Export", history: "Settings history", about: "About",
};

beforeEach(() => {
  try { localStorage.clear(); } catch (e) { /* storage blocked */ }
  try { sessionStorage.clear(); } catch (e) { /* storage blocked */ }
  forgetLockPass();
  notifications.clean();
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "#/today");
});

test("there are 13 sections", () => {
  expect(SETTINGS_SECTIONS.length).toBe(13);
  expect(Object.keys(HEADINGS).sort()).toEqual(SETTINGS_SECTIONS.slice().sort());
});

test.each(SETTINGS_SECTIONS)("#/settings/%s renders its section", async (section) => {
  await mount("#/settings/" + section);
  expect(await screen.findByRole("heading", { level: 2, name: HEADINGS[section] })).toBeTruthy();
  expect(screen.getByRole("navigation", { name: "Settings sections" })).toBeTruthy();
});

test("?section= redirects to the section address", async () => {
  await mount("#/settings?section=lock");
  expect(await screen.findByRole("heading", { level: 2, name: "Privacy PIN" })).toBeTruthy();
  expect(window.location.hash).toBe("#/settings/lock");
});

test("appearance changes theme, density and motion under the unchanged keys", async () => {
  await mount("#/settings/appearance");
  fireEvent.click(within(screen.getByRole("radiogroup", { name: "Theme" })).getByLabelText("Dark"));
  fireEvent.click(within(screen.getByRole("radiogroup", { name: "Density" })).getByLabelText("Compact"));
  fireEvent.click(within(screen.getByRole("radiogroup", { name: "Motion" })).getByLabelText("Reduce"));
  await waitFor(() => expect(localStorage.getItem(THEME_KEY)).toBe("dark"));
  expect(localStorage.getItem(DENSITY_KEY)).toBe("compact");
  expect(localStorage.getItem(MOTION_KEY)).toBe("reduce");
});

test("a setting outside checkSetting bounds shows the error and does not write; a good value writes", async () => {
  var store = writable(staticStore());
  await mount("#/settings/routine", store);
  var box = await screen.findByLabelText("Max items");
  fireEvent.change(box, { target: { value: "99" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("At most 50.")).toBeTruthy();
  expect(store.set).not.toHaveBeenCalled();
  fireEvent.change(box, { target: { value: "20" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(store.set).toHaveBeenCalledWith("settings/scout", expect.objectContaining({ values: { max_items: 20 } })));
  await waitFor(() => expect(store.set.mock.calls.some((c) => /^settingsHistory\/scout--/.test(c[0]))).toBe(true));
});

test("a write refused with ReadOnlyError toasts and rolls the form back", async () => {
  var store = writable(staticStore());
  store.set = vi.fn(() => Promise.reject(new ReadOnlyError("read only")));
  await mount("#/settings/routine", store);
  var box = await screen.findByLabelText("Max items");
  fireEvent.change(box, { target: { value: "20" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText(READ_ONLY_NOTE)).toBeTruthy();
  await waitFor(() => expect(screen.getByLabelText("Max items").value).toBe("10"));
});

test("a read-only store shows the routine values with no write controls", async () => {
  await mount("#/settings/routine");
  expect(await screen.findByLabelText("Max items")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  expect(screen.getAllByText(new RegExp(READ_ONLY_NOTE)).length).toBeGreaterThan(0);
});

test("lock: the owner sets a PIN with PBKDF2 at 310000 iterations, then the lock screen opens with it", async () => {
  var store = writable(staticStore(OWNER), "u1", true);
  await mount("#/settings/lock", store);
  fireEvent.change(await screen.findByLabelText("New PIN (6 digits)"), { target: { value: "123456" } });
  fireEvent.change(screen.getByLabelText("Repeat the PIN"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Set PIN" }));
  await waitFor(() => expect(store.set).toHaveBeenCalledWith("meta/lock", expect.any(Object)), { timeout: 10000 });
  var doc = store.set.mock.calls.filter((c) => c[0] === "meta/lock")[0][1];
  expect(doc.iterations).toBe(310000);
  expect(doc.algo).toBe("PBKDF2-SHA-256");
  expect(doc.hash).toBe(await hashPin("123456", doc.salt, 310000));
  expect(await screen.findByText("A PIN is set. Each browser tab asks for it once.")).toBeTruthy();
  cleanup();

  forgetLockPass();
  expect(lockPassed(doc.salt)).toBe(false);
  window.history.replaceState(null, "", "#/settings/lock");
  render(<App store={staticStore(Object.assign({ "meta/lock": { data: doc } }, OWNER))} config={{ store: "static" }} />);
  var pin = await screen.findByLabelText("PIN");
  expect(screen.queryByRole("heading", { level: 1, name: "Settings" })).toBeNull();
  fireEvent.change(pin, { target: { value: "654321" } });
  fireEvent.click(screen.getByRole("button", { name: "Open the Desk" }));
  expect(await screen.findByText("That PIN is not right.", {}, { timeout: 10000 })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("PIN"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Open the Desk" }));
  expect(await screen.findByRole("heading", { level: 1, name: "Settings" }, { timeout: 10000 })).toBeTruthy();
  expect(lockPassed(doc.salt)).toBe(true);
}, 30000);

test("a lock pass holds only for the PIN it was made for", async () => {
  forgetLockPass();
  try { sessionStorage.setItem("routineos-desk-unlocked", "1"); } catch (e) { /* storage blocked */ }
  expect(lockPassed("00112233445566778899aabbccddeeff")).toBe(false);
  rememberLockPass("00112233445566778899aabbccddeeff");
  expect(lockPassed("00112233445566778899aabbccddeeff")).toBe(true);
  expect(lockPassed("ffeeddccbbaa99887766554433221100")).toBe(false);
  forgetLockPass();
  expect(lockPassed("00112233445566778899aabbccddeeff")).toBe(false);
});

test("a PIN changed elsewhere asks again in a tab that passed the old one", async () => {
  forgetLockPass();
  var oldLock = { algo: "PBKDF2-SHA-256", salt: "00112233445566778899aabbccddeeff", iterations: 100000 };
  oldLock.hash = await hashPin("123456", oldLock.salt, 100000);
  var newLock = { algo: "PBKDF2-SHA-256", salt: "ffeeddccbbaa99887766554433221100", iterations: 100000 };
  newLock.hash = await hashPin("222222", newLock.salt, 100000);
  rememberLockPass(oldLock.salt);
  window.history.replaceState(null, "", "#/settings/lock");
  render(<App store={staticStore(Object.assign({ "meta/lock": { data: newLock } }, OWNER))} config={{ store: "static" }} />);
  expect(await screen.findByLabelText("PIN")).toBeTruthy();
  expect(screen.queryByRole("heading", { level: 1, name: "Settings" })).toBeNull();
}, 30000);

test("a member sees no owner-only controls for the PIN or the tour", async () => {
  var store = writable(staticStore(OWNER), "u2");
  try { localStorage.setItem("routineos-desk-tour-done", "1"); } catch (e) { /* storage blocked */ }
  await mount("#/settings/lock", store, { tour: true });
  expect(await screen.findByText("Only the owner can set, change or remove the PIN.")).toBeTruthy();
  expect(screen.queryByLabelText("New PIN (6 digits)")).toBeNull();
  expect(screen.queryByRole("button", { name: "Set PIN" })).toBeNull();
  fireEvent.click(screen.getByRole("link", { name: "Starter tour" }));
  expect(await screen.findByRole("button", { name: "Take the tour" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Turn the tour/ })).toBeNull();
});

test("the owner turns the tour off through settings/workspace", async () => {
  var store = writable(staticStore(OWNER), "u1", true);
  try { localStorage.setItem("routineos-desk-tour-done", "1"); } catch (e) { /* storage blocked */ }
  await mount("#/settings/tour", store, { tour: true });
  fireEvent.click(await screen.findByRole("button", { name: "Turn the tour off" }));
  await waitFor(() => expect(store.set).toHaveBeenCalledWith("settings/workspace", expect.objectContaining({ values: { tour: false } })));
  expect(await screen.findByText("The starter tour is off for everyone.")).toBeTruthy();
});

test("saved views: Pin writes the viewer's pin and Keep keeps a proposed view", async () => {
  var store = writable(staticStore({
    "views/agent-pick": { data: { type: "roles", name: "Agent pick", state: "proposed", madeBy: "agent", producer: "scout", filters: {} } },
  }));
  await mount("#/settings/views", store);
  var row = (await screen.findByText("Agent pick")).closest("[data-view]");
  fireEvent.click(within(row).getByRole("button", { name: "Pin" }));
  await waitFor(() => expect(store.set).toHaveBeenCalledWith("data/users/u1/state/pin/agent-pick", expect.any(Object)));
  fireEvent.click(within(row).getByRole("button", { name: "Keep" }));
  await waitFor(() => expect(store.set).toHaveBeenCalledWith("views/agent-pick", expect.objectContaining({ state: "kept" })));
});

test("modules: a sidebar switch saves nav.hidden to settings/workspace", async () => {
  var defn = Object.assign({}, DEFINITION, { desk: { modules: [{ kind: "view", id: "board", label: "Board", view: { type: "roles" } }] } });
  var store = writable(createStore("static", { docs: { "meta/definition": { data: defn }, "meta/workspace": { data: { name: "W" } } } }));
  window.history.replaceState(null, "", "#/settings/modules");
  render(<App store={store} config={{ store: "static" }} />);
  var sw = await screen.findByLabelText(/Board/);
  if (sw.getAttribute("data-module") === null) throw new Error("the switch input carries no data-module");
  fireEvent.click(sw);
  fireEvent.click(screen.getByRole("button", { name: "Save sidebar" }));
  await waitFor(() => expect(store.set).toHaveBeenCalledWith("settings/workspace", expect.objectContaining({ values: { nav: { hidden: ["board"] } } })));
});

test("members: the first column is headed Name", async () => {
  var store = writable(createStore("static", { docs: Object.assign({
    "meta/definition": { data: DEFINITION }, "meta/workspace": { data: { name: "W" } },
    "decisions/roles--a": { data: { decision: "keep", by: "u1", at: "2026-11-02T00:00:00Z" } },
  }, OWNER) }));
  window.history.replaceState(null, "", "#/settings/members");
  render(<App store={store} config={{ store: "static" }} />);
  expect(await screen.findByRole("columnheader", { name: "Name" })).toBeTruthy();
  expect(screen.queryByRole("columnheader", { name: "Person" })).toBeNull();
});

test("modules: the built-in pages carry a Core badge and the view modules do not", async () => {
  var defn = Object.assign({}, DEFINITION, { desk: { modules: [{ kind: "view", id: "board", label: "Board", view: { type: "roles" } }] } });
  var store = createStore("static", { docs: { "meta/definition": { data: defn }, "meta/workspace": { data: { name: "W" } } } });
  window.history.replaceState(null, "", "#/settings/modules");
  render(<App store={store} config={{ store: "static" }} />);
  var core = await screen.findByRole("list", { name: "Core pages" });
  var rows = within(core).getAllByRole("listitem");
  expect(rows.map((r) => r.textContent)).toEqual(["TodayCore", "ApprovalsCore", "RunsCore", "HistoryCore", "SettingsCore"]);
  var board = (await screen.findByLabelText(/Board/)).closest("div");
  expect(within(board.parentElement).queryByText("Core")).toBeNull();
});

test("checkSetting: a list with a format refuses what the format does not allow, and accepts what it does", () => {
  var urls = { name: "pages", type: "list", format: "https_url" };
  expect(checkSetting(urls, ["https://example.org/a?x=1"])).toBe("");
  ["https://a.example/$(id)", "https://a.example/a b", "http://a.example", 'https://a.example/"; id; "', "https://a.example/\nx", ""].forEach((bad) => {
    expect(checkSetting(urls, ["https://example.org", bad]), JSON.stringify(bad)).not.toBe("");
  });
  expect(checkSetting(urls, "https://example.org")).toBe("A list setting takes a list.");
  expect(checkSetting({ name: "g", type: "list", format: "ga_property" }, ["properties/12"])).toBe("");
  expect(checkSetting({ name: "g", type: "list", format: "ga_property" }, ["12"])).not.toBe("");
  expect(checkSetting({ name: "t", type: "list" }, ["any phrase"])).toBe("");
  expect(checkSetting({ name: "t", type: "list" }, ["x".repeat(301)])).not.toBe("");
  expect(checkSetting({ name: "t", type: "list", format: "unknown_name" }, ["x"])).not.toBe("");
});

test("checkSetting: a list entry starting with @ is refused, with or without a format", () => {
  expect(checkSetting({ name: "t", type: "list" }, ["@secret.txt"])).toMatch(/@/);
  expect(checkSetting({ name: "u", type: "list", format: "https_url" }, ["@secret.txt"])).toMatch(/@/);
  expect(checkSetting({ name: "t", type: "list" }, ["a at b"])).toBe("");
});

test("revert refuses a stored value the setting no longer allows and writes nothing", async () => {
  var defn = { types: DEFINITION.types, producers: [{ id: "scout", label: "Scout", types: ["roles"], schedule: "0 6 * * *",
    settings: [{ name: "pages", label: "Pages", type: "list", format: "https_url", default: [] }] }] };
  var history = { "settingsHistory/scout--1": { data: { producer: "scout", at: "2026-11-01T00:00:00Z", by: "u1",
    before: { pages: ["https://a.example/$(id)"] }, after: { pages: [] } } } };
  var store = writable(createStore("static", { docs: Object.assign({ "meta/definition": { data: defn }, "meta/workspace": { data: { name: "W" } } }, OWNER, history) }));
  await mount("#/settings/routine", store);
  fireEvent.click(await screen.findByRole("button", { name: "Revert" }));
  expect(await screen.findByText(/Not reverted\./)).toBeTruthy();
  expect(store.set).not.toHaveBeenCalled();
});
