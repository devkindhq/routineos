// app/BulkBar.jsx: what can be done to the selected rows. Keep and Drop write decisions/<id> (Drop needs a reason);
// Restore (shown when a dropped row is selected) undoes a person's drop or keeps a record the routine dropped
// (core/actions.js restoreRecord). Tag, Untag, Star and Unstar write the shared userstate/<id>. Each change runs one row at a time (core/bulk.js) and
// offers Undo for UNDO_MS. A visit that cannot write sees the controls disabled and says why; Export always works.
// On a joined Desk only the owner decides (canDecide), so a member who may write sees no Keep, Drop or Restore.
import { useState } from "react";
import { Alert, Button, Group, Paper, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconDownload, IconX } from "@tabler/icons-react";
import { canWrite, decide, dropRecord, remove, restoreRecord, save } from "../core/actions.js";
import { UNDO_MS, bulkSummary, checkScope, runBulk, undoBulk } from "../core/bulk.js";
import { CONFIRM_NAMES, userstateAfter } from "../core/pages/browse.js";
import { entityHash } from "../core/shared.js";
import { canDecide } from "./DecisionControl.jsx";

// rows: the selected rows; names: {id: title}; us and decided: {id: doc data}; ctx: usePageCtx().
// matching: how many rows the filters leave (null until every row is known); onSelectAll selects them all, and
// with allMatching set a change first asks, naming up to CONFIRM_NAMES rows and how many more.
export default function BulkBar({ rows, names, us, decided, ctx, plural, matching, allMatching, onSelectAll, onExport, onClear }) {
  const [ask, setAsk] = useState(null);
  const [reason, setReason] = useState("");
  const [tag, setTag] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  var allowed = canWrite(ctx);
  var decides = !allowed.ok || canDecide(ctx);
  var items = rows.map((r) => ({ id: r.id, name: names[r.id] || r.id }));
  var dropped = items.filter((it, i) => rows[i].status === "dropped" && rows[i].overlay !== "kept-pending");

  function run(write, revert, list, summary) {
    list = list || items;
    var scope = checkScope(list.length);
    if (!scope.ok) { setNote(scope.reason); return; }
    setNote("");
    if (allMatching) {
      var shown = list.slice(0, CONFIRM_NAMES).map((it) => it.name);
      var more = list.length - shown.length;
      setAsk({ text: "This changes " + list.length + " " + plural + ": " + shown.join(", ") + (more > 0 ? " and " + more + " more" : "") + ".",
        go: () => runNow(write, revert, list, summary) });
      return;
    }
    runNow(write, revert, list, summary);
  }
  function runNow(write, revert, list, summary) {
    setAsk(null);
    setBusy(true);
    var priors = new Map();
    list.forEach((it) => { priors.set(it.id, revert.prior(it.id)); });
    runBulk(list, write).then((res) => {
      var text = (summary || bulkSummary)(res, list);
      var id = "bulk-" + Date.now();
      function undo() {
        notifications.hide(id);
        undoBulk(res.done, (rid) => revert.put(rid, priors.get(rid))).then((u) => {
          notifications.show({ message: u.failed.length ? "Undo failed for " + u.failed.length + "." : "Undone." });
        });
      }
      notifications.show({ id: id, autoClose: UNDO_MS, color: res.failed.length ? "yellow" : "teal", message: (
        <Group justify="space-between" wrap="nowrap">
          <Text size="sm">{text}</Text>
          {res.done.length ? <Button size="xs" variant="subtle" onClick={undo}>Undo</Button> : null}
        </Group>
      ) });
    }).finally(() => setBusy(false));
  }

  function person(kind, value) {
    run((it) => save(ctx.store, ctx.viewer, "userstate/" + it.id, userstateAfter(us[it.id], kind, value)), {
      prior: (id) => us[id],
      put: (id, prior) => (prior ? save(ctx.store, ctx.viewer, "userstate/" + id, prior) : remove(ctx.store, ctx.viewer, "userstate/" + id)),
    });
  }
  function decision(write, list, summary) {
    run(write, {
      prior: (id) => decided[id],
      put: (id, prior) => (prior ? save(ctx.store, ctx.viewer, "decisions/" + id, prior) : remove(ctx.store, ctx.viewer, "decisions/" + id)),
    }, list, summary);
  }
  function restore() {
    decision((it) => restoreRecord(ctx, it.id, decided[it.id]), dropped, (res, list) => {
      var name = new Map();
      list.forEach((it) => { name.set(it.id, it.name); });
      var failed = res.failed.length ? " Failed " + res.failed.length + ": " + res.failed.map((f) => name.get(f.id) || f.id).join(", ") + "." : "";
      return "Restored " + res.done.length + ". Applies from the next run." + failed;
    });
  }
  function drop() {
    var r = reason.trim();
    if (!r) { setNote("Give a reason for the drop."); return; }
    decision((it) => dropRecord(ctx, it.id, r));
  }
  function tagged(kind) {
    var name = tag.trim();
    if (!name) { setNote("Name the tag first."); return; }
    person(kind, name);
  }

  var off = !allowed.ok || busy;
  return (
    <Paper withBorder p="xs" role="region" aria-label="Bulk actions">
      <Group gap="xs" wrap="wrap">
        <Text size="sm" fw={600}>{rows.length} selected</Text>
        {!allMatching && onSelectAll && matching !== rows.length ? (
          <Button size="xs" variant="subtle" disabled={matching === null} onClick={onSelectAll}>
            {matching === null ? "Select all matching" : "Select all " + matching + " matching"}
          </Button>
        ) : null}
        {decides ? (
          <>
            <Button size="xs" variant="default" disabled={off} onClick={() => decision((it) => decide(ctx, it.id, "keep"))}>Keep</Button>
            <TextInput size="xs" maxLength={200} aria-label="Reason for the drop" placeholder="Why drop?" value={reason}
              onChange={(e) => setReason(e.currentTarget.value)} disabled={!allowed.ok} />
            <Button size="xs" variant="default" disabled={off} onClick={drop}>Drop</Button>
            {dropped.length ? <Button size="xs" variant="default" disabled={off} onClick={restore}>Restore</Button> : null}
          </>
        ) : null}
        <TextInput size="xs" maxLength={60} aria-label="Tag name" placeholder="Tag" value={tag}
          onChange={(e) => setTag(e.currentTarget.value)} disabled={!allowed.ok} />
        <Button size="xs" variant="default" disabled={off} onClick={() => tagged("tag")}>Tag</Button>
        <Button size="xs" variant="default" disabled={off} onClick={() => tagged("untag")}>Untag</Button>
        <Button size="xs" variant="default" disabled={off} onClick={() => person("star", true)}>Star</Button>
        <Button size="xs" variant="default" disabled={off} onClick={() => person("unstar", true)}>Unstar</Button>
        <Button size="xs" variant="default" leftSection={<IconDownload size={14} />} onClick={onExport}>Export selected</Button>
        {rows.length === 2 ? <Button size="xs" variant="default" component="a" href={entityHash(rows[0].id)}>Merge on the record page</Button> : null}
        <Button size="xs" variant="subtle" color="gray" leftSection={<IconX size={14} />} onClick={onClear}>Clear selection</Button>
      </Group>
      {ask ? (
        <Alert color="yellow" mt="xs" role="alert">
          <Text size="sm">{ask.text}</Text>
          <Group gap="xs" mt="xs">
            <Button size="xs" onClick={ask.go}>Confirm</Button>
            <Button size="xs" variant="default" onClick={() => setAsk(null)}>Cancel</Button>
          </Group>
        </Alert>
      ) : null}
      {!allowed.ok ? <Text size="xs" c="dimmed" mt={4}>{allowed.reason}</Text> : null}
      {note ? <Text size="xs" c="red" mt={4} role="alert">{note}</Text> : null}
    </Paper>
  );
}
