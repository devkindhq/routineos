// app/pages/RunsHealth.jsx: the Runs page (spec 5.6): when the next run is, three health numbers and every run.
// Runs happen on the schedule; nothing here starts one.
import { useEffect, useState } from "react";
import { Anchor, Badge, Button, Card, Group, SegmentedControl, SimpleGrid, Stack, Table, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import Gated from "../Gated.jsx";
import { accessReason, byId, canWrite, request, watchAll, writeMessage } from "../../core/actions.js";
import { human } from "../../core/dates.js";
import { nextRunLine, runsModel } from "../../core/pages/runs-health.js";
import { sourcesLine } from "../../core/pages/runs.js";
import { QUEUED_LABEL, queuedRequests, waitingRequests } from "../../core/queue.js";
import { producerLabel } from "../../core/shared.js";
import { StateView } from "../States.jsx";
import { useModel, usePageCtx, useStore } from "../StoreContext.jsx";

function Stat({ label, value, delta, color }) {
  return (
    <Card withBorder padding="sm">
      <Text size="sm" c="dimmed">{label}</Text>
      <Group gap="xs" align="baseline">
        <Text fw={700} size="xl" c={color}>{value.toLocaleString()}</Text>
        {delta ? <Text size="sm" c="dimmed">{(delta > 0 ? "+" : "") + delta.toLocaleString() + " since the run before"}</Text> : null}
      </Group>
    </Card>
  );
}

var REQUEST_LIMITS = "The routine reads this at its next scheduled run, so it can take up to the schedule interval. The routine's own daily cap "
  + "still applies, and a capped run does not act on it. Cancelling a queued request is not available yet.";

// Run now and Retry next run both queue a request in the db; neither starts a run. A request the routine already
// reported on is not queued any more. A second ask while one waits queues nothing more (request() hands back the same one).
function AskButton({ ctx, routine, kind, label, size, onDone }) {
  const [busy, setBusy] = useState(false);
  function go() {
    setBusy(true);
    request(ctx, kind, { routine: routine }).then((res) => {
      setBusy(false);
      notifications.show({ color: "teal", message: res && res.existing ? "Already queued for next run" : QUEUED_LABEL });
      onDone();
    }, (e) => { setBusy(false); notifications.show({ color: "red", title: "Not queued", message: writeMessage(e) }); });
  }
  return <Button size={size} variant="default" loading={busy} onClick={go} aria-label={label + ": " + producerLabel(ctx.definition, routine)}>{label}</Button>;
}

function Result({ row, now, ctx, may, noAccess, onDone }) {
  if (row.result === "late") {
    return (
      <Group gap={4} wrap="nowrap">
        <Badge color="red" variant="light">late</Badge>
        <Text size="sm">{"Expected by " + human(row.expectedBy, now, { style: "sentence" })}</Text>
      </Group>
    );
  }
  if (row.result === "partial" && (may || noAccess)) {
    return (
      <Group gap="xs" wrap="nowrap">
        <Badge color="yellow" variant="light">partial</Badge>
        <Gated reason={noAccess} inline><AskButton ctx={ctx} routine={row.producer} kind="retry" label="Retry next run" size="compact-xs" onDone={onDone} /></Gated>
      </Group>
    );
  }
  return <Badge color={row.result === "ok" ? "teal" : "yellow"} variant="light">{row.result}</Badge>;
}

export default function RunsHealth() {
  const store = useStore();
  const model = useModel();
  const ctx = usePageCtx();
  const [got, setGot] = useState(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [only, setOnly] = useState("");

  useEffect(() => {
    var specs = { inbox: { collection: "inbox" }, runs: { collection: "runs" }, views: { collection: "views" },
      columns: { collection: "columns" }, pending: { collection: "pending" }, decisions: { collection: "decisions" },
      workers: { collection: "workers" }, requests: { collection: "requests" } };
    if (model.viewer) specs.mine = { collection: "people/" + model.viewer + "/decisions" };
    return watchAll({ store: store }, specs, (g) => { setGot(Object.assign({}, g)); setFailed(false); }, () => setFailed(true));
  }, [store, model.viewer, tick]);

  var refresh = <Button variant="default" onClick={() => setTick(tick + 1)}>Refresh</Button>;
  var head = <Title id="page-title" order={1}>Runs</Title>;
  if (failed && !got) return <Stack>{head}<StateView kind="error" collection="runs" onRetry={() => setTick(tick + 1)} /></Stack>;
  if (!got) return <Stack>{head}<StateView kind="loading" label="runs" /></Stack>;

  var now = Date.now(), defn = model.definition;
  var m = runsModel(Object.assign({}, got, { definition: defn, viewer: model.viewer, personDecisions: got.mine || [],
    workersByKey: byId(got.workers) }), now);
  var rows = m.rows.filter((r) => !only || r.producer === only);
  var producers = (defn && defn.producers) || [];
  var may = canWrite(ctx).ok;
  var noAccess = accessReason(ctx);
  var waiting = waitingRequests(got.requests, got.runs);
  var again = () => setTick((t) => t + 1);
  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <Stack gap={4}>
          {head}
          <Text c="dimmed">
            {nextRunLine(m.next, m.queued, now)}
            {m.queued ? <>{" "}<Anchor href="#/approvals?tab=queued">See queued approvals</Anchor></> : null}
          </Text>
        </Stack>
        {refresh}
      </Group>
      {producers.length ? (
        <Stack gap="xs">
          {producers.map((p) => {
            var q = queuedRequests(waiting, p.id);
            return (
              <Group key={p.id} gap="sm">
                <Text size="sm" fw={600}>{p.label || p.id}</Text>
                {may || noAccess ? <Gated reason={noAccess} inline><AskButton ctx={ctx} routine={p.id} kind="run-now" label="Run now" size="xs" onDone={again} /></Gated> : null}
                {q.length ? <Text size="sm">{QUEUED_LABEL + ", asked " + human(q[0].data.createdAt, now, { style: "sentence" })}</Text> : null}
              </Group>
            );
          })}
          <Text size="sm" c="dimmed">{may || noAccess ? REQUEST_LIMITS : "Asking for a run needs a signed-in visit that can write."}</Text>
        </Stack>
      ) : null}
      <SimpleGrid cols={{ base: 1, sm: m.cost === null ? 3 : 4 }}>
        <Stat label="Items captured" value={m.captured.value} delta={m.captured.delta} />
        <Stat label="Partial runs (7 days)" value={m.partial7d} color={m.partial7d ? "yellow" : undefined} />
        <Stat label="Late runs" value={m.late7d} color={m.late7d ? "red" : undefined} />
        {m.cost === null ? null : <Stat label="Cost of latest runs" value={m.cost} />}
      </SimpleGrid>
      {producers.length > 1 ? (
        <SegmentedControl aria-label="Producer" value={only} onChange={setOnly}
          data={[{ value: "", label: "All producers" }].concat(producers.map((p) => ({ value: p.id, label: p.label || p.id })))} />
      ) : null}
      {rows.length ? (
        <Table.ScrollContainer minWidth={760}>
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>{["Run", "Producer", "Started", "Result", "Sources", "New", "Dropped", "Duration"].concat(m.columns.map((c) => c.label)).map((t) => <Table.Th key={t} scope="col">{t}</Table.Th>)}</Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((r) => (
                <Table.Tr key={r.id} data-run={r.id}>
                  <Table.Td ff="monospace"><Anchor href={"#/runs/" + encodeURIComponent(r.id)}>{r.id}</Anchor></Table.Td>
                  <Table.Td>{producerLabel(defn, r.producer)}</Table.Td>
                  <Table.Td>{human(r.startedAt, now, { style: "sentence" })}</Table.Td>
                  <Table.Td><Result row={r} now={now} ctx={ctx} may={may} noAccess={noAccess} onDone={again} /></Table.Td>
                  <Table.Td>{sourcesLine(r.run.data)}</Table.Td>
                  <Table.Td ta="right">{String(r.new)}</Table.Td>
                  <Table.Td ta="right">{String(r.dropped)}</Table.Td>
                  <Table.Td ta="right">{r.durationMs === null ? "" : Math.round(r.durationMs / 60000) + " min"}</Table.Td>
                  {m.columns.map((c) => <Table.Td key={c.key} ta="right">{r.extra[c.key] === undefined ? "" : String(r.extra[c.key])}</Table.Td>)}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      ) : <Text c="dimmed">No runs yet. The first run happens on the schedule.</Text>}
    </Stack>
  );
}
