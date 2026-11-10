// app/pages/Today.jsx: what needs the viewer now, as cards (spec 5.1). The hero counts records by health (desk.health)
// as one stacked bar; before the first run it names each producer and its next run (cron is UTC). Decisions happen on
// Approvals; the only writes here are the viewer's own Mark reviewed and Remind me tomorrow.
import { useEffect, useState } from "react";
import { Anchor, Badge, Button, Card, Group, Paper, Progress, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { byId, canWrite, idSet, isDeskOwner, markViewer, snoozeItem, watchAll, withViewerState, writeMessage } from "../../core/actions.js";
import { human } from "../../core/dates.js";
import { APPROVAL_SOON_HOURS, KIND_WORDS, timeLeft } from "../../core/pages/approvals.js";
import { countLine } from "../../core/pages/browse.js";
import { TODAY_HEALTH, headline, healthTiles, lastRefreshed, leadLine, partialLine, progressDelta, todayModel } from "../../core/pages/today.js";
import { fullRead } from "../../core/paging.js";
import { nextRun } from "../../core/schedule.js";
import { entityHash, producerLabel } from "../../core/shared.js";
import ExtPanels from "../ExtPanels.jsx";
import SectionCard, { sectionId } from "../SectionCard.jsx";
import { StateView } from "../States.jsx";
import { useModel, usePageCtx, useStore } from "../StoreContext.jsx";

var TONE_COLOR = { danger: "red", warning: "yellow", success: "teal", neutral: "gray" };

function Section({ title, children, foot }) {
  return (
    <SectionCard id={sectionId("today", title)} title={title}>
      <Stack gap="xs">{children}</Stack>
      {foot ? <Group gap="md" mt="sm">{foot}</Group> : null}
    </SectionCard>
  );
}

// The page's answer first: headline, lead line and the three count tiles. Nothing without a declared status; a capped
// read says how many it read instead of a headline.
function Headline({ m, ctx }) {
  var h = m.hero;
  if (!h) return null;
  var tp = (ctx.definition.types && ctx.definition.types[h.type]) || {};
  var head = headline(h), lead = leadLine(h), tiles = healthTiles(h);
  return (
    <Stack gap="xs">
      {h.capped ? <Text fw={600}>{countLine({ full: false, done: false, shown: h.total }, (tp.plural || h.type).toLowerCase())}</Text> : null}
      {head ? <Text fw={700} size="xl" component="p" m={0}>{head}</Text> : null}
      {lead ? <Text c="dimmed">{lead}</Text> : null}
      <SimpleGrid cols={3} role="group" aria-label="Health counts">
        {tiles.map((t) => (
          <Paper key={t.key} withBorder p="sm" component="a" href={t.href} aria-label={t.label + ": " + t.value}>
            <Text size="sm" c="dimmed">{t.label}</Text>
            <Text fw={700} size="xl" c={t.value ? TONE_COLOR[t.tone] : "dimmed"}>{String(t.value)}</Text>
          </Paper>
        ))}
      </SimpleGrid>
    </Stack>
  );
}

function Hero({ m, ctx, delta }) {
  if (!m.hero) {
    return (
      <Card withBorder padding="md">
        <Text fw={600}>{m.newSinceLast.toLocaleString() + " new since the last run"}</Text>
        {isDeskOwner(ctx) ? <Text size="sm" c="dimmed">Declare desk.health in a producer's definition to see red, yellow and green counts here.</Text> : null}
      </Card>
    );
  }
  var h = m.hero, tp = (ctx.definition.types && ctx.definition.types[h.type]) || {};
  var title = (tp.plural || h.type) + " by health";
  var label = (TODAY_HEALTH.filter((t) => t[2] === h.tone)[0] || [])[1];
  return (
    <Card withBorder padding="md" component="section" aria-label={title}>
      <Group justify="space-between" mb="xs">
        <Title order={2} size="h4">{title}</Title>
        <Badge color={TONE_COLOR[h.tone]} variant="light">{label}</Badge>
      </Group>
      <Progress.Root size="xl" aria-label={title}>
        {h.stack.map((s) => (
          <Progress.Section key={s.label} value={h.total ? (s.value / h.total) * 100 : 0} color={TONE_COLOR[s.tone]}
            aria-label={s.label + ": " + s.value}>
            <Progress.Label>{String(s.value)}</Progress.Label>
          </Progress.Section>
        ))}
      </Progress.Root>
      <Group gap="xs" mt="xs">
        <Text size="sm">{h.green + " of " + h.total + " items (" + (h.total ? Math.round((h.green / h.total) * 100) : 0) + "%)"}</Text>
        {delta ? <Text size="sm" c="dimmed">{delta}</Text> : null}
      </Group>
      <Group gap="md" mt="xs">
        {TODAY_HEALTH.map((t) => (h[t[0]]
          ? <Anchor key={t[0]} size="sm" href={"#/browse/" + encodeURIComponent(h.type) + "?health=" + t[0]}>{h[t[0]] + " " + t[1].toLowerCase()}</Anchor>
          : <Text key={t[0]} size="sm" c="dimmed">{"0 " + t[1].toLowerCase()}</Text>))}
      </Group>
    </Card>
  );
}

function FirstRun({ definition }) {
  var next = ((definition && definition.producers) || []).map((p) => ({ label: p.label || p.id, at: nextRun(p.schedule), schedule: p.schedule }))
    .sort((a, b) => (String(a.at || "~") < String(b.at || "~") ? -1 : 1));
  return (
    <Stack gap="xs">
      <Text fw={600}>Nothing has run yet.</Text>
      {next.map((n) => (
        <Stack key={n.label} gap={0}>
          <Text>{n.at ? n.label + " runs next " + human(n.at, Date.now(), { style: "sentence" }) + "." : n.label + " has not run yet. Its schedule is on the routines page."}</Text>
          <Text size="sm" c="dimmed">{n.schedule ? n.schedule + " (cron, UTC)" : "No schedule recorded"}</Text>
        </Stack>
      ))}
    </Stack>
  );
}

export default function Today() {
  const store = useStore();
  const model = useModel();
  const [got, setGot] = useState(null);
  const [entities, setEntities] = useState(null);
  const [entitiesFailed, setEntitiesFailed] = useState(false);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [gone, setGone] = useState({});
  var ctx = usePageCtx();
  var h = model.definition && model.definition.desk && model.definition.desk.health, type = h && Object.keys(h)[0];

  useEffect(() => {
    var live = true;
    setEntities(type ? null : []);
    setEntitiesFailed(false);
    // A failed read is not an empty list: the hero shows the error and Try again instead of zero counts.
    if (type) fullRead(store, "entities", { where: [["type", "==", type]] }).then((d) => { if (live) setEntities(d); },
      () => { if (live) { setEntities([]); setEntitiesFailed(true); } });
    var specs = withViewerState({ viewer: model.viewer }, { inbox: { collection: "inbox" }, runs: { collection: "runs" }, views: { collection: "views" },
      columns: { collection: "columns" }, pending: { collection: "pending" }, decisions: { collection: "decisions" },
      workers: { collection: "workers" } }, ["done", "snooze"]);
    if (model.viewer) specs.mine = { collection: "people/" + model.viewer + "/decisions" };
    var stop = watchAll({ store: store }, specs, (g) => { setGot(Object.assign({}, g)); setFailed(false); }, () => setFailed(true));
    return () => { live = false; stop(); };
  }, [store, model.viewer, type, tick]);

  var head = <Title id="page-title" order={1}>Today</Title>;
  if (failed && !got) return <Stack>{head}<StateView kind="error" collection="today's messages and runs" onRetry={() => setTick(tick + 1)} /></Stack>;
  if (!got || !entities) return <Stack>{head}<StateView kind="loading" label="today" /></Stack>;

  var now = Date.now();
  var m = todayModel(Object.assign({}, got, { definition: model.definition, viewer: model.viewer, entities: entities,
    personDecisions: got.mine || [], workersByKey: byId(got.workers), done: idSet(got.done) }), now);
  var fromRoutine = m.fromRoutine.filter((x) => !gone[x.id]);
  var write = canWrite(ctx).ok && !!model.viewer;
  var nP = m.health.length;
  var tz;
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { tz = undefined; }
  var refreshed = lastRefreshed(got.runs, tz);
  var header = (
    <Stack gap={4}>
      <Group justify="space-between">
        {head}
        <Group gap="xs">
          {refreshed ? <Text size="sm" c="dimmed">{refreshed}</Text> : null}
          <Button variant="default" onClick={() => setTick(tick + 1)}>Refresh</Button>
        </Group>
      </Group>
      <Text c="dimmed">{new Date(now).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</Text>
      <Text>
        {m.waitingTotal ? <Anchor href="#/approvals">{m.waitingTotal + (m.waitingTotal === 1 ? " request needs" : " requests need") + " you"}</Anchor> : "Nothing needs you"}
        {". "}
        {m.late ? <Anchor href="#/runs">{m.late + " of " + nP + (nP === 1 ? " routine is" : " routines are") + " late"}</Anchor> : nP ? "Every routine is on time" : ""}
        {"."}
      </Text>
    </Stack>
  );
  if (!got.runs.length && !m.waitingTotal) return <Stack gap="md">{header}<FirstRun definition={model.definition} /></Stack>;

  function notSaved(e) { notifications.show({ color: "red", title: "Not saved", message: writeMessage(e) }); }
  function act(x, run, word, undo) {
    Promise.resolve().then(run).then(() => {
      setGone((g) => Object.assign({}, g, { [x.id]: true }));
      if (!undo) { notifications.show({ message: word }); return; }
      var nid = "undo-" + x.id;
      notifications.show({ id: nid, message: (
        <Group gap="xs" justify="space-between" wrap="nowrap">
          <Text size="sm">{word}</Text>
          <Button size="xs" variant="subtle" onClick={() => {
            notifications.hide(nid);
            undo().then(() => setGone((g) => { var n = Object.assign({}, g); delete n[x.id]; return n; }), notSaved);
          }}>Undo</Button>
        </Group>
      ) });
    }, notSaved);
  }

  var defn = model.definition;
  return (
    <Stack gap="md">
      {header}
      {!m.waitingTotal && !fromRoutine.length ? <Text c="dimmed">Nothing needs you.</Text> : null}
      {entitiesFailed
        ? <StateView kind="error" collection="records" onRetry={() => setTick(tick + 1)} />
        : <><Headline m={m} ctx={ctx} /><Hero m={m} ctx={ctx} delta={progressDelta(got.runs)} /></>}
      <ExtPanels />
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        {m.waitingTotal ? (
          <Section title="Needs you" foot={<Anchor href="#/approvals">{"See all " + m.waitingTotal + " in Approvals"}</Anchor>}>
            {m.waiting.map((r) => {
              var left = r.group === "gates" ? timeLeft({ createdAt: r.createdAt, timeoutHours: (r.gate || {}).timeoutHours }, now) : { hours: null };
              return (
                <Stack key={r.id} gap={2}>
                  <Anchor href={"#/approvals?r=" + encodeURIComponent(r.id)}>{r.title}</Anchor>
                  <Group gap="xs">
                    <Badge variant="light" color="gray">{KIND_WORDS[r.kind] || r.kind}</Badge>
                    {r.createdAt ? <Text size="sm" c="dimmed">{human(r.createdAt, now, { style: "sentence" })}</Text> : null}
                    {left.hours !== null ? <Text size="sm" c={left.hours < APPROVAL_SOON_HOURS ? "red" : "dimmed"}>{left.label}</Text> : null}
                  </Group>
                </Stack>
              );
            })}
          </Section>
        ) : null}
        <Section title="Routine health" foot={[
          m.queued ? <Anchor key="q" href="#/approvals?tab=queued">{m.queued + " queued for next run"}</Anchor> : null,
          <Anchor key="r" href="#/runs">Open Runs</Anchor>]}>
          {m.health.map((x) => (
            <Stack key={x.producer} gap={0}>
              <Text fw={600}>{producerLabel(defn, x.producer)}</Text>
              <Text size="sm" c={TONE_COLOR[x.tone] === "gray" ? "dimmed" : TONE_COLOR[x.tone]}>
                {x.last ? <Anchor inherit href={"#/runs/" + encodeURIComponent(x.last.id)}>{x.text}</Anchor> : x.text}
              </Text>
            </Stack>
          ))}
        </Section>
        {fromRoutine.length ? (
          <Section title="From the routine">
            {fromRoutine.map((x) => {
              var ref = (x.data.refs || [])[0], rid = ref && (ref.id || ref), title = x.data.title || "Untitled";
              return (
                <Stack key={x.id} gap={4}>
                  <Group gap="xs">
                    <Badge variant="light">{x.data.kind}</Badge>
                    {typeof rid === "string" ? <Anchor href={entityHash(rid)}>{title}</Anchor> : <Text>{title}</Text>}
                  </Group>
                  {x.data.why ? <Text size="sm" c="dimmed">{x.data.why}</Text> : null}
                  {write ? (
                    <Group gap="xs">
                      <Button size="xs" variant="light" onClick={() => act(x, () => markViewer(ctx, "done", x.id, true), "Marked reviewed.", () => markViewer(ctx, "done", x.id, false))}>Mark reviewed</Button>
                      <Button size="xs" variant="subtle" onClick={() => act(x, () => snoozeItem(ctx, x.id, new Date(Date.now() + 86400000).toISOString()), "Back tomorrow.")}>Remind me tomorrow</Button>
                    </Group>
                  ) : null}
                </Stack>
              );
            })}
          </Section>
        ) : null}
        {m.sinceLastRun.length ? (
          <Section title="Since the last run">
            {m.sinceLastRun.map((s) => (
              <Stack key={s.producer} gap={2}>
                <Group gap="xs">
                  <Text fw={600}>{producerLabel(defn, s.producer)}</Text>
                  {s.partial ? <Badge color="yellow" variant="light">{partialLine(s.partial)}</Badge> : null}
                </Group>
                <Text size="sm" c="dimmed">{(s.counts.new || 0) + " new, " + (s.counts.updated || 0) + " updated, " + (s.counts.dropped || 0) + " dropped"}</Text>
                {s.changed.length ? (
                  <Group gap="xs">{s.changed.map((id) => <Anchor key={id} size="sm" href={entityHash(id)}>{id.slice(id.indexOf("--") + 2)}</Anchor>)}</Group>
                ) : null}
              </Stack>
            ))}
          </Section>
        ) : null}
        {m.proposals ? (
          <Section title="Proposals" foot={<Anchor href="#/approvals?kind=proposals">Review proposals</Anchor>}>
            <Text>{m.proposals + " waiting: settings, views and columns."}</Text>
          </Section>
        ) : null}
      </SimpleGrid>
    </Stack>
  );
}
