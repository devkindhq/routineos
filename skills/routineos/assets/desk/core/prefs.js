// core/prefs.js: per-viewer conveniences kept in localStorage (theme, sidebar, density, motion, nav groups) and the
// build-time config read. The page works the same when storage is blocked. The keys match the earlier Desk exactly.

export var THEMES = ["system", "light", "dark"];
export var THEME_KEY = "routineos-desk-theme";
export var SIDEBAR_KEY = "routineos-desk-sidebar";
export var DENSITY_KEY = "routineos-desk-density";
export var DENSITIES = ["comfortable", "compact"];
export var MOTION_KEY = "routineos-desk-motion";
export var MOTIONS = ["system", "reduce"];
export var ZOOM_KEY = "routineos-desk-zoom";
// "lock" stops pinch zoom, "allow" gives it back. ZOOM_DEFAULT is the single switch: set it to "allow" to ship with zoom on.
export var ZOOMS = ["lock", "allow"];
export var ZOOM_DEFAULT = "lock";
export var NAV_GROUP_KEY = "routineos-desk-nav:";

function storage() {
  try { return globalThis.localStorage || null; } catch (e) { return null; }
}

export function readPref(key, allowed, fallback) {
  var v = null;
  try { var s = storage(); v = s ? s.getItem(key) : null; } catch (e) { v = null; }
  return allowed.indexOf(v) === -1 ? fallback : v;
}

export function savePref(key, v) {
  try { var s = storage(); if (s) s.setItem(key, v); } catch (e) { /* blocked: the choice lasts this visit */ }
}

export function readTheme() { return readPref(THEME_KEY, THEMES, "system"); }
export function saveTheme(t) { savePref(THEME_KEY, t); }

// node: the <script type="application/json" id="desk-config"> element, or null. A missing or broken node is {}.
export function readConfig(node) {
  try { return JSON.parse(node ? node.textContent : "{}") || {}; } catch (e) { return {}; }
}
