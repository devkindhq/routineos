// Pinch-zoom lock: the root touch-action and the cancelled gesture events, and the Appearance switch.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "vitest";
import App from "../app/App.jsx";
import { ZOOM_DEFAULT, ZOOM_KEY } from "../core/prefs.js";
import { createStore } from "../core/store.js";
import { applyZoomLock } from "../app/zoomlock.js";

var DEFINITION = { types: { roles: { label: "Role", plural: "Roles", fields: { title: { label: "Title", type: "text" } } } }, producers: [] };
function store() {
  return createStore("static", { docs: { "meta/definition": { data: DEFINITION }, "meta/workspace": { data: { name: "Test workspace" } } } });
}


function locked() { return document.documentElement.style.touchAction === "pan-x pan-y"; }
function fire(type, init) {
  var e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, init || {});
  document.dispatchEvent(e);
  return e.defaultPrevented;
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "#/settings/appearance");
});
afterEach(() => { applyZoomLock(false); cleanup(); });

test("locking sets touch-action pan-x pan-y on the root and unlocking clears it", () => {
  applyZoomLock(true);
  expect(document.documentElement.style.touchAction).toBe("pan-x pan-y");
  applyZoomLock(false);
  expect(document.documentElement.style.touchAction).toBe("");
});

test("locked: gesture events and two-finger touchmoves are cancelled, a one-finger touchmove is not", () => {
  applyZoomLock(true);
  expect(fire("gesturestart")).toBe(true);
  expect(fire("gesturechange")).toBe(true);
  expect(fire("touchmove", { touches: [{}, {}] })).toBe(true);
  expect(fire("touchmove", { touches: [{}] })).toBe(false);
});

test("unlocked: nothing is cancelled", () => {
  applyZoomLock(true);
  applyZoomLock(false);
  expect(fire("gesturestart")).toBe(false);
  expect(fire("touchmove", { touches: [{}, {}] })).toBe(false);
});

test("text size is left alone: the lock sets nothing but touch-action", () => {
  applyZoomLock(true);
  expect(document.documentElement.style.fontSize).toBe("");
  expect(document.documentElement.style.cssText).toBe("touch-action: pan-x pan-y;");
});

test("the default is locked, and the Desk locks on load", () => {
  expect(ZOOM_DEFAULT).toBe("lock");
  render(<App store={store()} config={{}} />);
  expect(locked()).toBe(true);
});

test("Allow pinch zoom in Appearance stores the choice and unlocks; Off locks again", async () => {
  render(<App store={store()} config={{}} />);
  var group = await screen.findByRole("radiogroup", { name: "Allow pinch zoom" });
  fireEvent.click(within(group).getByLabelText("On"));
  expect(localStorage.getItem(ZOOM_KEY)).toBe("allow");
  expect(locked()).toBe(false);
  fireEvent.click(within(group).getByLabelText("Off"));
  expect(localStorage.getItem(ZOOM_KEY)).toBe("lock");
  expect(locked()).toBe(true);
});

test("a stored allow is honoured on load", () => {
  localStorage.setItem(ZOOM_KEY, "allow");
  render(<App store={store()} config={{}} />);
  expect(locked()).toBe(false);
});
