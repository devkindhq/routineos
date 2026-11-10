// app/pages/Runs.jsx: one run's page at #/runs/<id> (spec s8 item 5). Read only apart from the viewer's own "seen"
// mark. Schedules are cron in UTC and are edited on the routines page.
import { useEffect, useState } from "react";
import { Accordion, Anchor, Badge, Button, Group, Stack, Table, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import Gated from "../Gated.jsx";
import { accessReason, byId, canWrite, idSet, markViewer, watchAll, withViewerState, writeMessage } from "../../core/actions.js";
import { human } from "../../core/dates.js";
import {
  RUN_COUNTS, currentSettings, dropReasonLinks, idType, runMinutes, runStatusTone, settingsDiff, shown, sourcesLine,
} from "../../core/pages/runs.js";
import { entityHash, isClaudeSessionUrl, producerLabel } from "../../core/shared.js";
import { CopyTextButton } from "../Copy.jsx";
import SectionCard, { sectionId } from "../SectionCard.jsx";
import { StateView } from "../States.jsx";
import { useModel, usePageCtx, useStore } from "../StoreContext.jsx";

var TONE_COLOR = { danger: "red", warning: "yellow", success: "teal" };

function Section({ title, count, children }) {
  return (
    <SectionCard id={sectionId("run", title)} title={title}
      aside={count !== undefined ? <Badge variant="light" color="gray">{String(count)}</Badge> : null}>
      <Stack gap="xs">{children}</Stack>
    </SectionCard>
  );
}

function Pairs({ rows }) {
  return (
    <Table>
      <Table.Tbody>
        {rows.map((p) => (
          <Table.Tr key={p.label}>
            <Table.Th scope="row">{p.label}</Table.Th>
            <Table.Td>{p.value}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

function RunDetail({ ctx, id, d, settingsDoc, seen, onSeen }) {
  var defn = ctx.definition;
  var producer = ((defn && defn.producers) || []).filter((p) => p.id === d.producer)[0] || null;
  var c = d.counts || {};
  var line = sourcesLine(d);
  var diff = settingsDiff(d.settingsUsed, currentSettings(defn, d.producer, settingsDoc));
  var mins = runMinutes(d);
  var num = (n) => (n || 0).toLocaleString();
  var seenBox;
  if (!ctx.viewer) seenBox = <Text size="sm" c="dimmed">Mark seen needs a viewer id, which this visit does not have.</Text>;
  else if (seen) seenBox = <Text size="sm" c="dimmed">You marked this run seen.</Text>;
  else if (canWrite(ctx).ok || accessReason(ctx)) seenBox = <Gated reason={accessReason(ctx)}><Group><Button size="xs" variant="light" onClick={onSeen}>Mark seen</Button></Group></Gated>;
  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <Stack gap={4}>
          <Title id="page-title" order={1}>{producerLabel(defn, d.producer) + " run"}</Title>
          <Group gap="xs">
            <Badge color={TONE_COLOR[runStatusTone(d.status)]} variant="light">{d.status || "unknown"}</Badge>
            <Text size="sm">{"Started " + (isFinite(Date.parse(d.startedAt)) ? human(d.startedAt, Date.now(), { style: "sentence" }) : "unknown")
              + (mins !== null ? ", took " + mins + " min" : "") + "."}</Text>
          </Group>
          {line ? <Text size="sm">{"This run " + line + "."}</Text> : null}
        </Stack>
        <CopyTextButton value={id} label="Copy run id" />
      </Group>
      {seenBox}
      <Section title="Counts">
        <Pairs rows={RUN_COUNTS.map((k) => ({ label: k[1], value: num(c[k[0]]) }))} />
        {dropReasonLinks(d, producer).map((x) => (
          <Text key={x.reason} size="sm">{x.href ? <Anchor inherit href={x.href}>{x.count + " " + x.reason}</Anchor> : x.count + " " + x.reason}</Text>
        ))}
      </Section>
      <Section title="Changed" count={(d.changed || []).length}>
        {(d.changed || []).length ? (
          <Group gap="xs">
            {d.changed.map((cid) => (idType(cid) ? <Anchor key={cid} size="sm" href={entityHash(cid)}>{cid}</Anchor> : <Text key={cid} size="sm">{String(cid)}</Text>))}
          </Group>
        ) : <Text size="sm" c="dimmed">No records changed.</Text>}
      </Section>
      <Section title="Approvals processed">
        {!d.processed ? <Text size="sm" c="dimmed">This run did not report on approvals.</Text> : d.processed.map((p) => (
          <Stack key={p.request} gap={0}>
            <Group gap="xs">
              <Anchor href={"#/approvals?tab=done&r=" + encodeURIComponent(p.request)}>{p.request}</Anchor>
              <Badge variant="light" color={p.outcome === "applied" ? "teal" : "yellow"}>{String(p.outcome).replace("_", " ")}</Badge>
            </Group>
            <Text size="sm" c="dimmed">{p.result || p.reason || ""}</Text>
          </Stack>
        ))}
      </Section>
      <Section title="Inbox">
        <Pairs rows={[{ label: "Written", value: num(d.inboxWritten) }, { label: "Held back by the cap", value: num(d.inboxSuppressed) },
          { label: "Filtered", value: num(d.inboxFiltered) }]} />
      </Section>
      <Accordion variant="contained" multiple>
        <Accordion.Item value="settings">
          <Accordion.Control>Settings used</Accordion.Control>
          <Accordion.Panel>
            {diff.length ? (
              <Table.ScrollContainer minWidth={480}>
                <Table>
                  <Table.Thead>
                    <Table.Tr><Table.Th scope="col">Setting</Table.Th><Table.Th scope="col">This run</Table.Th><Table.Th scope="col">Now</Table.Th><Table.Th scope="col">Changed</Table.Th></Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {diff.map((row) => (
                      <Table.Tr key={row.name} data-setting={row.name}>
                        <Table.Td ff="monospace">{row.name}</Table.Td>
                        <Table.Td ff="monospace">{shown(row.used)}</Table.Td>
                        <Table.Td ff="monospace">{shown(row.current)}</Table.Td>
                        <Table.Td>{row.differs ? <Badge color="yellow" variant="light">changed since</Badge> : "same"}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            ) : <Text size="sm" c="dimmed">This run recorded no settings.</Text>}
          </Accordion.Panel>
        </Accordion.Item>
        <Accordion.Item value="details">
          <Accordion.Control>Technical details</Accordion.Control>
          <Accordion.Panel>
            <Pairs rows={[
              { label: "Definition version", value: d.definitionVersion !== undefined ? String(d.definitionVersion) : "Not recorded" },
              { label: "Merge policy", value: d.mergePolicy ? JSON.stringify(d.mergePolicy) : "Not recorded" },
              { label: "Schedule", value: ((producer && producer.schedule) ? producer.schedule + " (cron, UTC)" : "No schedule recorded") + ". Edit the schedule on the routines page." },
              { label: "Parent run", value: d.parentRun ? <Anchor href={"#/runs/" + encodeURIComponent(d.parentRun)}>{d.parentRun}</Anchor> : "None" },
              { label: "Claude session", value: d.sessionUrl
                ? (isClaudeSessionUrl(d.sessionUrl) ? <Anchor href={String(d.sessionUrl)} rel="noopener noreferrer">Open session</Anchor> : String(d.sessionUrl))
                : "Not recorded" },
              { label: "Run id", value: <Text span ff="monospace">{id}</Text> },
            ]} />
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Stack>
  );
}

export default function Runs({ route }) {
  const store = useStore();
  const model = useModel();
  var id = route.params.id;
  const [got, setGot] = useState(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [seenNow, setSeenNow] = useState(null);
  useEffect(() => setSeenNow(null), [id]);
  var ctx = usePageCtx();

  useEffect(() => {
    var specs = withViewerState({ viewer: model.viewer }, { runs: { collection: "runs" }, settings: { collection: "settings" } }, ["ack"]);
    return watchAll({ store: store }, specs, (g) => { setGot(Object.assign({}, g)); setFailed(false); }, () => setFailed(true));
  }, [store, model.viewer, tick]);

  var head = <Title id="page-title" order={1}>Run</Title>;
  if (failed && !got) return <Stack>{head}<StateView kind="error" collection="runs" onRetry={() => setTick(tick + 1)} /></Stack>;
  if (!got) return <Stack>{head}<StateView kind="loading" label="the run" /></Stack>;
  var run = got.runs.filter((r) => r.id === id)[0];
  if (!run) {
    return (
      <Stack align="flex-start">
        {head}
        <Text>{"No run with id " + id + "."}</Text>
        <Anchor href="#/runs">Back to Runs</Anchor>
      </Stack>
    );
  }
  var seen = seenNow !== null ? seenNow : !!(got.ack && idSet(got.ack).has(id));
  function notSaved(e) { notifications.show({ color: "red", title: "Not saved", message: writeMessage(e) }); }
  function onSeen() {
    markViewer(ctx, "ack", id, true).then(() => {
      setSeenNow(true);
      var nid = "undo-ack-" + id;
      notifications.show({ id: nid, message: (
        <Group gap="xs" justify="space-between" wrap="nowrap">
          <Text size="sm">Marked seen.</Text>
          <Button size="xs" variant="subtle" onClick={() => {
            notifications.hide(nid);
            markViewer(ctx, "ack", id, false).then(() => setSeenNow(false), notSaved);
          }}>Undo</Button>
        </Group>
      ) });
    }, notSaved);
  }
  return <RunDetail ctx={ctx} id={id} d={run.data} settingsDoc={byId(got.settings)[run.data.producer]} seen={seen} onSeen={onSeen} />;
}
