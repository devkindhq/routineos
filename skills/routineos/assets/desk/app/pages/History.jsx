// app/pages/History.jsx: one History page (spec 5.8). ?mode=cal shows runs by UTC day as a plain table; the default
// timeline lists runs and people's writes, filtered by kind and person. Export CSV saves the shown items through
// store.saveFile and shows only when this view can save.
import { useEffect, useState } from "react";
import { Anchor, Badge, Button, Chip, Group, SegmentedControl, Stack, Table, Text, Timeline, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { watchAll } from "../../core/actions.js";
import { DAY_GROUPS, dayGroup, human } from "../../core/dates.js";
import { downloadToast, historyCsv } from "../../core/exporter.js";
import {
  ACTIVITY_KINDS, HISTORY_LIST_MAX, HISTORY_MODES, WEEKDAYS, calendarWeeks, filterActivity, historyEvents, historyMode, personLabel, runsByDay,
} from "../../core/pages/history.js";
import { runStatusTone, runsNewest } from "../../core/pages/runs.js";
import { producerLabel, recordTitle } from "../../core/shared.js";
import { StateView } from "../States.jsx";
import { useCanDownload, useModel, usePageCtx, useStore } from "../StoreContext.jsx";

var TONE_COLOR = { danger: "red", warning: "yellow", success: "teal" };
var CAL_RUNS_MAX = 4;

function Calendar({ runs, definition }) {
  var days = runsByDay(runs);
  var weeks = calendarWeeks(Date.now(), 5);
  return (
    <Stack gap="xs">
      <Text size="sm" c="dimmed">Days are UTC, like the schedules.</Text>
      <Table.ScrollContainer minWidth={560}>
        <Table withTableBorder withColumnBorders aria-label="Runs by UTC day" layout="fixed">
          <Table.Thead>
            <Table.Tr>{WEEKDAYS.map((w) => <Table.Th key={w} scope="col">{w}</Table.Th>)}</Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {weeks.map((week) => (
              <Table.Tr key={week[0]}>
                {week.map((date) => {
                  var mine = days[date] || [];
                  return (
                    <Table.Td key={date} data-date={date} valign="top">
                      <Text size="xs" c="dimmed">{date.slice(8, 10)}</Text>
                      <Stack gap={2}>
                        {mine.slice(0, CAL_RUNS_MAX).map((r) => (
                          <Anchor key={r.id} href={"#/runs/" + encodeURIComponent(r.id)} title={producerLabel(definition, r.data.producer)}>
                            <Badge size="xs" variant="light" color={TONE_COLOR[runStatusTone(r.data.status)]}>{r.data.status || "unknown"}</Badge>
                          </Anchor>
                        ))}
                        {mine.length > CAL_RUNS_MAX ? <Text size="xs" c="dimmed">{"+" + (mine.length - CAL_RUNS_MAX) + " more"}</Text> : null}
                      </Stack>
                    </Table.Td>
                  );
                })}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}

function TimelineView({ got, ctx }) {
  const store = ctx.store;
  const can = useCanDownload();
  const [f, setF] = useState({ by: "", kind: "" });
  const [names, setNames] = useState({});
  const [profiles, setProfiles] = useState({});
  const [saveHidden, setSaveHidden] = useState(false);
  const [saving, setSaving] = useState(false);
  var items = historyEvents(Object.assign({ definition: ctx.definition, names: names }, got));
  var ids = items.map((i) => i.by).filter((v, i, a) => v && a.indexOf(v) === i);
  var ents = items.map((i) => i.entity).filter((v, n, a) => v && a.indexOf(v) === n).slice(0, HISTORY_LIST_MAX);
  var entKey = ents.join("|"), idKey = ids.join("|");

  useEffect(() => {
    var live = true;
    if (!ents.length) return undefined;
    var out = {};
    Promise.all(ents.map((id) => store.get("entities/" + id).then((d) => {
      if (!d.exists) return;
      var type = d.data.type || id.slice(0, id.indexOf("--"));
      out[id] = recordTitle((ctx.definition.types && ctx.definition.types[type]) || {}, d.data);
    }, () => {}))).then(() => { if (live && Object.keys(out).length) setNames(out); });
    return () => { live = false; };
  }, [store, entKey]);

  useEffect(() => {
    var live = true;
    if (!ids.length || typeof store.profiles !== "function") return undefined;
    store.profiles(ids).then((p) => { if (live) setProfiles(p || {}); }, () => {});
    return () => { live = false; };
  }, [store, idKey]);

  var shown = filterActivity(items, f).slice(0, HISTORY_LIST_MAX);
  var now = Date.now();
  var people = ids.map((id) => [id, personLabel(ctx, profiles, id)]).filter((x) => x[1] !== "Someone");

  function exportCsv() {
    setSaving(true);
    Promise.resolve().then(() => store.saveFile("history.csv", historyCsv(shown))).then(() => {
      setSaving(false);
      notifications.show({ message: "Saved history.csv." });
    }, (err) => {
      var t = downloadToast(err);
      setSaving(false);
      if (t.hide) setSaveHidden(true);
      notifications.show({ color: t.tone === "quiet" ? "gray" : t.tone === "fail" ? "red" : "yellow", message: t.text });
    });
  }

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="flex-start">
        <Stack gap="xs">
          <Chip.Group value={f.kind || "any"} onChange={(v) => setF({ by: f.by, kind: v === "any" ? "" : v })}>
            <Group gap="xs" aria-label="Kind">
              {[["any", "Any kind"]].concat(ACTIVITY_KINDS).map((k) => <Chip key={k[0]} value={k[0]} size="xs">{k[1]}</Chip>)}
            </Group>
          </Chip.Group>
          {people.length ? (
            <Chip.Group value={f.by || "any"} onChange={(v) => setF({ by: v === "any" ? "" : v, kind: f.kind })}>
              <Group gap="xs" aria-label="Person">
                {[["any", "Anyone"]].concat(people).map((k) => <Chip key={k[0]} value={k[0]} size="xs">{k[1]}</Chip>)}
              </Group>
            </Chip.Group>
          ) : null}
        </Stack>
        {can === true && !saveHidden ? <Button variant="default" loading={saving} onClick={exportCsv}>Export CSV</Button> : null}
      </Group>
      {shown.length ? (
        <Stack gap="md">
          {DAY_GROUPS.map((g) => {
            var inGroup = shown.filter((i) => dayGroup(i.at, now) === g);
            if (!inGroup.length) return null;
            return (
              <Stack key={g} gap="xs" component="section" aria-label={g}>
                <Title order={2} size="h5">{g}</Title>
                <Timeline bulletSize={14} lineWidth={2} aria-label={"History, " + g}>
                  {inGroup.map((i, n) => (
                    <Timeline.Item key={i.at + ":" + n} title={<Anchor href={i.href} inherit>{(i.by ? personLabel(ctx, profiles, i.by) : "Routine") + " " + i.text}</Anchor>}>
                      <Text size="xs" c="dimmed">{human(i.at, now, { style: "sentence" })}</Text>
                    </Timeline.Item>
                  ))}
                </Timeline>
              </Stack>
            );
          })}
        </Stack>
      ) : (
        <Text c="dimmed">{items.length ? "Nothing matches these filters." : "Nothing has happened yet."}</Text>
      )}
    </Stack>
  );
}

export default function History({ route }) {
  const store = useStore();
  const model = useModel();
  var mode = historyMode(route.params);
  const [got, setGot] = useState(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  var ctx = usePageCtx();

  useEffect(() => {
    setGot(null);
    var specs = { runs: { collection: "runs" } };
    if (mode !== "cal") ["decisions", "settingsHistory", "merges", "views", "comments"].forEach((k) => { specs[k] = { collection: k }; });
    return watchAll({ store: store }, specs, (g) => { setGot(Object.assign({}, g)); setFailed(false); }, () => setFailed(true));
  }, [store, mode, tick]);

  var tabs = (
    <SegmentedControl aria-label="History mode" value={mode} data={HISTORY_MODES.map((m) => ({ value: m[0], label: m[1] }))}
      onChange={(m) => route.go("#/history" + (m === "cal" ? "?mode=cal" : ""))} />
  );
  var body;
  if (failed && !got) body = <StateView kind="error" collection="history" onRetry={() => setTick(tick + 1)} />;
  else if (!got) body = <StateView kind="loading" label="history" />;
  else body = mode === "cal" ? <Calendar runs={runsNewest(got.runs)} definition={model.definition} /> : <TimelineView got={got} ctx={ctx} />;
  return (
    <Stack gap="md">
      <Title id="page-title" order={1}>History</Title>
      <Group>{tabs}</Group>
      {body}
    </Stack>
  );
}
