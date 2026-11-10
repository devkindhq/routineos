// app/pages/Approvals.jsx: every request the routine is waiting on a person for (spec 5.3). Tabs Waiting, Queued and
// Done (?tab=, with ?t= read the same), a kind control, one card per request. A decision shows a notification with
// Undo when it can be undone; a refused write says why and offers no Undo. A visit that may not decide sees the
// requests and no decision controls.
import { useEffect, useRef, useState } from "react";
import {
  Badge, Button, Card, Group, Modal, SegmentedControl, Stack, Tabs, Text, TextInput, Textarea, Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  acceptProposal, byId, canWrite, decide, rejectProposal, remove, save, snoozeProposal, stamp, undoAccept, watchAll,
  writeMessage,
} from "../../core/actions.js";
import { human } from "../../core/dates.js";
import {
  APPROVALS_NOTE, APPROVAL_EMPTY, APPROVAL_KINDS, APPROVAL_SOON_HOURS, APPROVAL_TABS, KIND_WORDS, MAX_NOTE,
  REPORT_ONLY_NOTE, UNDO_NOTE, approveGate, approvalsHash_, gateSends_, noteText_, queuedBanner, queuedLine, recipientLine,
  rejectGate, tabOf_, timeLeft,
} from "../../core/pages/approvals.js";
import { waitingRequests } from "../../core/queue.js";
import { deriveRequests, evidenceLine, gateLine, itemLine, requestsIn, undoable } from "../../core/requests.js";
import { canApproveGate, producerLabel } from "../../core/shared.js";
import { canDecide } from "../DecisionControl.jsx";
import { StateView } from "../States.jsx";
import { useModel, usePageCtx, useStore } from "../StoreContext.jsx";

function GateActions({ r, note, setNote, draft, run, askDecline }) {
  var g = r.gate || {};
  var expired = timeLeft({ createdAt: r.createdAt, timeoutHours: g.timeoutHours }).label === "Expired";
  var canUndo = r.kind === "gate";
  return (
    <Stack gap="xs">
      {note.open ? (
        <Textarea label="Note for the routine" autosize minRows={3} maxLength={MAX_NOTE} value={note.text}
          onChange={(e) => setNote({ open: true, text: e.currentTarget.value })}
          onKeyDown={(e) => { if (e.key === "Escape" && !note.text) { e.stopPropagation(); setNote({ open: false, text: "" }); } }} />
      ) : null}
      <Group gap="xs">
        <Button disabled={expired} onClick={() => run(r, () => approveGate(r.ctx, r.id, g, g.draft ? draft : null, note.text), "Approved", canUndo)}>
          {noteText_(note.text) ? "Approve with instructions" : "Approve"}
        </Button>
        <Button variant="default" onClick={() => {
          var n = noteText_(note.text);
          var go = () => run(r, () => rejectGate(r.ctx, r.id, n, g), "Declined", canUndo);
          if (!n && gateSends_(g)) askDecline(go); else go();
        }}>Decline</Button>
        <Button variant="subtle" onClick={() => setNote(note.open ? { open: false, text: "" } : { open: true, text: note.text })}>{note.open ? "Remove note" : "Add note"}</Button>
      </Group>
    </Stack>
  );
}

function ProposalActions({ r, run }) {
  var ctx = r.ctx;
  var m = { id: r.id, data: { proposal: r.proposal, producer: r.producer } };
  var key = typeof r.proposal.key === "string" ? { key: r.proposal.key } : null;
  return (
    <Group gap="xs">
      {r.kind === "proposal-l1" ? (
        <Button onClick={() => run(r, () => acceptProposal(ctx, m).then((prior) => ({ revert: () => undoAccept(ctx, r.id, prior) })), "Applied to settings", true)}>Approve</Button>
      ) : null}
      <Button variant="default" onClick={() => run(r, () => (r.kind === "proposal-l1" ? decide(ctx, r.id, "dismiss", key) : rejectProposal(ctx, m)), "Declined", true)}>Decline</Button>
      <Button variant="subtle" onClick={() => run(r, () => snoozeProposal(ctx, m), "Snoozed", true)}>Snooze</Button>
    </Group>
  );
}

function ViewActions({ r, run }) {
  var ctx = r.ctx;
  var path = (r.kind === "view" ? "views/" : "columns/") + r.docId;
  var noun = r.kind === "view" ? "view" : "column";
  return (
    <Stack gap="xs">
      <Text size="sm" c="dimmed">{"Approve keeps this " + noun + ". Decline archives it."}</Text>
      <Group gap="xs">
        <Button onClick={() => run(r, () => {
          var s = stamp(ctx), was = Object.assign({}, r.doc);
          return save(ctx.store, ctx.viewer, path, Object.assign({}, r.doc, { state: "kept", updatedAt: s.at, updatedBy: s.by }))
            .then(() => ({ revert: () => save(ctx.store, ctx.viewer, path, was) }));
        }, "Approved", true)}>Approve</Button>
        <Button variant="default" onClick={() => run(r, () => decide(ctx, r.id, "archive"), "Declined", true)}>Decline</Button>
      </Group>
    </Stack>
  );
}

function DraftBox({ gate, draft, setDraft, editable }) {
  const [editing, setEditing] = useState(false);
  if (!gate.draft) return null;
  return (
    <Stack gap="xs">
      {editing ? (
        <>
          <TextInput label="Subject" aria-label="Draft subject" value={draft.subject} onChange={(e) => setDraft({ subject: e.currentTarget.value, body: draft.body })} />
          <Textarea label="Body" aria-label="Draft body" autosize minRows={6} value={draft.body} onChange={(e) => setDraft({ subject: draft.subject, body: e.currentTarget.value })} />
        </>
      ) : (
        <Card withBorder padding="sm">
          <Text fw={600}>{draft.subject}</Text>
          <Text size="sm" component="pre">{draft.body}</Text>
        </Card>
      )}
      {editable ? <Group><Button size="xs" variant="default" onClick={() => setEditing(!editing)}>{editing ? "Done editing" : "Edit draft"}</Button></Group> : null}
    </Stack>
  );
}

function RequestCard({ r, now, may, decides, write, note, setNote, run, undo, askDecline, definition }) {
  var g = r.gate || {};
  var gateLike = r.group === "gates";
  var left = gateLike ? timeLeft({ createdAt: r.createdAt, timeoutHours: g.timeoutHours }, now) : null;
  const [draft, setDraft] = useState({ subject: g.draft ? g.draft.subject : "", body: g.draft ? g.draft.body : "" });
  var deciding = r.state === "waiting" && decides && may.ok;
  var foot = null;
  if (r.state === "waiting") {
    if (decides && !may.ok) foot = <Text size="sm" c="dimmed">{may.reason}</Text>;
    else if (deciding) {
      foot = r.group === "gates" ? <GateActions r={r} note={note} setNote={setNote} draft={draft} run={run} askDecline={askDecline} />
        : r.group === "proposals" ? <ProposalActions r={r} run={run} /> : <ViewActions r={r} run={run} />;
    }
  } else if (r.state === "queued") {
    foot = (
      <Stack gap="xs">
        <Text size="sm">{queuedLine(definition, r.producer, now)}</Text>
        {r.decision && r.decision.note ? <Text size="sm" c="dimmed">{"Note: " + r.decision.note}</Text> : null}
        {write ? <Group><Button size="xs" variant="default" onClick={() => undo(r)}>Undo</Button></Group> : null}
      </Stack>
    );
  } else {
    var o = r.outcome || {};
    foot = (
      <Stack gap={4}>
        <Text size="sm" fw={600}>{o.text || "Decided"}</Text>
        {o.result ? <Text size="sm" c="dimmed">{o.result}</Text> : null}
        {r.decision && r.decision.note ? <Text size="sm" c="dimmed">{"Note: " + r.decision.note}</Text> : null}
      </Stack>
    );
  }
  return (
    <Card withBorder padding="md" data-id={r.id} tabIndex={-1}>
      <Stack gap="xs">
        <Group gap="xs" justify="space-between" wrap="nowrap">
          <Title order={3} size="h5" miw={0}>{r.title}</Title>
          <Badge variant="light" color="gray" flex="none">{KIND_WORDS[r.kind] || r.kind}</Badge>
        </Group>
        <Text size="sm" c="dimmed">{"Proposed by " + (producerLabel(definition, r.producer) || "the routine") + (r.createdAt ? ", " + human(r.createdAt, now, { style: "sentence" }) : "")}</Text>
        {r.why ? <Text size="sm">{r.why}</Text> : null}
        {gateLike && r.state === "waiting" && left.hours !== null ? (
          <Text size="sm" c={left.hours < APPROVAL_SOON_HOURS ? "red" : undefined}>{left.label}</Text>
        ) : null}
        {gateLike ? <Text size="sm" c="dimmed">{[gateLine(g), recipientLine(g.recipients)].filter(Boolean).join(" ")}</Text> : null}
        {r.kind === "proposal-l1" ? <Text size="sm">{itemLine(r.proposal)}</Text> : null}
        {r.kind === "proposal-l1" && evidenceLine(r.proposal.evidence) ? <Text size="sm" c="dimmed">{evidenceLine(r.proposal.evidence)}</Text> : null}
        {r.kind === "proposal-l23" ? <><Text size="sm">{itemLine(r.proposal)}</Text><Text size="sm" c="dimmed">{r.note}</Text></> : null}
        {gateLike ? <DraftBox gate={g} draft={draft} setDraft={setDraft} editable={deciding} /> : null}
        {foot}
      </Stack>
    </Card>
  );
}

export default function Approvals({ route }) {
  const store = useStore();
  const model = useModel();
  var query = route.params.query || {};
  var kind = APPROVAL_KINDS.some((k) => k[0] === query.kind) ? query.kind : "all";
  var asked = APPROVAL_TABS.some((t) => t[0] === query.tab) ? query.tab : null;
  var focusId = query.r || null;
  var ctx = usePageCtx();
  const [got, setGot] = useState(null);
  const [failed, setFailed] = useState(false);
  const [notes, setNotes] = useState({});
  const [hidden, setHidden] = useState({});
  const [confirm, setConfirm] = useState(null);
  const decidedAt = useRef({});
  const latest = useRef({ list: [], runs: [] });

  useEffect(() => {
    var specs = { pending: { collection: "pending" }, inbox: { collection: "inbox" }, views: { collection: "views" },
      columns: { collection: "columns" }, decisions: { collection: "decisions" }, runs: { collection: "runs" }, workers: { collection: "workers" },
      requests: { collection: "requests" } };
    if (model.viewer) specs.mine = { collection: "people/" + model.viewer + "/decisions" };
    return watchAll({ store: store }, specs, (g) => { setGot(Object.assign({}, g)); setFailed(false); }, () => setFailed(true));
  }, [store, model.viewer]);

  var write = canWrite(ctx);
  var decides = canDecide(ctx);
  var head = (
    <Stack gap="xs">
      <Title id="page-title" order={1}>Approvals</Title>
      <Text c="dimmed">{APPROVALS_NOTE}</Text>
      {decides ? null : (
        <Stack gap={2}>
          <Text size="sm" c="dimmed">{REPORT_ONLY_NOTE}</Text>
          <Text size="sm" c="dimmed">{(write.ok ? "This Desk is joined" : write.reason) + ". You can read every request here; the person who set up this Desk decides them."}</Text>
        </Stack>
      )}
    </Stack>
  );
  if (failed && !got) return <Stack>{head}<StateView kind="error" collection="approvals" /></Stack>;
  if (!got) return <Stack>{head}<StateView kind="loading" label="approvals" /></Stack>;

  var now = Date.now();
  var workersByKey = byId(got.workers);
  var list = deriveRequests({ pending: got.pending, inbox: got.inbox, views: got.views, columns: got.columns,
    decisions: got.decisions, personDecisions: got.mine || [], runs: got.runs || [], workersByKey: workersByKey }, model.viewer, now);
  latest.current = { list: list, runs: got.runs || [] };
  var tab = asked || (focusId && tabOf_(list, focusId)) || "waiting";

  function noteOf(id) { return notes[id] || { open: false, text: "" }; }
  function setNote(id, n) { setNotes((all) => Object.assign({}, all, { [id]: n })); }

  function undo(r, revert) {
    var cur = latest.current.list.filter((x) => x.id === r.id)[0] || r;
    var req = cur.decision ? cur : Object.assign({}, cur, { decision: { at: decidedAt.current[r.id] || new Date().toISOString() } });
    var u = undoable(req, latest.current.runs);
    if (!u.ok) { notifications.show({ message: "Already applied in run " + u.runId }); return; }
    Promise.resolve().then(() => (revert ? revert() : remove(store, model.viewer, r.decisionPath))).then(() => {
      setHidden((h) => { var n = Object.assign({}, h); delete n[r.id]; return n; });
      setNote(r.id, { open: true, text: noteOf(r.id).text });
      notifications.show({ message: UNDO_NOTE });
    }, (e) => notifications.show({ color: "red", title: "Not saved", message: writeMessage(e) }));
  }

  function run(r, write, word, canUndo) {
    Promise.resolve().then(write).then((res) => {
      decidedAt.current[r.id] = new Date().toISOString();
      setHidden((h) => Object.assign({}, h, { [r.id]: true }));
      var revert = res && res.revert ? res.revert : null;
      var nid = "approval-" + r.id + "-" + Date.now();
      notifications.show({ id: nid, color: "teal", message: (
        <Group gap="xs" justify="space-between" wrap="nowrap">
          <Text size="sm">{word + ": " + r.title}</Text>
          {canUndo ? <Button size="xs" variant="subtle" onClick={() => { notifications.hide(nid); undo(r, revert); }}>Undo</Button> : null}
        </Group>
      ) });
    }, (e) => notifications.show({ color: "red", title: "Not saved", message: writeMessage(e) }));
  }

  var banner = queuedBanner(list.concat(waitingRequests(got.requests, got.runs)), model.definition, now);
  var cards = (state) => requestsIn(list, state, kind).filter((r) => !(state === "waiting" && hidden[r.id]));

  return (
    <Stack gap="md">
      {head}
      {banner ? <Text fw={600}>{banner}</Text> : null}
      <SegmentedControl aria-label="Kind" value={kind} data={APPROVAL_KINDS.map((k) => ({ value: k[0], label: k[1] }))}
        onChange={(k) => route.go(approvalsHash_(tab, k))} />
      <Tabs value={tab} onChange={(t) => route.go(approvalsHash_(t, kind))}>
        <Tabs.List>
          {APPROVAL_TABS.map((t) => (
            <Tabs.Tab key={t[0]} value={t[0]}>{t[1] + (t[0] === "done" ? "" : " (" + cards(t[0]).length + ")")}</Tabs.Tab>
          ))}
        </Tabs.List>
        {APPROVAL_TABS.map((t) => (
          <Tabs.Panel key={t[0]} value={t[0]} pt="md">
            {t[0] !== tab ? null : cards(t[0]).length ? (
              <Stack gap="sm">
                {cards(t[0]).map((r) => (
                  <RequestCard key={r.id} r={Object.assign({ ctx: ctx }, r)} now={now} definition={model.definition}
                    may={r.group === "gates" ? canApproveGate(r.gate || {}, workersByKey, model.viewer) : { ok: true, reason: "" }}
                    decides={decides} write={decides} note={noteOf(r.id)} setNote={(n) => setNote(r.id, n)}
                    run={run} undo={(x) => undo(x)} askDecline={(go) => setConfirm(() => go)} />
                ))}
              </Stack>
            ) : (
              <Stack gap={2}>
                <Text fw={600}>{APPROVAL_EMPTY[t[0]][0]}</Text>
                <Text size="sm" c="dimmed">{APPROVAL_EMPTY[t[0]][1]}</Text>
              </Stack>
            )}
          </Tabs.Panel>
        ))}
      </Tabs>
      <Modal opened={!!confirm} onClose={() => setConfirm(null)} title="Decline without a note?">
        <Stack>
          <Text>The routine will not send this. A note tells it why.</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button color="red" onClick={() => { var go = confirm; setConfirm(null); go(); }}>Decline</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
