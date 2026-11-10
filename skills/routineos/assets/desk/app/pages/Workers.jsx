// app/pages/Workers.jsx: the lanes of a joined Desk and who serves each (spec 5.7). An unserved lane offers the join
// link to copy; the Desk owner can release a served lane. A visit that is not the owner sees no release control.
import { useEffect, useState } from "react";
import { Badge, Button, Card, Group, List, Modal, Stack, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { RELEASE_ASK, canWrite, isDeskOwner, releaseLane, watchAll, writeMessage } from "../../core/actions.js";
import { human } from "../../core/dates.js";
import { OWNER_TAMPERED_NOTE, UNSERVED_NOTE, deskWriters, laneRows, ownerDecisions_ } from "../../core/pages/workers.js";
import { fullRead } from "../../core/paging.js";
import { personName_ } from "../../core/shared.js";
import { CopyTextButton } from "../Copy.jsx";
import { StateView } from "../States.jsx";
import { useModel, usePageCtx, useStore } from "../StoreContext.jsx";

var WORKERS_NOTE = "Each lane is served by one person's own routine. Their gates wait for them in Approvals.";

function Copy({ value, label }) {
  return <CopyTextButton size="xs" value={value} label={label} />;
}

function LaneRow({ row, url, who, release }) {
  if (!row.served) {
    return (
      <Card withBorder padding="sm" data-lane={row.laneId}>
        <Stack gap="xs">
          <Group gap="xs"><Badge color="yellow" variant="light">Unserved</Badge><Text fw={600}>{row.label}</Text></Group>
          <Text size="sm" c="dimmed">{UNSERVED_NOTE}</Text>
          {url ? <Group><Copy value={url} label="Copy link" /></Group> : null}
        </Stack>
      </Card>
    );
  }
  return (
    <Card withBorder padding="sm" data-lane={row.laneId}>
      <Stack gap="xs">
        <Group gap="xs">
          <Badge color={row.health === "ok" ? "teal" : row.health ? "yellow" : "gray"} variant="light">{row.health || "No run yet"}</Badge>
          <Text fw={600}>{row.label}</Text>
        </Group>
        <Text size="sm" c="dimmed">
          {(who ? "Served by " + who + ". " : "") + (row.lastRun ? "Last run " + human(row.lastRun, Date.now(), { style: "sentence" }) + ". " : "No run yet. ")
            + row.waiting + " waiting, " + row.done + " done" + (row.gates ? ", " + row.gates + " to approve" : "") + "."}
        </Text>
        {release ? <Group><Button size="xs" variant="light" color="red" onClick={() => release(row)}>Release</Button></Group> : null}
      </Stack>
    </Card>
  );
}

export default function Workers() {
  const store = useStore();
  const model = useModel();
  const [got, setGot] = useState(null);
  const [entities, setEntities] = useState(null);
  const [failed, setFailed] = useState(false);
  const [profiles, setProfiles] = useState({});
  const [asking, setAsking] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  var card = model.join;
  var lanes = card && Array.isArray(card.lanes) ? card.lanes : null;
  var ownerBy = model.owner && model.owner.by;
  var ctx = usePageCtx();

  useEffect(() => {
    if (!lanes) return undefined;
    var live = true;
    var types = lanes.map((l) => l && l.match && l.match.type).filter((t, i, a) => typeof t === "string" && a.indexOf(t) === i);
    Promise.all(types.map((t) => fullRead(store, "entities", { where: [["type", "==", t]] }))).then((lists) => {
      if (live) setEntities([].concat.apply([], lists));
    }, () => { if (live) setFailed(true); });
    var specs = { workers: { collection: "workers" }, outcomes: { collection: "outcomes" }, pending: { collection: "pending" } };
    var released = ownerDecisions_(ownerBy);
    if (released) specs.released = { collection: released };
    var stop = watchAll({ store: store }, specs, (g) => { if (live) { setGot(Object.assign({}, g)); setFailed(false); } }, () => { if (live) setFailed(true); });
    return () => { live = false; stop(); };
  }, [store, !!lanes, ownerBy, tick]);

  var rows = got && entities ? laneRows(card, got.workers, got.outcomes, got.pending, entities, { decisions: got.released, ownerBy: ownerBy }) : [];
  var writers = deskWriters(ownerBy, rows);
  var ids = rows.map((r) => r.by).filter((id, i, a) => id && a.indexOf(id) === i);
  useEffect(() => {
    var live = true;
    if (writers < 2 || !ids.length || typeof store.profiles !== "function") return undefined;
    store.profiles(ids).then((p) => { if (live) setProfiles(p || {}); }, () => {});
    return () => { live = false; };
  }, [store, ids.join("|"), writers]);

  var head = <Title id="page-title" order={1}>Workers</Title>;
  if (!lanes) return <Stack>{head}<Text c="dimmed">This Desk is not set up for others to join.</Text></Stack>;
  if (failed && !(got && entities)) return <Stack>{head}<StateView kind="error" collection="workers" onRetry={() => setTick(tick + 1)} /></Stack>;
  if (!got || !entities) return <Stack>{head}<StateView kind="loading" label="workers" /></Stack>;

  var owner = isDeskOwner(ctx) && !model.ownerTampered && canWrite(ctx).ok;
  var url = typeof card.url === "string" && /^https:\/\//.test(card.url) ? card.url : null;
  var cap = card.cap || {};

  function doRelease() {
    var row = asking;
    setBusy(true);
    releaseLane(ctx, row.laneKey, () => true, row.by).then((ok) => {
      setBusy(false);
      setAsking(null);
      if (!ok) throw new Error("the lane was not released");
      notifications.show({ message: "Released. The worker's next run stops." });
    }).catch((e) => {
      setBusy(false);
      setAsking(null);
      notifications.show({ color: "red", title: "Not released", message: writeMessage(e) });
    });
  }

  return (
    <Stack gap="md">
      <Stack gap={4}>
        {head}
        <Text c="dimmed">{WORKERS_NOTE}</Text>
        {model.viewer ? (
          <Group gap="xs">
            <Text size="sm" c="dimmed">{"Your Desk id: " + model.viewer + " (give it when you join or leave)."}</Text>
            <Copy value={String(model.viewer)} label="Copy id" />
          </Group>
        ) : null}
      </Stack>
      {model.ownerTampered ? <Text size="sm" c="dimmed" role="status">{OWNER_TAMPERED_NOTE}</Text> : null}
      <Card withBorder padding="md" component="section" aria-label="Lanes">
        <Group gap="xs" mb="xs"><Title order={2} size="h4">Lanes</Title><Badge variant="light" color="gray">{String(rows.length)}</Badge></Group>
        <Stack gap="xs">
          {rows.map((r) => (
            <LaneRow key={r.laneKey || r.laneId} row={r} url={url}
              who={writers > 1 && r.by ? personName_(profiles, r.by, model.viewer) : ""} release={owner && r.served ? setAsking : null} />
          ))}
        </Stack>
      </Card>
      {isDeskOwner(ctx) ? (
        <Card withBorder padding="md" component="section" aria-label="Join settings">
          <Title order={2} size="h4" mb="xs">Join settings</Title>
          <List size="sm">
            <List.Item>{"Open to join: " + (card.open ? "yes" : "no")}</List.Item>
            <List.Item>{"Daily cap: " + (cap.maxRunsPerDay || 1) + " runs a day " + (cap.scope === "desk" ? "for the whole Desk" : "per account")}</List.Item>
          </List>
          <Text size="sm" c="dimmed" mt="xs">To open or close the Desk, ask in a session to run join-settings. To change the cap, ask for a change to the Desk definition.</Text>
        </Card>
      ) : null}
      <Modal opened={!!asking} onClose={() => setAsking(null)} title="Release this lane?">
        <Stack>
          <Text>{RELEASE_ASK}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setAsking(null)}>Cancel</Button>
            <Button color="red" loading={busy} onClick={doRelease}>Release this lane</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
