import { expect, test } from "vitest";
import { extTreeOk, interactiveUi, renderExtension } from "../app/componentUi.js";

var SVG_NS = "http://www.w3.org/2000/svg";
var ui = interactiveUi(function () {}, true);

function chart() {
  return ui.el("svg", { viewBox: "0 0 100 40", width: "100", height: "40", role: "img", "aria-label": "Trend" },
    ui.el("g", { transform: "translate(0,0)" },
      ui.el("polyline", { points: "0,0 10,10", stroke: "currentColor", fill: "none", "stroke-width": "2", "stroke-dasharray": "4 2" }),
      ui.el("text", { x: "5", y: "5", "text-anchor": "middle" }, "label")));
}

test("ui.el draws real SVG elements in the SVG namespace and the tree passes the host check", () => {
  var svg = chart();
  expect(svg.namespaceURI).toBe(SVG_NS);
  expect(svg.getAttribute("viewBox")).toBe("0 0 100 40");
  var line = svg.querySelector("polyline");
  expect(line.namespaceURI).toBe(SVG_NS);
  expect(line.getAttribute("points")).toBe("0,0 10,10");
  expect(extTreeOk(ui.el("div", {}, svg))).toBe(true);
});

test("ui.el refuses the SVG tags that can load, script or animate", () => {
  ["foreignObject", "use", "image", "script", "style", "animate", "set"].forEach((tag) => {
    expect(() => ui.el(tag, {}), tag).toThrow(/not allowed/);
  });
});

test("ui.el refuses href, xlink:href, style and handlers on SVG, and a paint that names a url", () => {
  expect(() => ui.el("path", { d: "M0 0", href: "https://x.example/a" })).toThrow();
  expect(() => ui.el("path", { d: "M0 0", "xlink:href": "#a" })).toThrow();
  expect(() => ui.el("path", { d: "M0 0", style: "fill:red" })).toThrow();
  expect(() => ui.el("path", { d: "M0 0", onload: "x()" })).toThrow();
  expect(() => ui.el("rect", { width: "1", fill: "url(#a)" })).toThrow();
});

test("extTreeOk refuses a tree that smuggles a banned SVG tag, attribute or namespace in by other means", () => {
  function wrap(node) { var d = document.createElement("div"); d.appendChild(node); return d; }
  var s = document.createElementNS(SVG_NS, "svg");
  s.appendChild(document.createElementNS(SVG_NS, "foreignObject"));
  expect(extTreeOk(wrap(s))).toBe(false);
  var u = document.createElementNS(SVG_NS, "svg");
  u.appendChild(document.createElementNS(SVG_NS, "use"));
  expect(extTreeOk(wrap(u))).toBe(false);
  var h = document.createElementNS(SVG_NS, "svg");
  var p = document.createElementNS(SVG_NS, "path");
  p.setAttribute("href", "#a");
  h.appendChild(p);
  expect(extTreeOk(wrap(h))).toBe(false);
  var st = document.createElementNS(SVG_NS, "svg");
  st.setAttribute("style", "x");
  expect(extTreeOk(wrap(st))).toBe(false);
  var ol = document.createElementNS(SVG_NS, "svg");
  ol.setAttribute("onload", "x()");
  expect(extTreeOk(wrap(ol))).toBe(false);
  expect(extTreeOk(wrap(document.createElement("svg")))).toBe(false);
  var a = document.createElement("div");
  a.setAttribute("viewBox", "0 0 1 1");
  expect(extTreeOk(a)).toBe(false);
});

test("a component that returns a banned SVG tree draws the fallback", () => {
  window.DESK_COMPONENTS = Object.create(null);
  window.DESK_COMPONENTS.bad = function () { return document.createElementNS(SVG_NS, "foreignObject"); };
  window.DESK_COMPONENTS.good = function (ctx, p, u) { return u.el("div", {}, chart()); };
  expect(renderExtension("bad", {}, { canWrite: true })).toBeNull();
  expect(renderExtension("good", {}, { canWrite: true })).not.toBeNull();
  delete window.DESK_COMPONENTS;
});
