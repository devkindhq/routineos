// The slash-free address (#d--...) a Desk in a frame uses, because the host passes only #name with ASCII letters,
// digits and hyphens through to the page address. It round-trips every #/ route.
import { expect, test } from "vitest";
import { canonicalHash, fromFrameHash, route, toFrameHash } from "../core/router.js";

var RESERVED = ["settings", "sidebar", "customize", "upgrade", "downloads"];

test("an entity route becomes a slash-free address and reads back to the same route", () => {
  var h = "#/entity/roles/a";
  var f = toFrameHash(h);
  expect(f).toBe("#d--entity--roles--a");
  expect(f).toMatch(/^#[A-Za-z0-9-]+$/);
  expect(fromFrameHash(f)).toBe(h);
  expect(route(f)).toEqual(route(h));
});

test("odd ids survive: hyphens, double hyphens, slashes, spaces, unicode, percent, tilde", () => {
  ["a-b", "a--b", "a---b", "x/y", "a b", "café", "100%", "a~b", "-", "--", "a.b", "AbC123"].forEach((id) => {
    var h = "#/entity/roles/" + encodeURIComponent(id);
    var f = toFrameHash(h);
    expect(f, id).toMatch(/^#[A-Za-z0-9-]+$/);
    expect(route(f).params, id).toEqual({ type: "roles", key: id });
    expect(fromFrameHash(f), id).toBe(h);
  });
});

test("the encoding is injective: two different routes never give the same address", () => {
  var seen = {};
  ["a-b", "a--b", "a-2db", "a", "a-", "-a", "a/b", "a-2fb"].forEach((id) => {
    var f = toFrameHash("#/entity/t/" + encodeURIComponent(id));
    expect(seen[f], id).toBeUndefined();
    seen[f] = id;
  });
});

test("other routes and queries round trip", () => {
  ["#/today", "#/browse/roles", "#/runs/r1", "#/approvals", "#/settings/members", "#/x/ext/a/b", "#/browse/roles?status=dropped&q=a%20b",
    "#/entity/roles/a?view=v1&cols=title%2Cstatus"].forEach((h) => {
    var f = toFrameHash(h);
    expect(f, h).toMatch(/^#[A-Za-z0-9-]+$/);
    expect(route(f), h).toEqual(route(h));
  });
});

test("the new form starts with d--, so a name the host reserves is never read as a route", () => {
  ["#/settings", "#/today", "#/entity/comment/x", "#/browse/sidebar", "#/entity/t/comment-1"].forEach((h) => {
    var name = toFrameHash(h).slice(1);
    expect(name.indexOf("d--")).toBe(0);
    expect(RESERVED).not.toContain(name);
  });
  RESERVED.concat(["comment-123", "comment-a-b"]).forEach((n) => {
    expect(fromFrameHash("#" + n), n).toBeNull();
  });
  expect(route("#comment-123").page).toBe("today");
});

test("a segment that starts with ? stays a segment and is not read as the query", () => {
  ["#/entity/roles/%3Fx", "#/runs/%3F", "#/entity/r/%3Fx?y=1", "#/entity/r/%253Fx", "#/browse/%3F%3F?q=%3F"].forEach((h) => {
    var f = toFrameHash(h);
    expect(f, h).toMatch(/^#[A-Za-z0-9-]+$/);
    expect(route(f), h).toEqual(route(h));
  });
  expect(route(toFrameHash("#/entity/roles/%3Fx")).params).toEqual({ type: "roles", key: "?x" });
  expect(route(toFrameHash("#/runs/%3F")).params).toEqual({ id: "?" });
  expect(fromFrameHash(toFrameHash("#/browse/roles?q=a"))).toBe("#/browse/roles?q=a");
});

test("a very long id round trips", () => {
  var id = "é".repeat(300) + "-" + "a".repeat(500);
  var h = "#/entity/roles/" + encodeURIComponent(id);
  var f = toFrameHash(h);
  expect(f).toMatch(/^#[A-Za-z0-9-]+$/);
  expect(route(f).params).toEqual({ type: "roles", key: id });
  expect(fromFrameHash(f)).toBe(h);
});

test("an address that is not a valid new form is not read as one", () => {
  ["#d--entity--roles--a-zz", "#d--entity--roles--a-2", "#d--entity--roles--a-ff-fe", "#d-entity", "#/entity/roles/a", "#today", "", "#d--entity--roles--a_b", "#d--entity--roles----", "#d--entity--roles--a--", "#d--browse----a--b"].forEach((h) => {
    expect(fromFrameHash(h), h).toBeNull();
  });
  expect(route("#d--entity--roles--a-zz").page).toBe("today");
});

test("canonicalHash gives the #/ form for either spelling and leaves anything else alone", () => {
  expect(canonicalHash("#d--entity--roles--a")).toBe("#/entity/roles/a");
  expect(canonicalHash("#/entity/roles/a")).toBe("#/entity/roles/a");
  expect(canonicalHash("")).toBe("");
});

test("toFrameHash leaves a non-route alone", () => {
  expect(toFrameHash("#today")).toBeNull();
  expect(toFrameHash("")).toBeNull();
});
