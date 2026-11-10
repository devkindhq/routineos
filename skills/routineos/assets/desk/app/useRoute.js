// app/useRoute.js: the hash route (core/router.js). An old address is swapped for its v2 one with replaceState, so
// Back does not loop. replaceParams rewrites the query without adding a history entry.
import { useCallback, useEffect, useRef, useState } from "react";
import { canonicalHash, queryString_, route, toFrameHash } from "../core/router.js";
import { entityIdFromRoute } from "../core/pages/entity.js";
import { clearRoute, loadRoute, saveRoute, validRoute } from "../core/viewerstate.js";

export var ROUTE_EVENT = "desk:route";

function read() {
  var r = route(window.location.hash);
  if (r.redirect) window.history.replaceState(window.history.state, "", addressFor(r.redirect));
  return { hash: window.location.hash, r: r };
}

// In a frame the address is the slash-free form (core/router.js): the host passes only #name through to its own address.
function addressFor(hash) {
  return inFrame() ? toFrameHash(hash) || hash : hash;
}

export function go(hash) {
  var to = addressFor(hash);
  if (window.location.hash !== to) window.location.hash = to;
}

// Replaces the address with this #/ route, in the frame's form there, without adding a history entry, and tells the
// router. For callers that write a whole address (Browse filters, next and previous record).
export function replaceAddress(hash) {
  window.history.replaceState(window.history.state, "", addressFor(hash));
  window.dispatchEvent(new Event(ROUTE_EVENT));
}

// obj: {key: value}; null, undefined or "" removes the key. Other query keys are kept.
export function replaceParams(obj) {
  var h = canonicalHash(window.location.hash) || "#/today";
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
    window.history.replaceState(window.history.state, "", addressFor(next));
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
    // A link written as #/... opens the slash-free address in a frame, so the host's address follows it.
    function onClick(e) {
      if (!inFrame() || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      var href = a && !a.getAttribute("target") ? a.getAttribute("href") : null;
      if (href && href.indexOf("#/") === 0) { e.preventDefault(); go(href); }
    }
    window.addEventListener("click", onClick);
    on();
    return () => {
      window.removeEventListener("click", onClick);
      window.removeEventListener("hashchange", on);
      window.removeEventListener(ROUTE_EVENT, on);
    };
  }, []);
  const goTo = useCallback(go, []);
  const replace = useCallback(replaceParams, []);
  return { page: state.r.page, params: state.r.params, hash: state.hash, go: goTo, replaceParams: replace };
}

// True when the Desk runs inside another page (a published artifact shows it in a frame). A frame's own address is
// not one a person can open, and whether the host shows or follows the frame's hash is not documented.
export function inFrame() {
  try { return window.top !== window.self; } catch (e) { return true; }
}

var SETTLE_MS = 1500;

// A saved record route is kept only while the record exists; a deleted one would open a not-found page.
function stillThere(ctx, hash) {
  var r = route(hash);
  if (r.page !== "entity") return Promise.resolve(true);
  return Promise.resolve().then(() => ctx.store.get("entities/" + entityIdFromRoute(r.params))).then((d) => !!(d && d.exists), () => true);
}

// Remembers where this viewer last was, for a host that does not show the Desk's address (a published artifact shows
// the Desk in a frame; a plain tab does neither saving nor restoring, its address already says). The route is saved
// once it has been still for 1.5 seconds, and only when it differs from what is already saved. On open, with no
// address at all, the saved route is opened in place of Today (a replaceState, so Back does not step through it)
// unless it names a record that is gone. ctx is {store, viewer, canWriteShared} or null while loading. An address in
// the URL always wins.
export function useRestoreRoute(ctx, hash) {
  const ready = !!ctx && inFrame();
  const ref = useRef(ctx);
  ref.current = ctx;
  const saved = useRef(undefined);
  useEffect(() => {
    if (!ready) return undefined;
    var live = true;
    loadRoute(ref.current).then((v) => {
      if (!live) return;
      if (saved.current === undefined) saved.current = v;
      var now = window.location.hash;
      if (!v || (now && now !== "#" && now !== "#/")) return;
      stillThere(ref.current, v).then((ok) => {
        var again = window.location.hash;
        if (!live || !ok || (again && again !== "#" && again !== "#/")) return;
        window.history.replaceState(window.history.state, "", v);
        window.dispatchEvent(new Event(ROUTE_EVENT));
      });
    }, () => {});
    return () => { live = false; };
  }, [ready]);
  useEffect(() => {
    var canon = canonicalHash(hash);
    if (!ready || typeof canon !== "string" || canon.indexOf("#/") !== 0) return undefined;
    var ok = validRoute(canon);
    var t = setTimeout(() => {
      if (ok ? saved.current === canon : saved.current === null) return;
      saved.current = ok ? canon : null;
      (ok ? saveRoute(ref.current, canon) : clearRoute(ref.current)).then(() => {}, () => {});
    }, SETTLE_MS);
    return () => clearTimeout(t);
  }, [ready, hash]);
}
