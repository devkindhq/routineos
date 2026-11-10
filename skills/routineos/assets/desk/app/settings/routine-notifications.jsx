// app/settings/routine-notifications.jsx: how the routine reaches people (inbox only, or inbox plus push) and the quiet
// hours, stored on settings/workspace. Last write wins; without write access the values show read only.
import { useState } from "react";
import { Button, Group, Select, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { byId, canWrite, writeSettings } from "../../core/actions.js";
import { NOTIFY_CHOICES, SETTINGS_LWW, WORKSPACE_SETTINGS, changedValues } from "../../core/pages/settings.js";
import { NEXT_RUN_NOTE } from "../../core/requests.js";
import { ReadOnlyReason, Section, WatchState, failToast, partialToast, useCtx, useWatch } from "./common.jsx";

function valuesOf(stored) {
  var q = stored.quietHours || {};
  return { notifications: stored.notifications === "push" ? "push" : "inbox", quietHours: { from: q.from || "", to: q.to || "" } };
}

function Form({ ctx, stored }) {
  const [base, setBase] = useState(() => valuesOf(stored));
  const [draft, setDraft] = useState(base);
  const [busy, setBusy] = useState(false);
  var can = canWrite(ctx).ok;
  function quiet(k, v) { setDraft(Object.assign({}, draft, { quietHours: Object.assign({}, draft.quietHours, { [k]: v }) })); }
  function save() {
    var changes = changedValues(base, draft);
    if (!Object.keys(changes).length) { notifications.show({ message: "Nothing changed." }); return; }
    setBusy(true);
    writeSettings(ctx, WORKSPACE_SETTINGS, changes).then(() => {
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
      <Select label="Notify me" data={NOTIFY_CHOICES.map(([value, label]) => ({ value: value, label: label }))}
        value={draft.notifications} allowDeselect={false} disabled={!can || busy}
        onChange={(v) => setDraft(Object.assign({}, draft, { notifications: v }))} />
      <Group grow>
        <TextInput type="time" label="Quiet hours from" value={draft.quietHours.from} disabled={!can || busy}
          onChange={(e) => quiet("from", e.currentTarget.value)} />
        <TextInput type="time" label="Quiet hours to" value={draft.quietHours.to} disabled={!can || busy}
          onChange={(e) => quiet("to", e.currentTarget.value)} />
      </Group>
      <Text size="sm" c="dimmed">No push between these times. Stored. No producer acts on this yet.</Text>
      {can ? <Group><Button onClick={save} loading={busy}>Save notifications</Button></Group> : null}
    </Stack>
  );
}

export default function RoutineNotifications() {
  const ctx = useCtx();
  const w = useWatch({ settings: { collection: "settings" } });
  var wait = WatchState({ w: w, label: "settings" });
  var ws = wait ? null : byId(w.got.settings).workspace || {};
  return (
    <Section id="routine-notifications" title="Routine notifications" note={SETTINGS_LWW}>
      <ReadOnlyReason ctx={ctx} />
      {wait || <Form ctx={ctx} stored={ws.values || {}} />}
    </Section>
  );
}
