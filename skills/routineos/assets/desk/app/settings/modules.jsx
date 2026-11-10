// app/settings/modules.jsx: the merge policy per record type and which view modules the sidebar shows, both on
// settings/workspace. Last write wins; without write access the values show read only.
import { useState } from "react";
import { Badge, Button, Group, List, Select, Stack, Switch, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { byId, canWrite, writeSettings } from "../../core/actions.js";
import { NAV_HEAD, NAV_TAIL } from "../../core/palette.js";
import { SETTINGS_LWW, WORKSPACE_SETTINGS, nextHidden, sidebarRows } from "../../core/pages/settings.js";
import { NEXT_RUN_NOTE } from "../../core/requests.js";
import { ReadOnlyReason, Section, WatchState, failToast, partialToast, useCtx, useWatch } from "./common.jsx";

var MERGE_CHOICES = [{ value: "merge", label: "Merge into one record" }, { value: "separate", label: "Keep separate per producer" }];

function policyOf(types, stored) {
  var out = {};
  Object.keys(types).forEach((k) => { out[k] = (stored || {})[k] || (types[k].merge === "separate" ? "separate" : "merge"); });
  return out;
}

// One save path for both forms: write, then keep the draft or roll it back.
function useSaver(ctx, done) {
  const [busy, setBusy] = useState(false);
  function run(changes, ok, back) {
    setBusy(true);
    writeSettings(ctx, WORKSPACE_SETTINGS, changes).then(() => {
      setBusy(false);
      ok();
      notifications.show({ message: done });
    }, (e) => {
      setBusy(false);
      if (e && e.partial) { ok(); partialToast(e); return; }
      failToast(e);
      back();
    });
  }
  return [busy, run];
}

function MergeForm({ ctx, stored }) {
  var types = (ctx.definition && ctx.definition.types) || {};
  const [base, setBase] = useState(() => policyOf(types, stored));
  const [draft, setDraft] = useState(base);
  const [busy, run] = useSaver(ctx, NEXT_RUN_NOTE);
  var can = canWrite(ctx).ok;
  var keys = Object.keys(types).sort();
  if (!keys.length) return <Text size="sm" c="dimmed">This routine has no record types.</Text>;
  return (
    <Stack gap="sm">
      {keys.map((k) => (
        <Select key={k} label={String(types[k].plural || types[k].label || k)} data={MERGE_CHOICES} value={draft[k]}
          allowDeselect={false} disabled={!can || busy} onChange={(v) => setDraft(Object.assign({}, draft, { [k]: v }))} />
      ))}
      {can ? <Group><Button loading={busy} onClick={() => run({ mergePolicy: draft }, () => setBase(draft), () => setDraft(base))}>Save merge policy</Button></Group> : null}
    </Stack>
  );
}

function SidebarForm({ ctx, stored }) {
  var startHidden = Array.isArray(stored) ? stored.slice() : [];
  const [base, setBase] = useState(startHidden);
  const [hidden, setHidden] = useState(startHidden);
  const [busy, run] = useSaver(ctx, "Saved. The sidebar shows the change for everyone.");
  var can = canWrite(ctx).ok;
  var rows = sidebarRows(ctx.definition, hidden);
  var ids = rows.map((r) => r.id);
  var types = (ctx.definition && ctx.definition.types) || {};
  if (!rows.length) return <Text size="sm" c="dimmed">This Desk has no view modules to show or hide.</Text>;
  return (
    <Stack gap="sm">
      {rows.map((r) => (
        <Switch key={r.id} data-module={r.id} checked={r.shown} disabled={!can || busy}
          label={r.label + " (" + String((types[r.type] && (types[r.type].plural || types[r.type].label)) || r.type) + ")"}
          onChange={(e) => setHidden(nextHidden(hidden, r.id, e.currentTarget.checked, ids))} />
      ))}
      {can ? <Group><Button loading={busy} onClick={() => run({ nav: { hidden: hidden } }, () => setBase(hidden), () => setHidden(base))}>Save sidebar</Button></Group> : null}
    </Stack>
  );
}

export default function Modules() {
  const ctx = useCtx();
  const w = useWatch({ settings: { collection: "settings" } });
  var wait = WatchState({ w: w, label: "settings" });
  var values = wait ? {} : ((byId(w.got.settings).workspace || {}).values || {});
  return (
    <Section id="modules" title="Modules" note={SETTINGS_LWW}>
      <ReadOnlyReason ctx={ctx} />
      {wait || (
        <Stack gap="lg">
          <Stack gap="xs">
            <Title order={3} size="h4">Merge policy</Title>
            <Text size="sm" c="dimmed">When two producers find the same record, merge them into one or keep one per producer.</Text>
            <MergeForm ctx={ctx} stored={values.mergePolicy} />
          </Stack>
          <Stack gap="xs">
            <Title order={3} size="h4">Sidebar</Title>
            <Text size="sm" c="dimmed">The built-in pages are always in the sidebar. Show or hide each view module in everyone's sidebar.</Text>
            <List aria-label="Core pages" listStyleType="none" spacing={4}>
              {NAV_HEAD.concat(NAV_TAIL).map((n) => (
                <List.Item key={n[0]}><Group gap="xs"><Text size="sm">{n[1]}</Text><Badge size="sm" variant="light" color="gray">Core</Badge></Group></List.Item>
              ))}
            </List>
            <SidebarForm ctx={ctx} stored={values.nav && values.nav.hidden} />
          </Stack>
        </Stack>
      )}
    </Section>
  );
}
