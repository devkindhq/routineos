// app/ExtHost.jsx: one agent-written record section, panel or page (core/ext.js, componentUi.js). The component's
// element is moved in with replaceChildren; no markup string is ever parsed. The tree is checked once on return and
// again after every later change, and a failure draws the fallback. Every ctx.watch the component made is disposed
// when the element leaves the page.
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { notifications } from "@mantine/notifications";
import { declaredExtension, extCtx, snapshotExtensions } from "../core/ext.js";
import { extTreeOk, renderExtension } from "./componentUi.js";
import { SpecBlock } from "./pages/spec/blocks.jsx";
import { usePageCtx } from "./StoreContext.jsx";

// Taken when the Desk loads, after every component script has registered and before any component code runs.
snapshotExtensions(typeof window !== "undefined" ? window.DESK_EXTENSIONS : null);

export default function ExtHost({ id, props, fallback }) {
  const ref = useRef(null);
  const [failed, setFailed] = useState(false);
  const [blocks, setBlocks] = useState([]);
  var ctx = usePageCtx();
  var vals = Object.keys(props || {}).sort().map((k) => props[k]);
  useLayoutEffect(() => {
    var node = ref.current;
    if (!node) return undefined;
    var stops = [];
    var watcher = null;
    var gone = false;
    function bad() {
      gone = true;
      stops.splice(0).forEach((stop) => stop());
      if (watcher) watcher.disconnect();
      node.replaceChildren();
      setFailed(true);
    }
    setBlocks([]);
    var entry = declaredExtension(id);
    var verbs = entry ? entry.verbs : [];
    var types = entry && entry.types ? entry.types : entry && entry.view ? [entry.view.type] : null;
    var out = renderExtension(id, props, extCtx(ctx, (stop) => { if (gone) stop(); else stops.push(stop); }, verbs, { types }, { id: id, prefs: !!(entry && entry.prefs), slot: entry && entry.slot }),
      (e) => notifications.show({ color: "red", title: "Not saved", message: (e && e.message) || "The change was refused" }),
      (b) => { if (!gone) setBlocks((prev) => prev.concat(b)); });
    if (out) {
      node.replaceChildren(out);
      setFailed(false);
      if (typeof MutationObserver !== "undefined") {
        watcher = new MutationObserver(() => { if (!extTreeOk(out)) bad(); });
        watcher.observe(out, { subtree: true, childList: true, attributes: true });
      }
    } else {
      bad();
    }
    return () => {
      gone = true;
      if (watcher) watcher.disconnect();
      stops.splice(0).forEach((stop) => stop());
      node.replaceChildren();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, ctx.store, ctx.viewer].concat(vals));
  return (
    <>
      <div ref={ref} hidden={failed} data-ext={id} />
      {failed ? fallback : null}
      {blocks.map((b, i) => createPortal(<SpecBlock spec={b.spec} records={b.records} />, b.body, i))}
    </>
  );
}
