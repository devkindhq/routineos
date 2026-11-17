// app/RawPageHost.jsx: one approved raw React page (spec 5.4, 5.5). The page's thunk in window.DESK_PAGES is called once
// per id with DESK_LIB and returns the component, which renders in place under the Desk's providers, so the theme,
// notifications and dates apply. A missing or throwing thunk draws the host's fallback; an error in the page's render
// draws a stop note with Try again. Each failure is one red notification; the details go to the browser console.
import { useEffect, useMemo, useState } from "react";
import { Button, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { declaredExtension, extCtx } from "../core/ext.js";
import { DESK_LIB } from "./deskLib.js";
import Boundary from "./pages/spec/Boundary.jsx";
import { SpecBlock } from "./pages/spec/blocks.jsx";
import { usePageCtx } from "./StoreContext.jsx";
import { go } from "./useRoute.js";

// ui.navigate goes to a Desk address (#/...); ui.block draws a spec block from a spec and records, as ui.block does for a
// factory component.
var UI = Object.freeze({
  navigate: function (hash) { if (typeof hash === "string" && hash.charAt(0) === "#") go(hash); },
  block: SpecBlock,
});

function isComponent(c) {
  return typeof c === "function" || (!!c && typeof c === "object" && typeof c.$$typeof === "symbol");
}

function loadPage(id) {
  var pages = typeof window !== "undefined" ? window.DESK_PAGES : null;
  var thunk = pages && Object.prototype.hasOwnProperty.call(pages, id) ? pages[id] : null;
  if (typeof thunk !== "function") return { error: new Error("Raw page " + id + " is not in this Desk.") };
  try {
    var Page = thunk(DESK_LIB);
    return isComponent(Page) ? { Page: Page } : { error: new Error("Raw page " + id + " did not return a component.") };
  } catch (e) {
    return { error: e };
  }
}

// React logs an error caught in render itself; a load failure is logged here.
function notify(title) {
  notifications.show({ color: "red", title: title, message: "Details are in the browser console." });
}

// Which record or route the page shows, so moving to another one resets a stopped boundary.
function identity(props) {
  if (!props) return "";
  try {
    if (props.record !== undefined || props.type !== undefined) return "r:" + props.type + "/" + props.id;
    if (props.args) return "p:" + props.args.join("/") + "?" + JSON.stringify(props.params || {});
    if (props.view) return "v:" + JSON.stringify(props.view);
  } catch (e) { /* fall through */ }
  return "";
}

export default function RawPageHost({ id, props, fallback }) {
  var base = usePageCtx();
  var loaded = useMemo(() => loadPage(id), [id]);
  var [tries, setTries] = useState(0);
  // The ctx extCtx builds for this page; every watch it starts is disposed when the page leaves or the store changes.
  var held = useMemo(() => {
    var stops = [];
    var gone = false;
    var entry = declaredExtension(id);
    var types = entry && entry.types ? entry.types : entry && entry.view ? [entry.view.type] : null;
    var ctx = extCtx(base, (stop) => { if (gone) stop(); else stops.push(stop); }, entry ? entry.verbs : [], { types },
      { id: id, prefs: !!(entry && entry.prefs), slot: entry && entry.slot, raw: true });
    return { ctx: ctx, end: () => { gone = true; stops.splice(0).forEach((stop) => stop()); } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, base.store, base.viewer]);
  useEffect(() => held.end, [held]);
  useEffect(() => {
    if (!loaded.error) return;
    console.error("Raw page " + id + ":", loaded.error);
    notify("This page could not load");
  }, [id, loaded]);

  if (loaded.error) return fallback === undefined || fallback === null ? <Text>This page could not load.</Text> : fallback;
  var Page = loaded.Page;
  var stopped = (
    <Stack gap="xs" align="flex-start">
      <Text>This page stopped. Details are in the browser console.</Text>
      <Button variant="default" onClick={() => setTries((n) => n + 1)}>Try again</Button>
    </Stack>
  );
  return (
    <div data-ext={id} data-raw="">
      <Boundary resetKey={id + ":" + identity(props) + ":" + tries} fallback={stopped} onError={() => notify("This page stopped")}>
        <Page ctx={held.ctx} ui={UI} props={props} />
      </Boundary>
    </div>
  );
}
