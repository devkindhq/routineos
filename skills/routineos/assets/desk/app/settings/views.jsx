// app/settings/views.jsx: saved Browse views per type (built in, kept and agent proposed) and agent-proposed columns.
// Keep, Duplicate, Delete (with Undo) and the viewer's own Pin write through core/actions.js; a visit that cannot write
// sees Open and Edit links only.
import { useState } from "react";
import { Anchor, Badge, Button, Group, List, Stack, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { canWrite, idSet, remove, save, stamp, viewerPath, withViewerState } from "../../core/actions.js";
import { UNDO_MS } from "../../core/bulk.js";
import { writeFilterState } from "../../core/pages/browse.js";
import { canEditView, duplicateView, groupViews, pinnedFirst, viewSummary, viewToFilterState } from "../../core/pages/settings.js";
import { producerLabel } from "../../core/shared.js";
import { Section, ReadOnlyReason, WatchState, failToast, useCtx, useWatch } from "./common.jsx";

function browseHref(type, query) {
  return "#/browse/" + encodeURIComponent(type) + (query ? "?" + query : "");
}

function Badges({ ctx, data }) {
  var agent = data.madeBy === "agent" || (data.producer && data.madeBy !== "human");
  return (
    <>
      {agent ? <Badge size="sm" variant="light" color="grape">{"Made by " + producerLabel(ctx.definition, data.producer)}</Badge> : null}
      {data.state === "proposed" ? <Badge size="sm" variant="light" color="yellow">proposed</Badge> : null}
    </>
  );
}

function run(p, done) {
  p.then(() => { if (done) notifications.show({ message: done }); }, failToast);
}

function keep(ctx, path, data) {
  var s = stamp(ctx);
  run(save(ctx.store, ctx.viewer, path, Object.assign({}, data, { state: "kept", updatedAt: s.at, updatedBy: s.by })), "Kept.");
}

// The inline confirm, then the delete, then a toast with Undo for UNDO_MS that writes the doc back.
function DeleteControl({ ctx, name, path, data }) {
  const [asking, setAsking] = useState(false);
  if (!asking) return <Button size="xs" variant="default" color="red" onClick={() => setAsking(true)}>Delete</Button>;
  function go() {
    setAsking(false);
    remove(ctx.store, ctx.viewer, path).then(() => {
      var id = "undo-" + path;
      notifications.show({ id: id, autoClose: UNDO_MS, message: (
        <Group gap="xs">
          <Text size="sm">{"Deleted " + name + "."}</Text>
          <Button size="xs" variant="light" onClick={() => { notifications.hide(id); run(save(ctx.store, ctx.viewer, path, data), "Restored."); }}>Undo</Button>
        </Group>
      ) });
    }, failToast);
  }
  return (
    <Group gap="xs">
      <Text size="sm">{"Delete " + name + " for everyone?"}</Text>
      <Button size="xs" color="red" onClick={go}>Delete</Button>
      <Button size="xs" variant="default" onClick={() => setAsking(false)}>Cancel</Button>
    </Group>
  );
}

function ViewItem({ ctx, group, v, pinned }) {
  var can = canWrite(ctx).ok;
  var t = ctx.definition && ctx.definition.types && ctx.definition.types[group.type];
  var fs = viewToFilterState(v.data);
  var name = String(v.data.name || v.id);
  var byView = browseHref(group.type, "view=" + encodeURIComponent(v.id));
  var actions = [];
  if (v.builtIn) {
    actions.push(<Anchor key="open" size="sm" href={browseHref(group.type, writeFilterState(fs))}>Open</Anchor>);
  } else if (canEditView(v.data, ctx.viewer) && can) {
    if (v.data.state === "proposed") actions.push(<Button key="keep" size="xs" onClick={() => keep(ctx, "views/" + v.id, v.data)}>Keep</Button>);
    actions.push(<Anchor key="edit" size="sm" href={byView}>Edit</Anchor>);
  } else {
    actions.push(<Anchor key="open" size="sm" href={byView}>Open</Anchor>);
  }
  if (can) {
    actions.push(<Button key="dup" size="xs" variant="default" onClick={() => {
      var s = stamp(ctx);
      var id = "v-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      run(save(ctx.store, ctx.viewer, "views/" + id, duplicateView(v.data, s.by, s.at)), "Duplicated.");
    }}>Duplicate</Button>);
    if (!v.builtIn && canEditView(v.data, ctx.viewer)) actions.push(<DeleteControl key="del" ctx={ctx} name={name} path={"views/" + v.id} data={v.data} />);
    var pinPath = viewerPath(ctx.viewer, "pin", v.id);
    actions.push(<Button key="pin" size="xs" variant="default" onClick={() => run(pinned
      ? remove(ctx.store, ctx.viewer, pinPath) : save(ctx.store, ctx.viewer, pinPath, stamp(ctx)))}>{pinned ? "Unpin" : "Pin"}</Button>);
  }
  return (
    <List.Item data-view={v.id}>
      <Stack gap={4}>
        <Group gap="xs">
          <Text fw={500}>{name}</Text>
          {pinned ? <Badge size="sm" variant="light">pinned</Badge> : null}
          {v.builtIn ? <Badge size="sm" variant="light" color="gray">built in</Badge> : <Badges ctx={ctx} data={v.data} />}
        </Group>
        <Text size="sm" c="dimmed">{viewSummary(fs, t)}</Text>
        <Group gap="xs">{actions}</Group>
      </Stack>
    </List.Item>
  );
}

function ColumnItem({ ctx, c }) {
  var can = canWrite(ctx).ok;
  var t = ctx.definition && ctx.definition.types && ctx.definition.types[c.data.type];
  var name = String(c.data.name || c.id);
  return (
    <List.Item data-column={c.id}>
      <Stack gap={4}>
        <Group gap="xs">
          <Text fw={500}>{name + " on " + String(t ? t.plural || t.label : c.data.type || "")}</Text>
          <Badges ctx={ctx} data={c.data} />
        </Group>
        <Text size="sm" c="dimmed">{c.data.state === "proposed" ? "Proposed: shown in Browse once kept." : "Shown in Browse. Deleting hides its values; the next run drops them."}</Text>
        {can ? (
          <Group gap="xs">
            {c.data.state === "proposed" ? <Button size="xs" onClick={() => keep(ctx, "columns/" + c.id, c.data)}>Keep</Button> : null}
            <DeleteControl ctx={ctx} name={name} path={"columns/" + c.id} data={c.data} />
          </Group>
        ) : null}
      </Stack>
    </List.Item>
  );
}

export default function Views() {
  const ctx = useCtx();
  const w = useWatch(withViewerState(ctx, { views: { collection: "views" }, columns: { collection: "columns" } }, ["pin"]), [ctx.viewer]);
  var wait = WatchState({ w: w, label: "views" });
  var groups = wait ? [] : groupViews(w.got.views, ctx.definition);
  var pins = wait ? new Set() : idSet(w.got.pin) || new Set();
  var cols = wait ? [] : w.got.columns || [];
  return (
    <Section id="views" title="Saved views" note="Saved Browse filters. Save a new one from any Browse list. Agent-made views stay labelled after you keep them.">
      <ReadOnlyReason ctx={ctx} />
      {wait || (
        <Stack gap="md">
          {groups.length ? groups.map((g) => (
            <Stack key={g.type} gap="xs">
              <Title order={3} size="h4">{String(g.label) + " (" + g.views.length + ")"}</Title>
              <List listStyleType="none" spacing="sm">
                {pinnedFirst(g.views, pins).map((v) => <ViewItem key={v.id} ctx={ctx} group={g} v={v} pinned={pins.has(v.id)} />)}
              </List>
            </Stack>
          )) : <Text c="dimmed">No saved views yet.</Text>}
          {cols.length ? (
            <Stack gap="xs">
              <Title order={3} size="h4">{"Columns (" + cols.length + ")"}</Title>
              <List listStyleType="none" spacing="sm">{cols.map((c) => <ColumnItem key={c.id} ctx={ctx} c={c} />)}</List>
            </Stack>
          ) : null}
        </Stack>
      )}
    </Section>
  );
}
