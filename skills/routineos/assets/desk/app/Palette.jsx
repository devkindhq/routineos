// app/Palette.jsx: the command palette (Mantine Spotlight). Every page, type and view as Go to, records that match
// the query (searched once the palette first opens), and Search all records for the query.
import { useMemo, useState } from "react";
import { useMantineColorScheme } from "@mantine/core";
import { Spotlight } from "@mantine/spotlight";
import { IconSearch } from "@tabler/icons-react";
import { RESULTS_CAPPED, SEARCH_UNAVAILABLE, matchCommands, navTypes_, nextTheme, paletteActions, paletteCommands, search, searchAllCommand } from "../core/palette.js";
import { fullRead } from "../core/paging.js";
import { entityHash, recordTitle } from "../core/shared.js";
import { useStore } from "./StoreContext.jsx";
import { usePrefs } from "./usePrefs.js";
import { useTour } from "./Tour.jsx";

// onOpenChange(open): the shell turns page keys off while the palette is open.
// extra: the open page's own commands [{id, label, run}] (Browse: save, update, rename a view), listed as Actions.
export default function Palette({ nav, definition, go, extra, onOpenChange }) {
  const store = useStore();
  const prefs = usePrefs();
  const tour = useTour();
  const { setColorScheme } = useMantineColorScheme();
  const [query, setQuery] = useState("");
  const [entities, setEntities] = useState(null);
  const [readFailed, setReadFailed] = useState(false);
  function onOpen() {
    if (onOpenChange) onOpenChange(true);
    if (entities !== null || !definition || !store) return;
    setEntities([]);
    fullRead(store, "entities", {}).then(setEntities, () => { setEntities([]); setReadFailed(true); });
  }
  function switchTheme() {
    var t = nextTheme(prefs.theme);
    prefs.set("theme", t);
    setColorScheme(t === "system" ? "auto" : t);
  }
  const actions = useMemo(() => {
    var types = (definition && definition.types) || {};
    var goTo = matchCommands(paletteCommands(nav, []), query).map((c) => ({
      id: c.id, label: c.label, onClick: () => go(c.href),
    }));
    var found = search(query, entities || [], 20);
    var records = found.hits.map((r) => {
      var t = types[String(r.id).split("--")[0]];
      return { id: "record:" + r.id, label: recordTitle(t || { fields: {} }, r.data), description: (t && t.label) || "",
        onClick: () => go(entityHash(r.id)) };
    });
    if (readFailed && query.trim()) records.push({ id: "records-unavailable", label: SEARCH_UNAVAILABLE, disabled: true });
    // The read itself stops at its limit (entities.capped), so a record in the unread tail never matches; say so.
    if ((found.capped || (entities && entities.capped)) && query.trim()) records.push({ id: "records-capped", label: RESULTS_CAPPED, disabled: true });
    var first = navTypes_(definition)[0];
    var all = searchAllCommand(query, first && first.id);
    var groups = [{ group: "Go to", actions: goTo }, { group: "Records", actions: records }];
    var own = paletteActions({ tour: tour.available }).map((c) => Object.assign(c, { run: c.id === "tour" ? tour.start : switchTheme }));
    var acts = matchCommands(own.concat(extra || []), query).map((c) => ({ id: c.id, label: c.label, onClick: c.run }));
    if (all) acts.push({ id: all.id, label: all.label, onClick: () => go(all.href) });
    groups.push({ group: "Actions", actions: acts });
    return groups.filter((g) => g.actions.length);
  }, [nav, definition, entities, readFailed, query, go, extra, tour.available, tour.start, prefs.theme]);
  return (
    <Spotlight
      actions={actions}
      query={query}
      onQueryChange={setQuery}
      filter={(q, list) => list}
      shortcut={null}
      onSpotlightOpen={onOpen}
      onSpotlightClose={() => { if (onOpenChange) onOpenChange(false); }}
      nothingFound="Nothing matches"
      scrollable
      maxHeight={420}
      searchProps={{ placeholder: "Search or jump to", leftSection: <IconSearch size={18} stroke={1.5} /> }}
    />
  );
}
