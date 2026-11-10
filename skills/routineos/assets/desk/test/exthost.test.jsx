import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import ExtHost from "../app/ExtHost.jsx";
import App from "../app/App.jsx";
import { ModelProvider, StoreProvider } from "../app/StoreContext.jsx";
import { notifications } from "@mantine/notifications";
import { createStore } from "../core/store.js";
import { snapshotExtensions } from "../core/ext.js";

function fake(over) {
  var subs = [];
  var s = Object.assign({
    readOnly: false,
    set: vi.fn(() => Promise.resolve()),
    del: vi.fn(() => Promise.resolve()),
    get: vi.fn((p) => Promise.resolve(String(p).indexOf("entities/") === 0 ? { exists: true, data: { type: "roles" } } : { exists: false })),
    list: vi.fn(() => Promise.resolve([])),
    subscribe: vi.fn((c, cb) => { var rec = { c: c, off: vi.fn() }; subs.push(rec); return rec.off; }),
  }, over || {});
  s.subs = subs;
  return s;
}

function mount(id, factory, store, props, verbs) {
  window.DESK_EXTENSIONS = { [id]: { slot: "record-section", types: ["roles"], verbs: verbs || ["decide"] } };
  window.DESK_COMPONENTS = Object.create(null);
  window.DESK_COMPONENTS[id] = factory;
  snapshotExtensions(window.DESK_EXTENSIONS);
  return render(
    <StoreProvider store={store}>
        <ModelProvider model={{ viewer: "u1", definition: { types: {}, producers: [{ id: "p1" }] }, join: null, owner: "u1" }}>
          <ExtHost id={id} props={props || { id: "r1" }} fallback="FALLBACK" />
        </ModelProvider>
      </StoreProvider>,
  );
}

afterEach(() => {
  cleanup();
  delete window.DESK_COMPONENTS;
  delete window.DESK_EXTENSIONS;
});

test("an extension is drawn and a click runs a host verb that writes the decision doc", async () => {
  var store = fake();
  mount("box", function (ctx, p, ui) {
    return ui.el("div", {}, ui.button("Approve", function () { return ctx.actions.decide(p.id, "approved", "fine"); }));
  }, store);
  fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  await waitFor(() => expect(store.set).toHaveBeenCalledTimes(1));
  expect(store.set.mock.calls[0][0]).toBe("decisions/r1~x");
  expect(store.set.mock.calls[0][1].decision).toBe("approved");
});

test("a read-only visit draws write buttons disabled; a local button stays live; nothing is written", async () => {
  var store = fake({ readOnly: true });
  var ran = vi.fn();
  mount("box", function (ctx, p, ui) {
    return ui.el("div", {},
      ui.button("Approve", function () { return ctx.actions.decide(p.id, "approved", ""); }),
      ui.button("Toggle", ran, { local: true }));
  }, store);
  var approve = screen.getByRole("button", { name: "Approve" });
  expect(approve.disabled).toBe(true);
  expect(approve.getAttribute("title")).toMatch(/not available/);
  fireEvent.click(approve);
  expect(store.set).not.toHaveBeenCalled();
  var toggle = screen.getByRole("button", { name: "Toggle" });
  expect(toggle.disabled).toBe(false);
  fireEvent.click(toggle);
  await waitFor(() => expect(ran).toHaveBeenCalled());
});

test("a verb called straight on a read-only store still refuses with the Desk wording", async () => {
  var store = fake({ readOnly: true });
  var held;
  mount("box", function (ctx, p, ui) { held = ctx; return ui.el("div", {}, "x"); }, store);
  await expect(held.actions.decide("r1", "approved", "")).rejects.toThrow(/read only/i);
  expect(store.set).not.toHaveBeenCalled();
});

test("a factory that throws, or returns a script, shows the fallback", () => {
  var a = mount("box", function () { throw new Error("boom"); }, fake());
  expect(a.container.textContent).toBe("FALLBACK");
  cleanup();
  var b = mount("box", function () { return document.createElement("script"); }, fake());
  expect(b.container.textContent).toBe("FALLBACK");
  expect(document.querySelectorAll("script").length).toBe(0);
});

test("a tree that turns bad later falls back", async () => {
  var held;
  var r = mount("box", function (ctx, p, ui) { held = ui.el("div", {}, "ok"); return held; }, fake());
  expect(r.container.textContent).toBe("ok");
  held.appendChild(document.createElement("iframe"));
  await waitFor(() => expect(r.container.textContent).toBe("FALLBACK"));
});

test("unmount calls the disposer of every watch", () => {
  var store = fake();
  var r = mount("box", function (ctx, p, ui) {
    ctx.watch("decisions", function () {});
    ctx.watch("comments", function () {});
    return ui.el("p", {}, "x");
  }, store);
  expect(store.subs.length).toBe(2);
  r.unmount();
  expect(store.subs.every((s) => s.off.mock.calls.length === 1)).toBe(true);
});

test("a component cannot write through ctx.store", () => {
  var seen;
  mount("box", function (ctx, p, ui) { seen = ctx.store; return ui.el("p", {}, "x"); }, fake());
  expect(Object.keys(seen).sort()).toEqual(["get", "list"]);
});

test("a record-section registered for the type is drawn on the record page", async () => {
  var DEFINITION = { types: { roles: { label: "Role", plural: "Roles", order: ["title"], fields: { title: { label: "Title", type: "text", summary: true } } } },
    producers: [{ id: "scout", label: "Scout", types: ["roles"] }] };
  var RECORD = { type: "roles", key: "a", status: "active", lastSeen: "2026-11-03T00:00:00Z", firstSeen: "2026-11-01T00:00:00Z",
    sources: ["scout"], display: { title: "Data Analyst" }, sightings: [{ at: "2026-11-01T00:00:00Z", producer: "scout", values: {} }] };
  var store = createStore("static", { docs: { "meta/definition": { data: DEFINITION }, "meta/workspace": { data: { name: "W" } }, "entities/roles--a": { data: RECORD } } });
  window.DESK_COMPONENTS = Object.create(null);
  window.DESK_COMPONENTS.sec = function (ctx, p, ui) { return ui.el("p", {}, "section for " + p.id); };
  window.DESK_EXTENSIONS = { sec: { slot: "record-section", types: ["roles"], title: "Extra" } };
  window.history.replaceState(null, "", "#/entity/roles/a");
  try {
    render(<App store={store} config={{ store: "static", workspace: "W" }} />);
    expect(await screen.findByText("section for roles--a")).toBeTruthy();
  } finally {
    delete window.DESK_EXTENSIONS;
    window.history.replaceState(null, "", "#/today");
  }
});

test("a verb the manifest did not declare is absent at runtime, even if the code reaches for it", () => {
  var seen;
  var store = fake();
  mount("box", function (ctx, p, ui) { seen = Object.keys(ctx.actions); return ui.el("p", {}, "x"); }, store, undefined, ["comment"]);
  expect(seen).toEqual(["comment"]);
  cleanup();
  var threw = false;
  mount("box", function (ctx, p, ui) {
    try { ctx.actions.decide("r1", "ok", ""); } catch (e) { threw = true; }
    return ui.el("p", {}, "x");
  }, store, undefined, ["comment"]);
  expect(threw).toBe(true);
  expect(store.set).not.toHaveBeenCalled();
});

test("pushing a verb into the live registry after load grants nothing", () => {
  var seen;
  window.DESK_EXTENSIONS = { box: { slot: "record-section", types: ["roles"], verbs: [] } };
  snapshotExtensions(window.DESK_EXTENSIONS);
  window.DESK_EXTENSIONS.box.verbs.push("drop", "keep");
  window.DESK_EXTENSIONS.sneak = { slot: "page", verbs: ["drop"] };
  window.DESK_COMPONENTS = Object.create(null);
  window.DESK_COMPONENTS.box = function (ctx, p, ui) { seen = Object.keys(ctx.actions); return ui.el("p", {}, "x"); };
  render(
    <StoreProvider store={fake()}>
      <ModelProvider model={{ viewer: "u1", definition: { types: {} }, join: null, owner: "u1" }}>
        <ExtHost id="box" props={{ id: "r1" }} fallback="FALLBACK" />
      </ModelProvider>
    </StoreProvider>,
  );
  expect(seen).toEqual([]);
});

test("ui.image draws a data image and refuses an https one; a built https img falls back", () => {
  var a = mount("box", function (ctx, p, ui) {
    return ui.el("div", {}, ui.image("data:image/png;base64,AAAA", "ok"), ui.image("https://e.example/?d=1", "beacon"));
  }, fake());
  var imgs = a.container.querySelectorAll("img");
  expect(imgs.length).toBe(1);
  expect(imgs[0].getAttribute("src")).toMatch(/^data:image/);
  cleanup();
  var b = mount("box", function (ctx, p, ui) { return ui.el("div", {}, ui.el("img", { src: "https://e.example/?d=1" })); }, fake());
  expect(b.container.textContent).toBe("FALLBACK");
});

test("a watch started after unmount is disposed at once", async () => {
  var store = fake();
  var late;
  var r = mount("box", function (ctx, p, ui) { late = function () { return ctx.watch("decisions", function () {}); }; return ui.el("p", {}, "x"); }, store);
  r.unmount();
  late();
  expect(store.subs.length).toBe(1);
  expect(store.subs[0].off.mock.calls.length).toBe(1);
});

test("a verb aimed at a record of another type is refused through the host scope", async () => {
  var store = fake({ get: vi.fn(() => Promise.resolve({ exists: true, data: { type: "companies" } })) });
  var show = vi.spyOn(notifications, "show");
  mount("box", function (ctx, p, ui) {
    return ui.el("div", {}, ui.button("Approve", function () { return ctx.actions.decide(p.id, "approved", ""); }));
  }, store);
  fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  await waitFor(() => expect(show).toHaveBeenCalled());
  expect(show.mock.calls.at(-1)[0].message).toMatch(/kind of record/);
  expect(store.set).not.toHaveBeenCalled();
});

test("ext verb request reaches actions.request and writes a pending requests doc", async () => {
  var store = fake();
  var out = {};
  mount("box", function (ctx, p, ui) {
    return ui.el("div", {}, ui.button("Go", function () { return ctx.actions.request("run-now", { routine: "p1" }); }));
  }, store, undefined, ["request"]);
  fireEvent.click(screen.getByRole("button", { name: "Go" }));
  await waitFor(() => expect(store.set).toHaveBeenCalledTimes(1));
  expect(store.set.mock.calls[0][0]).toMatch(/^requests\//);
  expect(store.set.mock.calls[0][1].status).toBe("pending");
  expect(store.set.mock.calls[0][1].kind).toBe("run-now");
});

test("ext verb request for a routine the Desk does not list writes nothing", async () => {
  var store = fake();
  var err = null;
  mount("box", function (ctx, p, ui) {
    return ui.el("div", {}, ui.button("Go", function () { return ctx.actions.request("retry", { routine: "other" }).catch(function (e) { err = e; }); }));
  }, store, undefined, ["request"]);
  fireEvent.click(screen.getByRole("button", { name: "Go" }));
  await waitFor(() => expect(err).not.toBeNull());
  expect(store.set).not.toHaveBeenCalled();
});

// ctx.pref and ctx.setPref (spec: extension host gaps, section 4)
function prefCtx(entry, store, id) {
  var seen = {};
  window.DESK_EXTENSIONS = { [id || "pb"]: Object.assign({ slot: "record-section", types: ["roles"], verbs: [] }, entry) };
  window.DESK_COMPONENTS = Object.create(null);
  window.DESK_COMPONENTS[id || "pb"] = function (ctx, p, ui) { seen.ctx = ctx; return ui.el("p", {}, "x"); };
  snapshotExtensions(window.DESK_EXTENSIONS);
  render(
    <StoreProvider store={store || fake()}>
      <ModelProvider model={{ viewer: "u1", definition: { types: {}, producers: [] }, join: null, owner: "u1" }}>
        <ExtHost id={id || "pb"} props={{ id: "r1" }} fallback="FALLBACK" />
      </ModelProvider>
    </StoreProvider>,
  );
  return seen.ctx;
}

function withStorage(impl, fn) {
  var real = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get: impl });
  try { return fn(); } finally {
    if (real) Object.defineProperty(globalThis, "localStorage", real); else delete globalThis.localStorage;
  }
}

test("pref is absent without prefs: true", () => {
  var ctx = prefCtx({});
  expect(ctx.pref).toBeUndefined();
  expect(ctx.setPref).toBeUndefined();
});

test("setPref then pref round-trips under the namespaced key", () => {
  var ctx = prefCtx({ prefs: true });
  ctx.setPref("tab", "b");
  expect(ctx.pref("tab", "a")).toBe("b");
  expect(globalThis.localStorage.getItem("routineos-ext:pb:tab")).toBe("b");
  expect(ctx.pref("other", "dflt")).toBe("dflt");
  globalThis.localStorage.removeItem("routineos-ext:pb:tab");
});

test("pref returns the fallback when storage throws, and setPref does not", () => {
  var ctx = prefCtx({ prefs: true });
  withStorage(() => { throw new Error("blocked"); }, () => {
    expect(ctx.pref("tab", "a")).toBe("a");
    expect(() => ctx.setPref("tab", "b")).not.toThrow();
  });
});

test("setPref rejects a 201 character value and accepts 200", () => {
  var ctx = prefCtx({ prefs: true });
  expect(() => ctx.setPref("big", "x".repeat(201))).toThrow(/200/);
  expect(globalThis.localStorage.getItem("routineos-ext:pb:big")).toBeNull();
  ctx.setPref("big", "x".repeat(200));
  expect(ctx.pref("big", "")).toHaveLength(200);
  globalThis.localStorage.removeItem("routineos-ext:pb:big");
});

test("a bad key is refused on read and write", () => {
  var ctx = prefCtx({ prefs: true });
  expect(() => ctx.setPref("Bad Key", "v")).toThrow(/key/);
  expect(() => ctx.setPref("a".repeat(41), "v")).toThrow(/key/);
  expect(ctx.pref("Bad Key", "fb")).toBe("fb");
  expect(() => ctx.setPref("tab", 5)).toThrow(/text/);
});

test("one component cannot read another component's pref", () => {
  globalThis.localStorage.setItem("routineos-ext:other:tab", "secret");
  var ctx = prefCtx({ prefs: true });
  expect(ctx.pref("tab", "fb")).toBe("fb");
  expect(ctx.pref("other:tab", "fb")).toBe("fb");
  globalThis.localStorage.removeItem("routineos-ext:other:tab");
});

test("the read-only demo returns the fallback and stores nothing", () => {
  var ctx = prefCtx({ prefs: true }, fake({ readOnly: true }));
  ctx.setPref("tab", "b");
  expect(ctx.pref("tab", "a")).toBe("a");
  expect(globalThis.localStorage.getItem("routineos-ext:pb:tab")).toBeNull();
});

// placement on the record page
function recordWith(exts) {
  var DEFINITION = { types: { roles: { label: "Role", plural: "Roles", order: ["title", "summary"], fields: { title: { label: "Title", type: "text", summary: true }, summary: { label: "Summary", type: "text" } } } },
    producers: [{ id: "scout", label: "Scout", types: ["roles"] }] };
  var RECORD = { type: "roles", key: "a", status: "active", lastSeen: "2026-11-03T00:00:00Z", firstSeen: "2026-11-01T00:00:00Z",
    sources: ["scout"], display: { title: "Data Analyst", summary: "A short summary line" }, sightings: [{ at: "2026-11-01T00:00:00Z", producer: "scout", values: {} }] };
  var store = createStore("static", { docs: { "meta/definition": { data: DEFINITION }, "meta/workspace": { data: { name: "W" } }, "entities/roles--a": { data: RECORD } } });
  window.DESK_COMPONENTS = Object.create(null);
  Object.keys(exts).forEach((id) => { window.DESK_COMPONENTS[id] = function (c, p, ui) { return ui.el("p", {}, "body " + id); }; });
  window.DESK_EXTENSIONS = {};
  Object.keys(exts).forEach((id) => { window.DESK_EXTENSIONS[id] = Object.assign({ slot: "record-section", types: ["roles"], title: "T " + id }, exts[id]); });
  window.history.replaceState(null, "", "#/entity/roles/a");
  render(<App store={store} config={{ store: "static", workspace: "W" }} />);
}

function before(a, b) {
  return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

test("placement top renders above Summary, the default after it, and after-fields below Decision", async () => {
  try {
    recordWith({ topx: { placement: "top" }, defx: {}, endx: { placement: "after-fields" } });
    var top = await screen.findByText("body topx");
    var summary = await screen.findByText("A short summary line");
    var def = await screen.findByText("body defx");
    var end = await screen.findByText("body endx");
    var decision = screen.getAllByText("Decision")[0];
    expect(before(top, summary)).toBe(true);
    expect(before(summary, def)).toBe(true);
    expect(before(def, decision)).toBe(true);
    expect(before(decision, end)).toBe(true);
  } finally {
    delete window.DESK_EXTENSIONS;
    window.history.replaceState(null, "", "#/today");
  }
});

test("an unknown placement in a stored manifest falls back to after Summary", async () => {
  try {
    recordWith({ odd: { placement: "sideways" } });
    var summary = await screen.findByText("A short summary line");
    expect(before(summary, await screen.findByText("body odd"))).toBe(true);
  } finally {
    delete window.DESK_EXTENSIONS;
    window.history.replaceState(null, "", "#/today");
  }
});
