// app/settings/history.jsx: who changed which settings, newest first (settingsHistory/).
import { useEffect, useState } from "react";
import { Text, Timeline } from "@mantine/core";
import { human } from "../../core/dates.js";
import { historyLine } from "../../core/pages/settings.js";
import { personName_, producerLabel } from "../../core/shared.js";
import { useStore } from "../StoreContext.jsx";
import { Section, WatchState, useCtx, useWatch } from "./common.jsx";

export default function SettingsHistory() {
  const ctx = useCtx();
  const store = useStore();
  const w = useWatch({ history: { collection: "settingsHistory" } });
  const [profiles, setProfiles] = useState({});
  var wait = WatchState({ w: w, label: "settings history" });
  var rows = wait ? [] : w.got.history.slice().sort((a, b) => ((a.data.at || "") < (b.data.at || "") ? 1 : -1));
  var ids = rows.map((r) => r.data.by).filter((v, i, a) => v && a.indexOf(v) === i).join("|");
  useEffect(() => {
    var live = true;
    if (!ids || typeof store.profiles !== "function") return undefined;
    store.profiles(ids.split("|")).then((p) => { if (live) setProfiles(p || {}); }, () => {});
    return () => { live = false; };
  }, [store, ids]);
  function what(p) { return p === "workspace" ? "workspace settings" : producerLabel(ctx.definition, p) + " settings"; }
  return (
    <Section id="history" title="Settings history" note="Each save from this page, newest first.">
      {wait || (rows.length ? (
        <Timeline bulletSize={12} lineWidth={2}>
          {rows.map((h) => (
            <Timeline.Item key={h.id} title={(h.data.by ? personName_(profiles, h.data.by, ctx.viewer) : "Someone") + " changed " + what(h.data.producer)}>
              <Text size="sm">{historyLine(h.data)}</Text>
              {h.data.at ? <Text size="xs" c="dimmed">{human(h.data.at, Date.now(), { style: "sentence" })}</Text> : null}
            </Timeline.Item>
          ))}
        </Timeline>
      ) : <Text c="dimmed">No settings have changed yet.</Text>)}
    </Section>
  );
}
