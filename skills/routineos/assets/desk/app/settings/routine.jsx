// app/settings/routine.jsx: one form per producer from its settings schema. A value outside checkSetting is shown as an
// error and not written. A save re-reads settings/<producer> and replaces only the changed keys (last write wins), then
// records a settingsHistory entry; a recent change can be reverted. Without write access the values show read only.
import { useState } from "react";
import { Anchor, Badge, Button, Group, NumberInput, Select, Stack, Switch, TagsInput, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { byId, canWrite, revertChange, writeSettings } from "../../core/actions.js";
import { human } from "../../core/dates.js";
import {
  HISTORY_SHOWN, SETTINGS_LWW, changedValues, checkSetting, controlSpec, historyLine, listAdd, scheduleText, settingSuggestions,
} from "../../core/pages/settings.js";
import { NEXT_RUN_NOTE } from "../../core/requests.js";
import { ReadOnlyReason, Section, WatchState, failToast, partialToast, useCtx, useWatch } from "./common.jsx";

function valuesOf(schema, stored) {
  var out = {};
  schema.forEach((e) => { out[e.name] = controlSpec(e, stored[e.name]).value; });
  return out;
}

function Field({ entry, value, error, disabled, onChange }) {
  var spec = controlSpec(entry, value);
  var { example } = spec;
  var desc = [example ? "For example " + example + "." : "", spec.costNote].filter(Boolean).join(" ") || undefined;
  var common = { label: spec.label, description: desc, error: error || undefined, disabled: disabled, "data-setting": spec.name };
  if (spec.kind === "toggle") {
    return <Switch {...common} checked={!!value} onChange={(e) => onChange(e.currentTarget.checked)} />;
  }
  if (spec.kind === "number") {
    return <NumberInput {...common} value={value === undefined || value === null ? "" : value} clampBehavior="none"
      min={spec.min === null ? undefined : spec.min} max={spec.max === null ? undefined : spec.max}
      onChange={(v) => onChange(v === "" ? "" : Number(v))} />;
  }
  if (spec.kind === "choice") {
    return <Select {...common} data={spec.choices.map(String)} value={value === undefined || value === null ? null : String(value)}
      onChange={(v) => onChange(spec.choices.filter((c) => String(c) === v)[0])} allowDeselect={false} />;
  }
  if (spec.kind === "list") {
    return <TagsInput {...common} value={(value || []).map(String)}
      onChange={(vals) => onChange(vals.reduce((acc, v) => listAdd(acc, v), []))} />;
  }
  return <TextInput {...common} value={value === undefined || value === null ? "" : String(value)} onChange={(e) => onChange(e.currentTarget.value)} />;
}

// The form keeps its own draft from the first answer, so a live update never overwrites what a person is typing.
function ProducerForm({ ctx, producer, stored }) {
  var schema = Array.isArray(producer.settings) ? producer.settings : [];
  const [base, setBase] = useState(() => valuesOf(schema, stored));
  const [draft, setDraft] = useState(base);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  var can = canWrite(ctx).ok;
  if (!schema.length) return <Text size="sm" c="dimmed">This producer has no settings.</Text>;

  function save() {
    var errs = {};
    schema.forEach((e) => { var m = checkSetting(e, draft[e.name]); if (m) errs[e.name] = m; });
    setErrors(errs);
    if (Object.keys(errs).length) return;
    var changes = changedValues(base, draft);
    if (!Object.keys(changes).length) {
      notifications.show({ message: "Nothing changed." });
      return;
    }
    setBusy(true);
    writeSettings(ctx, "settings/" + producer.id, changes).then(() => {
      setBusy(false);
      setBase(draft);
      notifications.show({ message: NEXT_RUN_NOTE });
    }, (e) => {
      setBusy(false);
      if (e && e.partial) { setBase(draft); partialToast(e); return; }
      failToast(e);
      setDraft(base);
    });
  }

  return (
    <Stack gap="sm">
      {schema.map((e) => (
        <Field key={e.name} entry={e} value={draft[e.name]} error={errors[e.name]} disabled={!can || busy}
          onChange={(v) => setDraft(Object.assign({}, draft, { [e.name]: v }))} />
      ))}
      {can ? <Group><Button onClick={save} loading={busy}>Save</Button></Group> : null}
    </Stack>
  );
}

function Recent({ ctx, producer, entries }) {
  var can = canWrite(ctx).ok;
  if (!entries.length) return null;
  function revert(entry) {
    writeSettings(ctx, "settings/" + producer.id, revertChange(entry.data)).then(
      () => notifications.show({ message: "Reverted. " + NEXT_RUN_NOTE }),
      (e) => (e && e.partial ? partialToast(e) : failToast(e)));
  }
  return (
    <Stack gap={4}>
      <Text size="sm" fw={600}>{"Recent changes (" + entries.length + ")"}</Text>
      {entries.map((h) => (
        <Group key={h.id} gap="xs" wrap="nowrap" justify="space-between">
          <Text size="sm">{historyLine(h.data) + (h.data.at ? " (" + human(h.data.at, Date.now(), { style: "sentence" }) + ")" : "")}</Text>
          {can ? <Button size="xs" variant="default" onClick={() => revert(h)}>Revert</Button> : null}
        </Group>
      ))}
    </Stack>
  );
}

export default function Routine() {
  const ctx = useCtx();
  const w = useWatch({ settings: { collection: "settings" }, history: { collection: "settingsHistory" },
    inbox: { collection: "inbox" }, decisions: { collection: "decisions" } });
  var producers = (ctx.definition && ctx.definition.producers) || [];
  var wait = WatchState({ w: w, label: "settings" });
  return (
    <Section id="routine" title="Routine" note={SETTINGS_LWW}>
      <ReadOnlyReason ctx={ctx} />
      {wait || (producers.length ? producers.map((p) => {
        var doc = byId(w.got.settings)[p.id] || {};
        var mine = w.got.history.filter((h) => h.data.producer === p.id)
          .sort((a, b) => ((a.data.at || "") < (b.data.at || "") ? 1 : -1)).slice(0, HISTORY_SHOWN);
        var decisions = byId(w.got.decisions);
        var open = (Array.isArray(p.settings) ? p.settings : []).reduce((n, e) =>
          n + settingSuggestions(w.got.inbox, p.id, e.name, decisions, Date.now()).length, 0);
        return (
          <Stack key={p.id} gap="sm" component="section" data-producer={p.id}>
            <Group gap="xs"><Title order={3} size="h4">{p.label || p.id}</Title>
              {open ? <Badge variant="light" color="yellow">{open + " suggested"}</Badge> : null}</Group>
            <Text size="sm" c="dimmed">{"Schedule: " + scheduleText(p.schedule) + ". Edit the schedule on the routines page."}</Text>
            {open ? <Anchor size="sm" href="#/approvals?kind=proposals">Review the suggested changes in Approvals</Anchor> : null}
            <ProducerForm ctx={ctx} producer={p} stored={doc.values || {}} />
            <Text size="sm" c="dimmed">{doc.updatedAt ? "Last saved " + human(doc.updatedAt, Date.now(), { style: "sentence" }) + "." : "Not saved yet. The defaults apply."}</Text>
            <Recent ctx={ctx} producer={p} entries={mine} />
          </Stack>
        );
      }) : <Text c="dimmed">This routine has no producers.</Text>)}
    </Section>
  );
}
