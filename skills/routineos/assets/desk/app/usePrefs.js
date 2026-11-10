// app/usePrefs.js: the viewer's display choices (theme, sidebar, density, motion), kept with core/prefs.js under the
// earlier Desk's localStorage keys, and the Mantine theme they make.
import { createContext, createElement, useCallback, useContext, useMemo, useState } from "react";
import { createTheme } from "@mantine/core";
import {
  DENSITIES, DENSITY_KEY, MOTIONS, MOTION_KEY, SIDEBAR_KEY, THEMES, ZOOMS, ZOOM_DEFAULT, ZOOM_KEY, readPref, readTheme, savePref, saveTheme,
} from "../core/prefs.js";

export var SIDEBARS = ["full", "slim"];
var ALLOWED = { theme: THEMES, sidebar: SIDEBARS, density: DENSITIES, motion: MOTIONS, zoom: ZOOMS };
var KEYS = { sidebar: SIDEBAR_KEY, density: DENSITY_KEY, motion: MOTION_KEY, zoom: ZOOM_KEY };

export function readPrefs() {
  return {
    theme: readTheme(),
    sidebar: readPref(SIDEBAR_KEY, SIDEBARS, "full"),
    density: readPref(DENSITY_KEY, DENSITIES, "comfortable"),
    motion: readPref(MOTION_KEY, MOTIONS, "system"),
    zoom: readPref(ZOOM_KEY, ZOOMS, ZOOM_DEFAULT),
  };
}

// A touch screen or a phone-width window (48em is Mantine's sm, the navbar breakpoint).
export var TOUCH_QUERY = "(pointer: coarse), (max-width: 48em)";
var TOUCH_TARGET = "44px";

// Compact density scales Mantine's rem units to 0.9; motion "reduce" makes Mantine respect reduced motion. On touch,
// fields are 16px at every size so iOS does not zoom the page on focus (px, so compact cannot scale them down).
export function themeFor(prefs, opts) {
  var touch = !!(opts && opts.touch);
  var components = {};
  if (touch) {
    var root = function (v) { return { vars: function () { return { root: v }; } }; };
    components.Input = { vars: function () { return { wrapper: { "--input-fz": "16px" } }; } };
    // Touch targets of 44px (WCAG 2.5.5). The burger's box is its size plus spacing-xs, so spacing-xs grows on it.
    components.ActionIcon = root({ "--ai-size": TOUCH_TARGET });
    components.Button = root({ "--button-height": TOUCH_TARGET });
    components.CloseButton = root({ "--cb-size": TOUCH_TARGET });
    components.Burger = root({ "--burger-size": "18px", "--mantine-spacing-xs": "26px" });
    components.Pagination = root({ "--pagination-control-size": TOUCH_TARGET });
    components.NavLink = { defaultProps: { mih: TOUCH_TARGET } };
    // Segmented items and table header cells (the sort buttons, the select-all box) reach 44px through their padding.
    components.SegmentedControl = root({ "--sc-padding": "13px 16px" });
    components.Table = { vars: function () { return { table: { "--table-vertical-spacing": "12px" } }; } };
  }
  return createTheme({
    scale: prefs.density === "compact" ? 0.9 : 1,
    respectReducedMotion: prefs.motion === "reduce",
    components: components,
  });
}

// Mantine's color scheme, stored under the Desk's theme key as system, light or dark.
export var deskSchemeManager = {
  get: function (fallback) {
    var t = readTheme();
    return t === "system" ? fallback || "auto" : t;
  },
  set: function (value) { saveTheme(value === "auto" ? "system" : value); },
  subscribe: function () {},
  unsubscribe: function () {},
  clear: function () {},
};

const PrefsContext = createContext(null);

export function PrefsProvider({ children }) {
  const [prefs, setPrefs] = useState(readPrefs);
  const set = useCallback((key, value) => {
    if (!ALLOWED[key] || ALLOWED[key].indexOf(value) === -1) return;
    if (key === "theme") saveTheme(value);
    else savePref(KEYS[key], value);
    setPrefs((p) => (p[key] === value ? p : Object.assign({}, p, { [key]: value })));
  }, []);
  const value = useMemo(() => Object.assign({}, prefs, { set: set }), [prefs, set]);
  return createElement(PrefsContext.Provider, { value: value }, children);
}

export function usePrefs() {
  return useContext(PrefsContext);
}
