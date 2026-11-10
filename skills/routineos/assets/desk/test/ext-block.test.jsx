import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, expect, test } from "vitest";
import ExtHost from "../app/ExtHost.jsx";
import { ModelProvider, StoreProvider } from "../app/StoreContext.jsx";
import Tile from "../app/pages/spec/Tile.jsx";
import { toRow } from "../core/pages/browse.js";
import { snapshotExtensions } from "../core/ext.js";
import { createStore } from "../core/store.js";

function metric(i, value) {
  var week = "2026-11-" + String(i + 1).padStart(2, "0");
  return { data: { type: "metric", key: "k" + i, status: "active", lastSeen: week, firstSeen: week, seenCount: 1, sources: ["w"],
    display: { week: week, value: value } } };
}

function role(i) {
  return { data: { type: "roles", key: "r" + String(i).padStart(3, "0"), status: "active", lastSeen: "2026-11-03T00:00:00Z",
    firstSeen: "2026-11-01T00:00:00Z", sources: ["w"], display: { title: "Role " + i } } };
}

function storeOf(entries) {
  var docs = { "meta/definition": { data: { types: {}, producers: [] } } };
  entries.forEach((e, i) => { docs["entities/" + e.data.type + "--" + i] = e; });
  return createStore("static", { docs: docs });
}

function mount(slot, factory, store) {
  window.DESK_EXTENSIONS = { box: { slot: slot, view: { type: "roles" }, types: ["roles"], verbs: [] } };
  window.DESK_COMPONENTS = Object.create(null);
  window.DESK_COMPONENTS.box = factory;
  snapshotExtensions(window.DESK_EXTENSIONS);
  return render(
    <MantineProvider>
      <StoreProvider store={store}>
        <ModelProvider model={{ viewer: "u1", definition: { types: {}, producers: [] }, join: null, owner: "u1" }}>
          <ExtHost id="box" props={{}} fallback="FALLBACK" />
        </ModelProvider>
      </StoreProvider>
    </MantineProvider>,
  );
}

afterEach(() => { cleanup(); delete window.DESK_COMPONENTS; delete window.DESK_EXTENSIONS; });

var SPEC = { id: "t", kind: "tile", label: "Sessions", query: { type: "metric", x: "week", aggregate: { op: "latest", field: "value" } } };

test("ui.block draws a tile with the same text the spec page draws from the same rows", async () => {
  var records = [metric(0, 100), metric(1, 120)].map((e, i) => ({ id: "metric--" + i, data: e.data }));
  mount("page", (ctx, p, ui) => ui.el("div", {}, ui.block(SPEC, records)), storeOf([]));
  await screen.findByText("Sessions");
  var host = document.querySelector("[data-ext='box']");
  var rows = records.map((d) => Object.assign(toRow(d, {}), { type: d.data.type }));
  var ref = render(<MantineProvider><Tile block={SPEC} rows={rows} ctx={{ now: Date.now(), range: null, filter: null }} /></MantineProvider>);
  var expected = ref.container.querySelector("[data-block]").textContent;
  expect(expected).toContain("120");
  expect(host.querySelector("[data-block]").textContent).toBe(expected);
});

test("a block spec with an unknown kind draws nothing and does not break the page", async () => {
  mount("page", (ctx, p, ui) => ui.el("div", {}, "kept", ui.block({ id: "x", kind: "nope" }, [])), storeOf([]));
  await screen.findByText("kept");
  expect(screen.queryByText("FALLBACK")).toBeNull();
});

test("a page slot reads past 50 and says whether it was capped; a panel keeps its 50", async () => {
  var entries = []; for (var i = 0; i < 120; i++) entries.push(role(i));
  var got = {};
  var factory = (name) => (ctx, p, ui) => { ctx.list({ type: "roles" }).then((r) => { got[name] = r; }); return ui.el("div", {}, "x"); };
  mount("page", factory("page"), storeOf(entries));
  await waitFor(() => expect(got.page).toBeTruthy());
  expect(got.page.length).toBe(120);
  expect(got.page.capped).toBe(false);
  cleanup();
  mount("panel", factory("panel"), storeOf(entries));
  await waitFor(() => expect(got.panel).toBeTruthy());
  expect(got.panel.length).toBe(50);
});

// extTreeOk used to stop at a ui.block body, so a component that held a reference to it could put anything inside.
import { extTreeOk, interactiveUi } from "../app/componentUi.js";

function blockBody() {
  var ui = interactiveUi(() => {}, true, () => {});
  var outer = ui.el("div", {}, ui.block({ id: "x", kind: "text", text: "hi" }, []));
  return { outer: outer, body: outer.querySelector("[data-desk-block]") };
}

test("a block body is checked: an element or attribute that could run or load code is refused", () => {
  var { outer, body } = blockBody();
  expect(extTreeOk(outer)).toBe(true);
  var img = document.createElement("img");
  img.setAttribute("src", "https://x.example/a.png");
  body.appendChild(img);
  expect(extTreeOk(outer)).toBe(false);
  body.replaceChildren();
  var frame = document.createElement("if" + "rame");
  body.appendChild(frame);
  expect(extTreeOk(outer)).toBe(false);
  body.replaceChildren();
  var b = document.createElement("button");
  b.setAttribute("onclick", "x()");
  body.appendChild(b);
  expect(extTreeOk(outer)).toBe(false);
  body.replaceChildren();
  var a = document.createElement("a");
  a.setAttribute("href", "javascript:alert(1)");
  body.appendChild(a);
  expect(extTreeOk(outer)).toBe(false);
  body.replaceChildren();
  body.setAttribute("onmouseover", "x()");
  expect(extTreeOk(outer)).toBe(false);
});

test("what the Desk draws into a block body (cards, tables, svg, text, https links) passes the check", () => {
  var { outer, body } = blockBody();
  var card = document.createElement("div");
  card.setAttribute("style", "padding: 4px");
  card.setAttribute("data-block", "x");
  var table = document.createElement("table");
  table.innerHTML = "<thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody>";
  var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "path"));
  var link = document.createElement("a");
  link.setAttribute("href", "https://example.com/x");
  var sw = document.createElement("input");
  sw.setAttribute("type", "checkbox");
  card.append(table, svg, link, sw, document.createTextNode("text"));
  body.appendChild(card);
  expect(extTreeOk(outer)).toBe(true);
});
