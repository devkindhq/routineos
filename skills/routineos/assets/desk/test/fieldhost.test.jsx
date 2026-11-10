import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import FieldHost from "../app/FieldHost.jsx";
import { componentUi, renderComponent } from "../app/componentUi.js";
import { createStore } from "../core/store.js";

var store = createStore("static", { docs: {} });
var props = { value: { min: 10, max: 20 }, record: { id: "r1" }, field: "band" };

afterEach(() => {
  cleanup();
  delete window.DESK_COMPONENTS;
});

function host(factory) {
  window.DESK_COMPONENTS = Object.create(null);
  window.DESK_COMPONENTS.band = factory;
  return render(<FieldHost id="band" props={props} store={store} fallback="10 to 20 (plain)" />);
}

test("a component that builds with ui.el is drawn", () => {
  var { container } = host(function (ctx, p, ui) {
    return ui.el("span", { class: "band" }, ui.el("b", null, String(p.value.min)), " to " + p.value.max);
  });
  expect(container.textContent).toBe("10 to 20");
  expect(container.querySelector("b").textContent).toBe("10");
});

test("a factory that throws shows the fallback", () => {
  var { container } = host(function () { throw new Error("boom"); });
  expect(container.textContent).toBe("10 to 20 (plain)");
});

test("a factory that returns a string shows the fallback", () => {
  var { container } = host(function () { return "<b>str</b>"; });
  expect(container.textContent).toBe("10 to 20 (plain)");
  expect(container.querySelector("b")).toBeNull();
});

test("a factory that returns a script element shows the fallback and mounts no script", () => {
  var ran = false;
  window.__ranScript = function () { ran = true; };
  var { container } = host(function () {
    var s = document.createElement("script");
    s.textContent = "window.__ranScript()";
    return s;
  });
  expect(container.textContent).toBe("10 to 20 (plain)");
  expect(document.querySelectorAll("script").length).toBe(0);
  expect(ran).toBe(false);
  delete window.__ranScript;
});

test("a script hidden inside an allowed element is refused too", () => {
  var { container } = host(function () {
    var d = document.createElement("div");
    d.appendChild(document.createElement("script"));
    return d;
  });
  expect(container.textContent).toBe("10 to 20 (plain)");
  expect(document.querySelectorAll("script").length).toBe(0);
});

test("an element with an event handler attribute is refused", () => {
  var { container } = host(function () {
    var d = document.createElement("span");
    d.setAttribute("onclick", "alert1()");
    d.textContent = "x";
    return d;
  });
  expect(container.textContent).toBe("10 to 20 (plain)");
});

test("a missing component shows the fallback", () => {
  window.DESK_COMPONENTS = Object.create(null);
  var { container } = render(<FieldHost id="nope" props={props} store={store} fallback="plain" />);
  expect(container.textContent).toBe("plain");
});

test("ui.el refuses tags and attributes outside the allow-list, and links that are not https", () => {
  var ui = componentUi();
  expect(() => ui.el("script")).toThrow();
  expect(() => ui.el("span", { onclick: "x" })).toThrow();
  expect(() => ui.el("span", { style: "x" })).toThrow();
  expect(() => ui.el("a", { href: "javascript:alert(1)" })).toThrow();
  expect(ui.el("a", { href: "https://example.org/x" }, "ok").getAttribute("href")).toBe("https://example.org/x");
  expect(ui.el("span", { "data-x": "1", "aria-label": "y" }).getAttribute("data-x")).toBe("1");
});

test("the component sees only store.get and store.list", () => {
  var seen = null;
  window.DESK_COMPONENTS = Object.create(null);
  window.DESK_COMPONENTS.band = function (ctx) { seen = Object.keys(ctx.store).sort(); return document.createElement("span"); };
  renderComponent("band", props, store);
  expect(seen).toEqual(["get", "list"]);
});

test("a new props object with the same value, record and field does not run the factory again", () => {
  var calls = 0;
  window.DESK_COMPONENTS = Object.create(null);
  window.DESK_COMPONENTS.band = function (ctx, p, ui) { calls++; return ui.el("span", null, "x"); };
  var { rerender } = render(<FieldHost id="band" props={Object.assign({}, props)} store={store} fallback="plain" />);
  rerender(<FieldHost id="band" props={Object.assign({}, props)} store={store} fallback="plain" />);
  expect(calls).toBe(1);
});
