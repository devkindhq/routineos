// app/Keyboard.jsx: the Desk's keys (core/keys.js). Ctrl K or Cmd K toggles the palette; the rest goes through the
// chord machine, which ignores presses while a person types. Page-level keys reach the page as window events.
import { useEffect, useRef } from "react";
import { createChordMachine } from "../core/keys.js";
import { navTypes_ } from "../core/palette.js";

export var OPEN_FILTERS = "desk:open-filters";
export var LIST_KEY = "desk:list-key";
export var SEARCH_KEY = "desk:search";

// A cancelable event a page answers by calling preventDefault; returns whether one did.
function ask(name, detail) {
  var ev = new CustomEvent(name, { cancelable: true, detail: detail });
  window.dispatchEvent(ev);
  return ev.defaultPrevented;
}

export default function Keyboard(props) {
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => {
    function run(name) {
      var p = latest.current;
      if (name === "sidebar") p.onSidebar();
      else if (name === "help") p.onHelp();
      else if (name === "notifications") p.onBell();
      else if (name === "filters") { if (p.page === "browse") ask(OPEN_FILTERS); }
      else if (name === "search") { if (!ask(SEARCH_KEY)) p.onPalette(); }
      else ask(LIST_KEY, { key: name });
    }
    var machine = createChordMachine({
      types: function () { return navTypes_(latest.current.definition); },
      onNav: function (hash) { latest.current.go(hash); },
      onRun: run,
    });
    function onKey(ev) {
      if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && String(ev.key).toLowerCase() === "k") {
        ev.preventDefault();
        latest.current.onPalette();
        return;
      }
      if (ev.defaultPrevented || !latest.current.enabled) return;
      if (machine.key(ev)) ev.preventDefault();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return null;
}
