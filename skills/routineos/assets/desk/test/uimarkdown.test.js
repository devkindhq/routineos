import { expect, test } from "vitest";
import { extTreeOk, interactiveUi, renderExtension } from "../app/componentUi.js";

var ui = interactiveUi(function () {}, true);

function md(text, opts) {
  var host = document.createElement("div");
  host.appendChild(ui.markdown(text, opts));
  return host;
}

test("headings become heading elements and no literal # remains; h1 and h2 map down to h3", () => {
  var h = md("# One\n\n## Two\n\n### Three\n\n#### Four\n\nbody");
  expect(h.querySelectorAll("h3").length).toBe(3);
  expect(h.querySelectorAll("h4").length).toBe(1);
  expect(h.querySelector("h1,h2,h5,h6")).toBeNull();
  expect(h.textContent).not.toContain("#");
  expect(h.querySelector("h3").textContent).toBe("One");
});

test("bold, italic, code and lists become elements", () => {
  var h = md("**b** and *i* and `c`\n\n- one\n- two\n\n1. first\n2. second");
  expect(h.querySelector("strong").textContent).toBe("b");
  expect(h.querySelector("em").textContent).toBe("i");
  expect(h.querySelector("code").textContent).toBe("c");
  expect(h.querySelectorAll("ul > li").length).toBe(2);
  expect(h.querySelectorAll("ol > li").length).toBe(2);
  expect(h.textContent).not.toContain("**");
  expect(h.textContent).not.toContain("`");
});

test("raw HTML is shown as text, never as elements", () => {
  var h = md('before <script>alert(1)</script> <img src=x onerror=alert(1)> after\n\n<div onclick="x">hi</div>');
  expect(h.querySelector("script,img,div div div")).toBeNull();
  expect(h.textContent).toContain("<script>");
  expect(h.textContent).toContain("<div onclick");
});

test("only an https link is live; javascript: and http links are plain text", () => {
  var h = md("[a](https://ok.example/x) [b](javascript:alert(1)) [c](http://nope.example) [d](data:text/html,x)");
  var links = h.querySelectorAll("a");
  expect(links.length).toBe(1);
  expect(links[0].getAttribute("href")).toBe("https://ok.example/x");
  expect(links[0].getAttribute("rel")).toBe("noopener noreferrer");
  ["b", "c", "d"].forEach((t) => expect(h.textContent).toContain(t));
  expect(h.textContent).not.toContain("javascript");
});

test("an image is its alt text and nothing else", () => {
  var h = md("see ![the chart](https://x.example/p.png) here");
  expect(h.querySelector("img")).toBeNull();
  expect(h.textContent).toContain("see the chart here");
});

test("marks highlight case-insensitively, keep the original case, and do not break across tags", () => {
  var h = md("The Band is **banded** and a band again", { marks: ["band"] });
  var marks = Array.prototype.map.call(h.querySelectorAll("mark"), (m) => m.textContent);
  expect(marks).toEqual(["Band", "band", "band"]);
  expect(h.textContent).toBe("The Band is banded and a band again");
  expect(h.querySelector("strong mark")).not.toBeNull();
  var split = md("ab**cd**", { marks: ["abcd"] });
  expect(split.querySelectorAll("mark").length).toBe(0);
});

test("marks are literal text: regex characters are escaped and empty marks are ignored", () => {
  var h = md("cost (a+b) and a.b", { marks: ["(a+b)", "", "a.b"] });
  expect(Array.prototype.map.call(h.querySelectorAll("mark"), (m) => m.textContent)).toEqual(["(a+b)", "a.b"]);
});

test("onlyMarked keeps only the blocks, headings and list items that hold a mark", () => {
  var text = "# Intro\n\nplain paragraph\n\n## Pay Band\n\nA para with the band word.\n\n- keep the BAND item\n- drop me\n\n- other list\n- second other";
  var h = md(text, { marks: ["band"], onlyMarked: true });
  expect(h.textContent).toContain("Pay Band");
  expect(h.textContent).toContain("A para with the band word.");
  expect(h.textContent).toContain("keep the BAND item");
  ["Intro", "plain paragraph", "drop me", "other list"].forEach((t) => expect(h.textContent).not.toContain(t));
  expect(h.querySelectorAll("li").length).toBe(1);
  expect(h.querySelectorAll("ul").length).toBe(1);
});

test("onlyMarked with no marks shows nothing, and without onlyMarked the marks filter nothing", () => {
  expect(md("a\n\nb", { onlyMarked: true }).querySelectorAll("p").length).toBe(0);
  expect(md("a\n\nb", { marks: ["zzz"] }).querySelectorAll("p").length).toBe(2);
});

test("clamp shows at most that many blocks", () => {
  var h = md("one\n\ntwo\n\nthree\n\nfour", { clamp: 2 });
  expect(h.querySelectorAll("p").length).toBe(2);
  expect(h.textContent).toContain("two");
  expect(h.textContent).not.toContain("three");
});

test("blank, missing and non-string text give an empty element", () => {
  [undefined, null, "", 5].forEach((t) => expect(() => ui.markdown(t)).not.toThrow());
  expect(ui.markdown(null).childNodes.length).toBe(0);
});

test("everything it builds passes the host's allowed-tree check; a hand-built forbidden tree still fails", () => {
  var text = "# T\n\n**b** *i* `c` [l](https://a.example) <b>raw</b>\n\n- x\n  - nested\n1. y\n\n> quote\n\n```\ncode block\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n---\n\n![alt](https://i.example/i.png)";
  var node = ui.markdown(text, { marks: ["quote", "code"] });
  expect(extTreeOk(node)).toBe(true);
  var bad = ui.markdown("hi");
  bad.appendChild(document.createElement("iframe"));
  expect(extTreeOk(bad)).toBe(false);
  var bad2 = ui.markdown("hi");
  bad2.setAttribute("style", "x");
  expect(extTreeOk(bad2)).toBe(false);
});

test("a hand-written component that builds the same tree with a forbidden tag is still rejected", () => {
  window.DESK_COMPONENTS = Object.create(null);
  window.DESK_COMPONENTS.good = function (ctx, p, u) { return u.markdown("# H\n\ntext", { marks: ["text"] }); };
  window.DESK_COMPONENTS.bad = function (ctx, p, u) { var n = u.markdown("x"); n.appendChild(document.createElement("h1")); return n; };
  expect(renderExtension("good", {}, { canWrite: true })).not.toBeNull();
  expect(renderExtension("bad", {}, { canWrite: true })).toBeNull();
  delete window.DESK_COMPONENTS;
});
