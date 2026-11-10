import { expect, test } from "vitest";
import { deskPages, navModel, specPageFor } from "../core/palette.js";
import { route } from "../core/router.js";

var DEF = {
  types: { metric: { plural: "Metrics", fields: { week: { type: "date" }, value: { type: "number" } } } },
  desk: { pages: [
    { id: "overview", title: "Overview", nav: { label: "Weekly overview" }, blocks: [
      { id: "a", kind: "tile", label: "Sessions", query: { type: "metric", x: "week", aggregate: { op: "latest", field: "value" } } },
      { id: "b", kind: "tile", label: "Gone", query: { type: "removed", x: "week", aggregate: { op: "latest", field: "value" } } },
      { id: "t", kind: "text", text: "Hello" },
    ] },
    { id: "untitled", title: "", blocks: [] },
    { id: "nobody", title: "No blocks" },
    "junk",
  ] },
};

test("#/p/<id> is the spec page route", () => {
  expect(route("#/p/overview")).toEqual({ page: "spec", params: { id: "overview" } });
});

test("deskPages drops a page with no title, no blocks list, and blocks on a removed type", () => {
  var pages = deskPages(DEF);
  expect(pages.map((p) => p.id)).toEqual(["overview"]);
  expect(pages[0].blocks.map((b) => b.id)).toEqual(["a", "t"]);
});

test("deskPages is empty without a desk block", () => {
  expect(deskPages({ types: {} })).toEqual([]);
  expect(deskPages(null)).toEqual([]);
});

test("specPageFor finds a page by id and nothing else", () => {
  expect(specPageFor(DEF, "overview").title).toBe("Overview");
  expect(specPageFor(DEF, "untitled")).toBeNull();
  expect(specPageFor(DEF, "nope")).toBeNull();
});

test("nav without spec pages has no extra group", () => {
  var nav = navModel({ types: DEF.types }, [], null, null);
  expect(nav.groups.map((g) => g.id)).toEqual(["workspace", "lists"]);
});

test("nav with a spec page adds a Pages group labelled by nav.label or title", () => {
  var nav = navModel(DEF, [], null, null);
  var g = nav.groups.filter((x) => x.id === "specpages")[0];
  expect(g.label).toBe("Pages");
  expect(g.items).toEqual([{ id: "spec:overview", label: "Weekly overview", href: "#/p/overview", icon: "list", children: [] }]);
});

test("spec pages join the code pages group when there is one", () => {
  var nav = navModel(DEF, [], null, null, undefined, undefined, [{ id: "calc", title: "Calc" }]);
  var pages = nav.groups.filter((x) => x.label === "Pages");
  expect(pages.length).toBe(1);
  expect(pages[0].items.map((i) => i.id)).toEqual(["ext:calc", "spec:overview"]);
});

test("deskPages drops a page whose id is a built-in, retired or never-learnable id, or a module id", () => {
  var page = (id) => ({ id: id, title: "T", blocks: [] });
  var def = { types: {}, desk: {
    modules: [{ id: "recent", kind: "view", label: "Recent", view: { type: "metric" } }],
    pages: ["today", "settings", "inbox", "send-report", "recent", "ok-page"].map(page),
  } };
  expect(deskPages(def).map((p) => p.id)).toEqual(["ok-page"]);
});
