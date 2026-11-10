import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { notifications } from "@mantine/notifications";
import App from "../app/App.jsx";
import { RECORD_RAIL_KEY, recordMarkdown } from "../core/record.js";
import { isSafeImageSrc, noteKind } from "../core/shared.js";
import { ReadOnlyError, createStore } from "../core/store.js";

var DEFINITION = {
  types: {
    roles: {
      label: "Role",
      plural: "Roles",
      order: ["title", "url", "level"],
      fields: {
        title: { label: "Title", type: "text", summary: true },
        url: { label: "Link", type: "url" },
        level: { label: "Level", type: "choice", choices: ["junior", "senior"] },
      },
    },
  },
  producers: [{ id: "scout", label: "Scout", types: ["roles"] }],
};

var RECORD = { type: "roles", key: "a", status: "active", lastSeen: "2026-11-03T00:00:00Z", firstSeen: "2026-11-01T00:00:00Z",
  sources: ["scout"], display: { title: "Data Analyst", url: "https://jobs.example/a", level: "senior" },
  sightings: [{ at: "2026-11-01T00:00:00Z", producer: "scout", values: { level: "junior" } },
    { at: "2026-11-03T00:00:00Z", producer: "scout", values: { level: "senior" } }] };

function docs(extra) {
  return Object.assign({
    "meta/definition": { data: DEFINITION },
    "meta/workspace": { data: { name: "Test workspace" } },
    "entities/roles--a": { data: RECORD },
  }, extra || {});
}

function staticStore(extra) {
  return createStore("static", { docs: docs(extra) });
}

function writable(store, viewer) {
  store.readOnly = false;
  store.viewer = () => Promise.resolve(viewer || "u1");
  return store;
}

async function mount(hash, store) {
  window.history.replaceState(null, "", hash);
  render(<App store={store || staticStore()} config={{ store: "static", workspace: "Test workspace" }} />);
  return screen.findByRole("heading", { level: 1, name: "Data Analyst" });
}

async function menuItem(name) {
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  return screen.findByRole("menuitem", { name: name });
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

test("the record page titles itself with the record and shows its activity", async () => {
  var h1 = await mount("#/entity/roles/a");
  expect(h1.id).toBe("page-title");
  expect(await screen.findByText(/Level: junior to senior/)).toBeTruthy();
});

test("Export record as Markdown saves <slug>.md through store.saveFile", async () => {
  var store = staticStore();
  store.canDownload = () => Promise.resolve(true);
  store.saveFile = vi.fn(() => Promise.resolve());
  await mount("#/entity/roles/a", store);
  fireEvent.click(await menuItem("Export record as Markdown"));
  await waitFor(() => expect(store.saveFile).toHaveBeenCalledTimes(1));
  expect(store.saveFile.mock.calls[0][0]).toBe("data-analyst.md");
  expect(store.saveFile.mock.calls[0][1]).toBe(recordMarkdown(RECORD, DEFINITION));
});

test("a refused save shows why and copies nothing", async () => {
  var store = staticStore();
  store.canDownload = () => Promise.resolve(true);
  store.saveFile = vi.fn(() => Promise.reject(Object.assign(new Error("no"), { code: "declined" })));
  await mount("#/entity/roles/a", store);
  fireEvent.click(await menuItem("Export record as Markdown"));
  expect(await screen.findByText("Not saved.")).toBeTruthy();
  expect(clip).not.toHaveBeenCalled();
});

test("Export record as Markdown is not offered when this view cannot save", async () => {
  await mount("#/entity/roles/a");
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  await screen.findByRole("menuitem", { name: "Copy link" });
  expect(screen.queryByRole("menuitem", { name: "Export record as Markdown" })).toBeNull();
});

test("a decision write that throws ReadOnlyError rolls the control back and says why", async () => {
  var store = writable(staticStore());
  store.set = vi.fn(() => Promise.reject(new ReadOnlyError()));
  await mount("#/entity/roles/a", store);
  var pending = await screen.findByRole("radio", { name: "Pending" });
  expect(pending.checked).toBe(true);
  fireEvent.click(screen.getByRole("radio", { name: "Keep" }));
  await waitFor(() => expect(store.set).toHaveBeenCalledWith("decisions/roles--a", expect.objectContaining({ decision: "keep", by: "u1" })));
  expect(await screen.findByText("Demo data, read only")).toBeTruthy();
  await waitFor(() => expect(screen.getByRole("radio", { name: "Pending" }).checked).toBe(true));
  expect(screen.getByRole("radio", { name: "Keep" }).checked).toBe(false);
});

test("Drop asks for a reason and writes nothing until one is given", async () => {
  var store = writable(staticStore());
  store.set = vi.fn(() => Promise.resolve());
  await mount("#/entity/roles/a", store);
  fireEvent.click(await screen.findByRole("radio", { name: "Drop" }));
  var reason = await screen.findByRole("textbox", { name: "Reason for the drop" });
  expect(store.set).not.toHaveBeenCalled();
  fireEvent.change(reason, { target: { value: "too junior" } });
  fireEvent.click(screen.getByRole("button", { name: "Drop" }));
  await waitFor(() => expect(store.set).toHaveBeenCalledWith("decisions/roles--a", expect.objectContaining({ decision: "drop", reason: "too junior" })));
});

test("a read-only visit sees no decision control and no comment box", async () => {
  await mount("#/entity/roles/a");
  await screen.findByText(/Level: junior to senior/);
  expect(screen.queryByRole("radio", { name: "Keep" })).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Comment" })).toBeNull();
});

test("a joined member who is not the owner sees no decision control", async () => {
  var store = writable(staticStore({ "meta/join": { data: { open: true } }, "meta/owner": { data: { by: "u1", at: "2026-11-01T00:00:00Z" } } }), "u2");
  await mount("#/entity/roles/a", store);
  await screen.findByText(/Level: junior to senior/);
  expect(screen.queryByRole("radio", { name: "Keep" })).toBeNull();
});

test("a comment is written under people/<viewer>/comments/<entity>--<ts36>", async () => {
  var store = writable(staticStore());
  store.set = vi.fn(() => Promise.resolve());
  await mount("#/entity/roles/a", store);
  fireEvent.change(await screen.findByRole("textbox", { name: "Comment" }), { target: { value: "Looks good" } });
  fireEvent.click(screen.getByRole("button", { name: "Post comment" }));
  await waitFor(() => expect(store.set).toHaveBeenCalledTimes(2));
  expect(store.set.mock.calls[0][0]).toBe("people/u1");
  expect(store.set.mock.calls[1][0]).toMatch(/^people\/u1\/comments\/roles--a--[0-9a-z]+$/);
  expect(store.set.mock.calls[1][1]).toMatchObject({ text: "Looks good" });
});

test("the Details rail open state persists under the base rail key", async () => {
  await mount("#/entity/roles/a");
  expect(await screen.findByRole("complementary", { name: "Details" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Details" }));
  await waitFor(() => expect(screen.queryByRole("complementary", { name: "Details" })).toBeNull());
  expect(localStorage.getItem(RECORD_RAIL_KEY)).toBe("0");
  cleanup();
  await mount("#/entity/roles/a");
  await screen.findByText(/Level: junior to senior/);
  expect(screen.queryByRole("complementary", { name: "Details" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Details" }));
  expect(await screen.findByRole("complementary", { name: "Details" })).toBeTruthy();
  expect(localStorage.getItem(RECORD_RAIL_KEY)).toBe("1");
});

test("a missing record says Not found", async () => {
  window.history.replaceState(null, "", "#/entity/roles/zzz");
  render(<App store={staticStore()} config={{ store: "static", workspace: "Test workspace" }} />);
  expect(await screen.findByRole("heading", { level: 1, name: "Not found" })).toBeTruthy();
});

function withDefinition(defn, extra) {
  return staticStore(Object.assign({ "meta/definition": { data: defn } }, extra || {}));
}

test("Merge: pick a record, choose fields, and Confirm merge saves merges/<id>", async () => {
  var other = { type: "roles", key: "b", status: "active", sources: ["scout"], display: { title: "Data Engineer", level: "junior" } };
  var store = writable(staticStore({ "entities/roles--b": { data: other } }));
  store.set = vi.fn(() => Promise.resolve());
  await mount("#/entity/roles/a", store);
  fireEvent.click(await menuItem("Merge with another record"));
  var find = await screen.findByRole("searchbox", { name: "Find a Role to merge into" });
  fireEvent.focus(find);
  fireEvent.change(find, { target: { value: "engineer" } });
  fireEvent.click(await screen.findByRole("button", { name: "Merge into this" }));
  fireEvent.click(await screen.findByRole("radio", { name: "Use this record's: senior" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm merge" }));
  await waitFor(() => expect(store.set).toHaveBeenCalledTimes(1));
  expect(store.set.mock.calls[0][0]).toBe("merges/roles--a");
  expect(store.set.mock.calls[0][1]).toMatchObject({ into: "roles--b", by: "u1", fields: { level: "senior" } });
});

test("a merged record links its target, and Unmerge removes merges/<id>", async () => {
  var store = writable(staticStore({ "merges/roles--a": { data: { into: "roles--b", at: "2026-11-02T00:00:00Z", by: "u1" } } }));
  store.del = vi.fn(() => Promise.resolve());
  await mount("#/entity/roles/a", store);
  expect(await screen.findByText(/Merged by hand into/)).toBeTruthy();
  var sec = screen.getByRole("region", { name: "Merge" });
  expect(within(sec).getByRole("link", { name: "roles--b" }).getAttribute("href")).toBe("#/entity/roles/b");
  fireEvent.click(screen.getByRole("button", { name: "Unmerge" }));
  await waitFor(() => expect(store.del).toHaveBeenCalledWith("merges/roles--a"));
});

test("a read-only visit sees the merge but no Unmerge and no merge menu item", async () => {
  await mount("#/entity/roles/a", staticStore({ "merges/roles--a": { data: { into: "roles--b" } } }));
  expect(await screen.findByText(/Merged by hand into/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Unmerge" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  await screen.findByRole("menuitem", { name: "Copy link" });
  expect(screen.queryByRole("menuitem", { name: "Merge with another record" })).toBeNull();
});

test("record fields with a module component draw through it with {value, record, field}", async () => {
  var defn = Object.assign({}, DEFINITION, { desk: { modules: [{ id: "lv", kind: "view", label: "Levels",
    view: { type: "roles" }, fields: { level: "level-chip" } }] } });
  window.DESK_COMPONENTS = Object.create(null);
  window.DESK_COMPONENTS["level-chip"] = function (ctx, props, ui) {
    return ui.el("span", null, "chip " + props.value + " of " + (props.record && props.record.key) + " in " + props.field);
  };
  await mount("#/entity/roles/a", withDefinition(defn));
  expect(await screen.findByText("chip senior of a in level")).toBeTruthy();
  delete window.DESK_COMPONENTS;
});

test("a number field with more than one sighting draws a sparkline with first and last values", async () => {
  var defn = JSON.parse(JSON.stringify(DEFINITION));
  defn.types.roles.order.push("salary");
  defn.types.roles.fields.salary = { label: "Salary", type: "number" };
  var rec = Object.assign({}, RECORD, { display: Object.assign({}, RECORD.display, { salary: 200 }),
    sightings: [{ at: "2026-11-01T00:00:00Z", producer: "scout", values: { salary: 100 } },
      { at: "2026-11-03T00:00:00Z", producer: "scout", values: { salary: 200 } }] });
  await mount("#/entity/roles/a", withDefinition(defn, { "entities/roles--a": { data: rec } }));
  var img = await screen.findByRole("img", { name: "Salary" });
  expect(img.querySelector("polyline").getAttribute("points").split(" ").length).toBe(2);
  expect(screen.getByText(/^Salary: 100 \(.+\), 200 \(.+\)$/)).toBeTruthy();
});

test("the author can edit a comment within 15 minutes; the edit names the original", async () => {
  var ts = (Date.now() - 60000).toString(36), old = (Date.now() - 2 * 9e5).toString(36);
  var store = writable(staticStore({
    ["people/u1/comments/roles--a--" + ts]: { data: { at: new Date(Date.now() - 60000).toISOString(), text: "First" } },
    ["people/u1/comments/roles--a--" + old]: { data: { at: new Date(Date.now() - 2 * 9e5).toISOString(), text: "Older" } },
  }));
  store.set = vi.fn(() => Promise.resolve());
  await mount("#/entity/roles/a", store);
  await screen.findByText("Older");
  var edits = screen.getAllByRole("button", { name: "Edit comment" });
  expect(edits.length).toBe(1);
  fireEvent.click(edits[0]);
  var box = screen.getByRole("textbox", { name: "Comment" });
  expect(box.value).toBe("First");
  fireEvent.change(box, { target: { value: "First, fixed" } });
  fireEvent.click(screen.getByRole("button", { name: "Save edit" }));
  await waitFor(() => expect(store.set).toHaveBeenCalledTimes(2));
  expect(store.set.mock.calls[1][1]).toMatchObject({ text: "First, fixed", edits: expect.stringContaining("roles--a--u1--" + ts) });
});

var CAP = { image: "data:image/png;base64,iVBORw0KGgo=", notes: [
  { title: "Header", text: "Too tall", kind: "info", box: [0.1, 0.1, 0.2, 0.1] },
  { title: "Footer", text: "Cramped links", kind: "red", box: [0.5, 0.8, 0.3, 0.1] }] };

async function mountCapture() {
  await mount("#/entity/roles/a", staticStore({ "entities/roles--a": { data: Object.assign({}, RECORD, { capture: CAP }) } }));
  return screen.findByRole("region", { name: "Captured page" });
}

test("Show full page opens the captured page with its marks in a modal and closes again", async () => {
  var region = await mountCapture();
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(within(region).getByRole("button", { name: "Show full page" }));
  var dlg = await screen.findByRole("dialog");
  expect(within(dlg).getByRole("button", { name: "Mark 1: Header" })).toBeTruthy();
  expect(within(dlg).getByRole("button", { name: "Mark 2: Footer" })).toBeTruthy();
  fireEvent.keyDown(dlg, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

test("captured page notes: outlined marks over the image, a Show notes switch that persists", async () => {
  var region = await mountCapture();
  expect(screen.getByText("Too tall")).toBeTruthy();
  var sw = screen.getByRole("switch", { name: "Show notes" });
  expect(sw.checked).toBe(true);
  var mark = within(region).getByRole("button", { name: "Mark 1: Header" });
  // The outline draws the whole box: a 2px border and the box's own percent width and height.
  expect(mark.style.border).toContain("0.125rem"); // 2px, scaled
  expect(mark.style.width).toBe("20%");
  expect(mark.style.height).toBe("10%");
  expect(mark.style.left).toBe("10%");
  fireEvent.click(sw);
  await waitFor(() => expect(screen.queryByText("Too tall")).toBeNull());
  // Off keeps every mark, drops the note text and cards.
  expect(within(region).getByRole("button", { name: "Mark 1: Header" })).toBeTruthy();
  expect(within(region).getByRole("button", { name: "Mark 2: Footer" })).toBeTruthy();
  expect(screen.queryByText("Cramped links")).toBeNull();
  expect(localStorage.getItem("routineos-desk-show-notes")).toBe("0");
  cleanup();
  await mountCapture();
  expect((await screen.findByRole("switch", { name: "Show notes" })).checked).toBe(false);
  expect(screen.getByRole("button", { name: "Mark 1: Header" })).toBeTruthy();
});

test("a wide pane lists the cards in a gutter in box order with a leader per placed note, and a narrow one has no leaders", async () => {
  var caps = { image: "data:image/png;base64,iVBORw0KGgo=", notes: [
    { title: "Low", text: "Low note", kind: "red", box: [0.1, 0.8, 0.2, 0.05] },
    { title: "High", text: "High note", kind: "info", box: [0.1, 0.1, 0.2, 0.05] },
    { title: "Nowhere", text: "No box note" }] };
  var rect = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => ({ width: 1000, height: 600, left: 0, top: 0, right: 1000, bottom: 600, x: 0, y: 0 }));
  try {
    await mount("#/entity/roles/a", staticStore({ "entities/roles--a": { data: Object.assign({}, RECORD, { capture: caps }) } }));
    var region = await screen.findByRole("region", { name: "Captured page" });
    var cards = await within(region).findAllByRole("listitem");
    expect(cards.map((c) => c.getAttribute("aria-label")).filter(Boolean)).toEqual(["Note 2: High", "Note 1: Low"]);
    await waitFor(() => expect(region.querySelectorAll("svg[pointer-events] path").length).toBe(2));
    expect(within(region).getByText("Not placed on the image").parentElement.textContent).toContain("No box note");
  } finally { rect.mockRestore(); }
  cleanup();
  await mountCapture();
  expect(document.querySelectorAll("svg[pointer-events] path").length).toBe(0);
});

test("note text shows on hover, on focus and on tap of a mark, and not before", async () => {
  var region = await mountCapture();
  fireEvent.click(screen.getByRole("switch", { name: "Show notes" }));
  await waitFor(() => expect(screen.queryByText("Too tall")).toBeNull());
  var mark = within(region).getByRole("button", { name: "Mark 1: Header" });
  fireEvent.mouseEnter(mark);
  expect(await screen.findByText("Header: Too tall")).toBeTruthy();
  fireEvent.mouseLeave(mark);
  await waitFor(() => expect(screen.queryByText("Header: Too tall")).toBeNull());
  fireEvent.focus(mark);
  expect(await screen.findByText("Header: Too tall")).toBeTruthy();
  fireEvent.blur(mark);
  await waitFor(() => expect(screen.queryByText("Header: Too tall")).toBeNull());
  fireEvent.click(mark);
  expect(await screen.findByText("Header: Too tall")).toBeTruthy();
  expect(mark.getAttribute("aria-pressed")).toBe("true");
});

test("a second click on the selected mark releases it, and so does Esc", async () => {
  var region = await mountCapture();
  var mark = within(region).getByRole("button", { name: "Mark 1: Header" });
  fireEvent.click(mark);
  expect(mark.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(mark);
  expect(mark.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(mark);
  fireEvent.click(within(region).getByRole("button", { name: "Mark 2: Footer" }));
  expect(mark.getAttribute("aria-pressed")).toBe("false");
  expect(within(region).getByRole("button", { name: "Mark 2: Footer" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(within(region).getByRole("button", { name: "Mark 2: Footer" }).getAttribute("aria-pressed")).toBe("false");
});

function offScreenRects() {
  return vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => ({ width: 100, height: 50, left: 0, top: -900, right: 100, bottom: -850, x: 0, y: -900 }));
}

test("a mark click scrolls its card into view, nearest edge only; a card click scrolls nothing of the page", async () => {
  var scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  var region = await mountCapture();
  fireEvent.click(within(region).getByRole("button", { name: "Mark 1: Header" }));
  await vi.waitFor(() => expect(scroll).toHaveBeenCalledTimes(1)); // after the next frame, once the card has grown
  expect(scroll.mock.contexts[0].id).toBe("image-note-0");
  expect(scroll.mock.calls[0][0]).toMatchObject({ block: "nearest" });
  fireEvent.click(region.querySelector("#image-note-1")); // centring the mark is the zoom window's move, not a page scroll
  expect(scroll).toHaveBeenCalledTimes(1);
  expect(within(region).getByRole("button", { name: "Mark 2: Footer" }).getAttribute("aria-pressed")).toBe("true");
  delete Element.prototype.scrollIntoView;
});

test("a card is selectable from the keyboard with Enter or Space", async () => {
  var region = await mountCapture();
  var card = region.querySelector("#image-note-0");
  fireEvent.keyDown(card, { key: "Enter" });
  expect(within(region).getByRole("button", { name: "Mark 1: Header" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.keyDown(card, { key: " " });
  expect(within(region).getByRole("button", { name: "Mark 1: Header" }).getAttribute("aria-pressed")).toBe("false");
});

test("scrolling glides, and jumps when the viewer asks for reduced motion", async () => {
  var scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  var calm = false;
  window.matchMedia = (q) => ({ matches: calm && q.indexOf("prefers-reduced-motion") !== -1, media: q, addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {} });
  var region = await mountCapture();
  var rect = offScreenRects();
  fireEvent.click(within(region).getByRole("button", { name: "Mark 1: Header" }));
  await vi.waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
  expect(scroll.mock.calls[0][0].behavior).toBe("smooth");
  calm = true;
  fireEvent.click(within(region).getByRole("button", { name: "Mark 2: Footer" }));
  await vi.waitFor(() => expect(scroll).toHaveBeenCalledTimes(2));
  expect(scroll.mock.calls[1][0].behavior).toBe("auto");
  rect.mockRestore();
  delete Element.prototype.scrollIntoView;
});

test("hovering a card opens its mark's note, and focusing it does too", async () => {
  var region = await mountCapture();
  var card = region.querySelector("#image-note-0");
  fireEvent.mouseEnter(card);
  expect(await screen.findByText("Header: Too tall")).toBeTruthy();
  fireEvent.mouseLeave(card);
  await waitFor(() => expect(screen.queryByText("Header: Too tall")).toBeNull());
  fireEvent.focus(card);
  expect(await screen.findByText("Header: Too tall")).toBeTruthy();
});

test("a tall capture whose cards cannot sit beside their marks lists them in a scroll strip, with no leaders", async () => {
  var caps = { image: "data:image/png;base64,iVBORw0KGgo=", notes: [
    { title: "A", text: "First", kind: "red", box: [0.1, 0.1, 0.2, 0.05] },
    { title: "B", text: "Second", kind: "info", box: [0.1, 0.5, 0.2, 0.05] }] };
  var rect = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => ({ width: 1000, height: 600, left: 0, top: 0, right: 1000, bottom: 600, x: 0, y: 0 }));
  var oh = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(400);
  try {
    await mount("#/entity/roles/a", staticStore({ "entities/roles--a": { data: Object.assign({}, RECORD, { capture: caps }) } }));
    var region = await screen.findByRole("region", { name: "Captured page" });
    await within(region).findAllByRole("listitem");
    await waitFor(() => expect(region.querySelectorAll("svg[pointer-events] path").length).toBe(0)); // not aligned: no leaders
    expect(region.querySelector('[class*="ScrollArea"]')).not.toBeNull();
    expect(within(region).getAllByRole("listitem").length).toBe(2);
  } finally { rect.mockRestore(); oh.mockRestore(); }
});

test("note text is rendered as Markdown, not shown raw", async () => {
  var caps = { image: "data:image/png;base64,iVBORw0KGgo=", notes: [
    { title: "T", text: "## Heading\n\nSays **GMP** [site](https://example.com) [x](javascript:alert(1))", kind: "red", box: [0.1, 0.1, 0.2, 0.05] }] };
  await mount("#/entity/roles/a", staticStore({ "entities/roles--a": { data: Object.assign({}, RECORD, { capture: caps }) } }));
  var card = (await screen.findByRole("region", { name: "Captured page" })).querySelector("#image-note-0");
  expect(card.textContent).not.toMatch(/##|\*\*/);
  expect(Array.from(card.querySelectorAll("strong")).map((x) => x.textContent)).toEqual(["GMP"]);
  expect(Array.from(card.querySelectorAll("a")).map((a) => a.getAttribute("href"))).toEqual(["https://example.com/"]);
});

test("the record sidebar sits on the right of the main column, and the captured page is the first section", async () => {
  await mountCapture();
  var cap = screen.getByRole("region", { name: "Captured page" });
  var rail = screen.getByRole("complementary", { name: "Details" });
  expect(cap.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("the Captured page section sits above Summary", async () => {
  var rec = Object.assign({}, RECORD, { capture: CAP, display: Object.assign({}, RECORD.display, { summary: "A short summary." }) });
  var def = JSON.parse(JSON.stringify(DEFINITION));
  def.types.roles.fields.summary = { label: "Summary", type: "text" };
  await mount("#/entity/roles/a", staticStore({ "entities/roles--a": { data: rec }, "meta/definition": { data: def } }));
  var cap = await screen.findByRole("region", { name: "Captured page" });
  var sum = screen.getByRole("region", { name: "Summary" });
  expect(cap.compareDocumentPosition(sum) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("a note whose box cannot be placed stays in the list under Not placed on the image and has no mark", async () => {
  var rec = Object.assign({}, RECORD, { capture: { image: "data:image/png;base64,iVBORw0KGgo=", notes: [
    { title: "Ok", text: "Placed note", kind: "info", box: [0.1, 0.1, 0.2, 0.1] },
    { title: "Out", text: "Outside note", kind: "info", box: [2, 0, 1, 1] },
    { title: "Flat", text: "Zero width note", kind: "info", box: [0.1, 0.1, 0, 0.1] },
    { title: "Nan", text: "Not a number note", kind: "info", box: [null, 0, 0.1, 0.1] }] } });
  await mount("#/entity/roles/a", staticStore({ "entities/roles--a": { data: rec } }));
  var region = await screen.findByRole("region", { name: "Captured page" });
  expect(within(region).getAllByRole("button", { name: /^Mark \d/ }).length).toBe(1);
  var heading = within(region).getByText("Not placed on the image");
  var unplaced = heading.parentElement;
  ["Outside note", "Zero width note", "Not a number note"].forEach((t) => expect(within(unplaced).getByText(t)).toBeTruthy());
  expect(within(unplaced).queryByText("Placed note")).toBeNull();
  expect(within(region).getByText("Placed note")).toBeTruthy();
});

test("a folded section stays folded for this viewer at routineos-desk-section:<page>:<section>", async () => {
  await mount("#/entity/roles/a");
  var details = screen.getByRole("region", { name: "Details" });
  var fold = within(details).getByRole("button", { name: "Collapse Details" });
  expect(fold.getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(fold);
  expect(localStorage.getItem("routineos-desk-section:record:details")).toBe("0");
  expect(within(details).getByRole("button", { name: "Expand Details" }).getAttribute("aria-expanded")).toBe("false");
  cleanup();
  await mount("#/entity/roles/a");
  var again = within(screen.getByRole("region", { name: "Details" })).getByRole("button", { name: "Expand Details" });
  expect(again.getAttribute("aria-expanded")).toBe("false");
  // Other sections keep their own state: Activity is still open.
  expect(within(screen.getByRole("region", { name: "Activity" })).getByRole("button", { name: "Collapse Activity" })).toBeTruthy();
  fireEvent.click(again);
  expect(localStorage.getItem("routineos-desk-section:record:details")).toBe("1");
});

test("noteKind maps yellow to warn and unknown to info", () => {
  expect(["info", "red", "warn", "ok", "yellow", "bogus", undefined].map(noteKind)).toEqual(["info", "red", "warn", "ok", "warn", "info", "info"]);
});

test("a stored yellow note shows as warn", async () => {
  var mk = (kind) => Object.assign({}, RECORD, { capture: { image: "data:image/png;base64,iVBORw0KGgo=",
    notes: [{ title: "H", text: "t", kind: kind, box: [0.1, 0.1, 0.2, 0.1] }] } });
  await mount("#/entity/roles/a", staticStore({ "entities/roles--a": { data: mk("yellow") } }));
  var yellow = (await screen.findByLabelText("Mark 1: H")).outerHTML;
  cleanup();
  await mount("#/entity/roles/a", staticStore({ "entities/roles--a": { data: mk("warn") } }));
  expect((await screen.findByLabelText("Mark 1: H")).outerHTML).toBe(yellow);
  expect(yellow).toContain("yellow");
});

test("a captured image draws only from https, data:image and blob: sources", () => {
  for (var ok of ["https://img.example/a.png", "data:image/png;base64,iVBORw0KGgo=", "blob:https://desk.example/1f2e"]) {
    expect(isSafeImageSrc(ok)).toBe(true);
  }
  for (var bad of ["http://img.example/a.png", "javascript:alert(1)", " javascript:alert(1)", "data:text/html,<b>x</b>", "file:///etc/hosts", "ftp://img.example/a.png",
    "vbscript:x", "/relative.png", "", null, undefined, 42, {}]) {
    expect(isSafeImageSrc(bad)).toBe(false);
  }
});

test("an uploaded asset's served path /_blob/<id> draws; look-alikes do not", () => {
  expect(isSafeImageSrc("/_blob/6236a8aa913452581292d46fd9e1ff93")).toBe(true);
  for (var bad of ["/_blob/short", "/_blob/6236A8AA913452581292D46FD9E1FF93", "/_blob/6236a8aa913452581292d46fd9e1ff93/x", "//evil.example/_blob/6236a8aa913452581292d46fd9e1ff93"]) {
    expect(isSafeImageSrc(bad)).toBe(false);
  }
});

test("the contract's own image form, an artifact asset path, draws; look-alikes do not", () => {
  for (var ok of ["/assets/0123456789abcdef0123456789abcdef", "/assets/0123456789abcdef0123456789abcdef.png"]) expect(isSafeImageSrc(ok)).toBe(true);
  for (var bad of ["/assets/0123456789ABCDEF0123456789abcdef", "/assets/short.png", "/assets/0123456789abcdef0123456789abcdef/x.png",
    "//evil.example/assets/0123456789abcdef0123456789abcdef.png", "/assets/0123456789abcdef0123456789abcdef.png?x=1"]) {
    expect(isSafeImageSrc(bad)).toBe(false);
  }
});

test("a captured page with an unsafe image source keeps its notes and draws no image", async () => {
  var rec = Object.assign({}, RECORD, { capture: { image: "javascript:alert(1)",
    notes: [{ title: "Header", text: "Too tall", kind: "info", box: [0.1, 0.1, 0.2, 0.1] }] } });
  await mount("#/entity/roles/a", staticStore({ "entities/roles--a": { data: rec } }));
  var region = await screen.findByRole("region", { name: "Captured page" });
  expect(within(region).getByText("Too tall")).toBeTruthy();
  expect(within(region).queryByRole("img")).toBeNull();
  expect(region.querySelector("img")).toBeNull();
  expect(within(region).queryByLabelText("Mark 1: Header")).toBeNull();
});

test("the More menu restores a record the routine dropped: Keep overrides the drop", async () => {
  var store = writable(staticStore({ "entities/roles--a": { data: Object.assign({}, RECORD, { status: "dropped", dropReason: "too far" }) } }));
  store.set = vi.fn(() => Promise.resolve());
  await mount("#/entity/roles/a", store);
  fireEvent.click(await menuItem("Restore"));
  await waitFor(() => expect(store.set).toHaveBeenCalledWith("decisions/roles--a", expect.objectContaining({ decision: "keep" })));
  expect(await screen.findByText("Restored Data Analyst. Applies from the next run.")).toBeTruthy();
});

test("the More menu restores a person's own drop by removing it, and offers no Restore on an active record", async () => {
  var store = writable(staticStore({ "decisions/roles--a": { data: { decision: "drop", reason: "not now", by: "u1", at: "2026-11-04T00:00:00Z" } } }));
  store.del = vi.fn(() => Promise.resolve());
  await mount("#/entity/roles/a", store);
  fireEvent.click(await menuItem("Restore"));
  await waitFor(() => expect(store.del).toHaveBeenCalledWith("decisions/roles--a"));
  cleanup();
  await mount("#/entity/roles/a", writable(staticStore()));
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  await screen.findByRole("menuitem", { name: "Copy link" });
  expect(screen.queryByRole("menuitem", { name: "Restore" })).toBeNull();
});

test("Copy link says Copied only after the clipboard write goes through", async () => {
  await mount("#/entity/roles/a");
  fireEvent.click(await menuItem("Copy link"));
  await waitFor(() => expect(clip).toHaveBeenCalledTimes(1));
  expect(clip.mock.calls[0][0]).toMatch(/#\/entity\/roles\/a$/);
  expect(await screen.findByText("Copied.")).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: "Text to copy" })).toBeNull();
});

function inFrameTop(on) {
  var real = Object.getOwnPropertyDescriptor(window, "top");
  Object.defineProperty(window, "top", { configurable: true, value: on ? {} : window });
  return () => { if (real) Object.defineProperty(window, "top", real); else delete window.top; };
}

test("Copy link in a frame copies the slash-free address and says to put it after the page address", async () => {
  var restore = inFrameTop(true);
  try {
    await mount("#/entity/roles/a");
    fireEvent.click(await menuItem("Copy link"));
    await waitFor(() => expect(clip).toHaveBeenCalledTimes(1));
    expect(clip.mock.calls[0][0]).toBe("#d--entity--roles--a");
    expect(await screen.findByText(/Copied the end of the address.*after the web address of this page/)).toBeTruthy();
  } finally { restore(); }
});

test("Copy link at the top level copies the full address", async () => {
  var restore = inFrameTop(false);
  try {
    await mount("#/entity/roles/a");
    fireEvent.click(await menuItem("Copy link"));
    await waitFor(() => expect(clip).toHaveBeenCalledTimes(1));
    expect(clip.mock.calls[0][0]).toMatch(/^https?:\/\/.+#\/entity\/roles\/a$/);
    expect(await screen.findByText("Copied.")).toBeTruthy();
  } finally { restore(); }
});

test("Copy link with a refused clipboard write opens the text to copy by hand and never says Copied", async () => {
  clip.mockImplementation(() => Promise.reject(new Error("blocked")));
  await mount("#/entity/roles/a");
  fireEvent.click(await menuItem("Copy link"));
  var box = await screen.findByRole("textbox", { name: "Text to copy" });
  expect(box.value).toMatch(/#\/entity\/roles\/a$/);
  expect(screen.queryByText("Copied.")).toBeNull();
});

test("Copy link with no clipboard opens the text to copy by hand", async () => {
  Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: undefined });
  await mount("#/entity/roles/a");
  fireEvent.click(await menuItem("Copy link"));
  expect((await screen.findByRole("textbox", { name: "Text to copy" })).value).toMatch(/#\/entity\/roles\/a$/);
  expect(screen.queryByText("Copied.")).toBeNull();
});

// The record head strip as in base 1084680 (src/record.js statusStrip): the health chip, the keep badge, the type
// and Last seen. The text goldens (tests/visual/golden/pages-v2.json) are not compared by the Mantine specs, so this
// holds the strip instead.
test("the record head shows the health chip, state, type and Last seen", async () => {
  var def = JSON.parse(JSON.stringify(DEFINITION));
  def.desk = { health: { roles: { field: "level", green: ["senior"] } } };
  await mount("#/entity/roles/a", staticStore({ "meta/definition": { data: def } }));
  var h1 = screen.getByRole("heading", { level: 1, name: "Data Analyst" });
  var head = h1.closest("main");
  expect(within(head).getAllByText("senior").length).toBeGreaterThan(0);
  expect(within(head).getAllByText("Active").length).toBeGreaterThan(0);
  expect(within(head).getByText("Role")).toBeTruthy();
  expect(within(head).getByText(/^Last seen /)).toBeTruthy();
});

var TWO = () => ({
  "entities/roles--b": { data: Object.assign({}, RECORD, { key: "b", display: { title: "Baker", url: "https://jobs.example/b", level: "senior" } }) },
  "entities/roles--c": { data: Object.assign({}, RECORD, { key: "c", display: { title: "Clerk", url: "https://jobs.example/c", level: "junior" } }) },
});

test("the record header shows its place in the list it was opened from, from explicit filter keys", async () => {
  await mount("#/entity/roles/a?f.level=senior", staticStore(TWO()));
  expect(await screen.findByText(/^[12] of 2 in Roles$/)).toBeTruthy();
  var links = ["Previous", "Next"].map((n) => screen.queryByRole("link", { name: new RegExp(n) })).filter(Boolean);
  expect(links.length).toBe(1);
  expect(links[0].getAttribute("href")).toBe("#/entity/roles/b?f.level=senior");
});

test("the breadcrumb back to the list keeps the filters the record was opened with, and is bare without them", async () => {
  await mount("#/entity/roles/a?f.level=senior", staticStore(TWO()));
  await screen.findByText(/^[12] of 2 in Roles$/);
  expect(document.querySelector(".mantine-Breadcrumbs-root a").getAttribute("href")).toBe("#/browse/roles?f.level=senior");
  cleanup();
  await mount("#/entity/roles/a", staticStore(TWO()));
  expect(document.querySelector(".mantine-Breadcrumbs-root a").getAttribute("href")).toBe("#/browse/roles");
});

test("a record opened with no filters shows no position", async () => {
  await mount("#/entity/roles/a", staticStore(TWO()));
  await screen.findByText("Last seen", { exact: false });
  expect(screen.queryByText(/ of \d+ in /)).toBeNull();
  expect(screen.queryByRole("link", { name: /^(Previous|Next)/ })).toBeNull();
});

test("j and k move to the neighbour record in the list, keeping the filters and adding no history entry", async () => {
  await mount("#/entity/roles/a?f.level=senior", staticStore(TWO()));
  var pos = await screen.findByText(/^[12] of 2 in Roles$/);
  var len = window.history.length;
  fireEvent.keyDown(document.body, { key: pos.textContent.startsWith("1") ? "j" : "k" });
  await waitFor(() => expect(window.location.hash).toBe("#/entity/roles/b?f.level=senior"));
  expect(await screen.findByRole("heading", { level: 1, name: "Baker" })).toBeTruthy();
  expect(window.history.length).toBe(len);
});

test("a declared strip draws its chips in order and leaves out the defaults it does not name", async () => {
  var def = JSON.parse(JSON.stringify(DEFINITION));
  def.desk = { record: { strip: { roles: [{ field: "level" }, { chip: "type" }] } } };
  await mount("#/entity/roles/a", staticStore({ "meta/definition": { data: def } }));
  var main = screen.getByRole("heading", { level: 1, name: "Data Analyst" }).closest("main");
  expect(within(main).getAllByText("senior").length).toBeGreaterThan(0);
  expect(within(main).getByText("Role")).toBeTruthy();
  expect(within(main).queryByText(/^Last seen /)).toBeNull();
});

test("image notes: a mark is named with its number and title, and a note without a box has a list entry only", async () => {
  var rec = Object.assign({}, RECORD, { capture: { image: "data:image/png;base64,iVBORw0KGgo=", capturedAt: "2026-11-03T00:00:00Z",
    notes: [{ title: "Header", text: "Too tall", kind: "red", box: [0.1, 0.1, 0.2, 0.1] }, { title: "Footer", text: "Cramped", kind: "ok" }] } });
  await mount("#/entity/roles/a", staticStore({ "entities/roles--a": { data: rec } }));
  var region = await screen.findByRole("region", { name: "Captured page" });
  expect(within(region).getByLabelText("Mark 1: Header")).toBeTruthy();
  expect(within(region).queryByLabelText(/^Mark 2/)).toBeNull();
  expect(within(region).getByText("Cramped")).toBeTruthy();
  // One note is placed on the image, one is not: the strip chip and the pane both say so, and neither folds them into a total.
  expect(screen.getAllByText("1 placed, 1 not placed").length).toBe(2);
  expect(screen.queryByText("2 image notes")).toBeNull();
});

test("a captured page with zero notes shows a green panel and a 0 badge", async () => {
  var rec = Object.assign({}, RECORD, { capture: { image: "data:image/png;base64,iVBORw0KGgo=", notes: [] } });
  await mount("#/entity/roles/a", staticStore({ "entities/roles--a": { data: rec } }));
  var region = await screen.findByRole("region", { name: "Captured page" });
  expect(within(region).getByText("Nothing noted. This item is all good.")).toBeTruthy();
  expect(within(region).getByText("0")).toBeTruthy();
  expect(within(region).queryByRole("switch", { name: "Show notes" })).toBeNull();
});

test("Details shows the status contract line when the routine declares one", async () => {
  var def = JSON.parse(JSON.stringify(DEFINITION));
  def.desk = { health: { roles: { field: "level", red: ["junior"], green: ["senior"] } } };
  await mount("#/entity/roles/a", staticStore({ "meta/definition": { data: def } }));
  var rail = screen.getByRole("complementary", { name: "Details" });
  var row = within(rail).getByRole("rowheader", { name: "Status" }).closest("tr");
  expect(row.textContent).toBe("StatusAll good, from Level");
});

test("Details has no status line when no status field is declared", async () => {
  await mount("#/entity/roles/a");
  var rail = screen.getByRole("complementary", { name: "Details" });
  expect(within(rail).queryByRole("rowheader", { name: "Status" })).toBeNull();
});

test("record Activity groups events by day", async () => {
  await mount("#/entity/roles/a");
  var h = await screen.findByRole("heading", { level: 3, name: "Earlier" });
  expect(h).toBeTruthy();
});

test("cards in a long list are clamped to a few lines, and the selected card shows its full text", async () => {
  var caps = { image: "data:image/png;base64,iVBORw0KGgo=", notes: [
    { title: "A", text: "First note text", kind: "red", box: [0.1, 0.1, 0.2, 0.05] },
    { title: "B", text: "Second note text", kind: "info", box: [0.1, 0.5, 0.2, 0.05] }] };
  await mount("#/entity/roles/a", staticStore({ "entities/roles--a": { data: Object.assign({}, RECORD, { capture: caps }) } }));
  var region = await screen.findByRole("region", { name: "Captured page" });
  var para = () => within(region.querySelector("#image-note-0")).getByText("First note text").closest("p");
  expect(para().getAttribute("data-line-clamp")).toBe("true"); // narrow pane: a list under the image
  fireEvent.click(region.querySelector("#image-note-0"));
  expect(para().getAttribute("data-line-clamp")).toBeNull();
});
