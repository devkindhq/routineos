// app/useRoute.js: the hash route (core/router.js). An old address is swapped for its v2 one with replaceState, so
// Back does not loop. replaceParams rewrites the query without adding a history entry.
import { useCallback, useEffect, useState } from "react";
import { queryString_, route } from "../core/router.js";

export var ROUTE_EVENT = "desk:route";

function read() {
  var r = route(window.location.hash);
  if (r.redirect) window.history.replaceState(window.history.state, "", r.redirect);
  return { hash: window.location.hash, r: r };
}

export function go(hash) {
  if (window.location.hash !== hash) window.location.hash = hash;
}

// obj: {key: value}; null, undefined or "" removes the key. Other query keys are kept.
export function replaceParams(obj) {
  var h = window.location.hash || "#/today";
  var qi = h.indexOf("?");
  var path = qi === -1 ? h : h.slice(0, qi);
  var q = Object.assign({}, route(h).params.query || {});
  Object.keys(obj || {}).forEach(function (k) {
    var v = obj[k];
    if (v === null || v === undefined || v === "") delete q[k];
    else q[k] = String(v);
  });
  var next = path + queryString_(q);
  if (next !== h) {
    window.history.replaceState(window.history.state, "", next);
    window.dispatchEvent(new Event(ROUTE_EVENT));
  }
}

export function useRoute() {
  const [state, setState] = useState(read);
  useEffect(() => {
    function on() {
      var next = read();
      setState((prev) => (prev.hash === next.hash ? prev : next));
    }
    window.addEventListener("hashchange", on);
    window.addEventListener(ROUTE_EVENT, on);
    on();
    return () => {
      window.removeEventListener("hashchange", on);
      window.removeEventListener(ROUTE_EVENT, on);
    };
  }, []);
  const goTo = useCallback(go, []);
  const replace = useCallback(replaceParams, []);
  return { page: state.r.page, params: state.r.params, hash: state.hash, go: goTo, replaceParams: replace };
}
