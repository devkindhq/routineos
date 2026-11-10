// core/keys.js: the single-key and g-chord shortcuts as a small state machine (spec 5.11). The app owns Cmd+K,
// Escape and focus; this decides what a plain key press means.

import { isTyping, shortcutFor } from "./palette.js";

export { isTyping, shortcutFor };

export var G_WAIT_MS = 1500;

// opts: {onNav(hash), onRun(name), types: array or () => array, now: () => ms}. key(ev) returns true when the press
// was a shortcut (the caller then calls preventDefault), false when it was not.
export function createChordMachine(opts) {
  opts = opts || {};
  var now = opts.now || function () { return Date.now(); };
  var gAt = null;
  function types() { return typeof opts.types === "function" ? opts.types() : opts.types || []; }
  return {
    key: function (ev) {
      if (!ev || ev.metaKey || ev.ctrlKey || ev.altKey || isTyping(ev.target)) return false;
      var key = String(ev.key).length === 1 ? String(ev.key).toLowerCase() : "";
      if (!key) return false;
      var keys = gAt !== null && now() - gAt < G_WAIT_MS ? ["g", key] : [key];
      gAt = null;
      var list = types();
      var hit = shortcutFor(keys, list);
      if (!hit && keys.length === 2) hit = shortcutFor([key], list);
      if (!hit) return false;
      if (hit.pending) { gAt = now(); return true; }
      if (hit.go) { if (opts.onNav) opts.onNav(hit.go); return true; }
      if (opts.onRun) opts.onRun(hit.run);
      return true;
    },
  };
}
