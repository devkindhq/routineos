// app/Peek.jsx: a record in a side drawer, opened by ?peek=<id> (core/peek.js): its fields, its decision state with
// the Decision control, and its comments (base renderRecord compact). Previous and Next walk the list as filtered;
// Open record goes to the full page, where a drop takes its reason and comments are written.
import { useEffect, useState } from "react";
import { Anchor, Badge, Button, Drawer, Group, Stack, Text, Title } from "@mantine/core";
import { IconChevronLeft, IconChevronRight, IconExternalLink } from "@tabler/icons-react";
import { human } from "../core/dates.js";
import { decisionNow } from "../core/pages/entity.js";
import { peekPosition } from "../core/peek.js";
import { recordHref } from "../core/shared.js";
import DecisionControl, { KEEP_BADGES } from "./DecisionControl.jsx";
import { go } from "./useRoute.js";

// row: the flattened row; title: its title; fields: [{key, label, text}]; ids: the filtered ids in order.
// ctx: {store, viewer}; state: keepState of the record; decided: a person's decision exists; comments: commentView.
// A decision saved here reaches the list through its decisions watch, so onSaved is optional.
export default function Peek({ query, row, title, fields, ids, ctx, state, decided, comments, onMove, onClose, onSaved }) {
  var pos = row ? peekPosition(ids, row.id) : null;
  // Commenters' names, as on the record page; one who has none reads Someone (You for the viewer).
  const [profiles, setProfiles] = useState({});
  var by = (comments || []).map((c) => c.by).filter((v, i, a) => a.indexOf(v) === i).sort().join(",");
  useEffect(() => {
    var live = true;
    if (!by) { setProfiles({}); return undefined; }
    Promise.resolve(ctx.store.profiles(by.split(","))).then((p) => { if (live) setProfiles(p || {}); }, () => {});
    return () => { live = false; };
  }, [ctx.store, by]);
  function who(id) {
    var p = Object.prototype.hasOwnProperty.call(profiles, id) ? profiles[id] : null;
    return p && p.name ? p.name : id === ctx.viewer ? "You" : "Someone";
  }
  return (
    <Drawer opened={!!row} onClose={onClose} position="right" size="md" title={title} closeButtonProps={{ "aria-label": "Close" }}>
      {row ? (
        <Stack gap="sm">
          {pos.index !== null ? <Text size="sm" c="dimmed">{pos.index + 1} of {pos.total}</Text> : null}
          {fields.map((f) => (
            <div key={f.key}>
              <Text size="xs" c="dimmed">{f.label}</Text>
              <Text size="sm">{f.text === "" ? "-" : f.text}</Text>
            </div>
          ))}
          <Stack gap="xs">
            <Title order={2} size="h5">Decision</Title>
            <Group><Badge color={KEEP_BADGES[state][1]} variant="light">{KEEP_BADGES[state][0]}</Badge></Group>
            <DecisionControl ctx={ctx} id={row.id} value={decisionNow(state)} decided={decided}
              canDrop={state === "active" || state === "kept"} onDrop={() => { go(recordHref(row.id, query)); }}
              onSaved={onSaved} />
          </Stack>
          <Stack gap="xs">
            <Title order={2} size="h5">{"Comments (" + comments.length + ")"}</Title>
            {comments.length ? comments.map((c) => (
              <Stack key={c.id} gap={2}>
                <Text size="xs" c="dimmed">{who(c.by) + ", " + human(c.at, Date.now(), { style: "sentence" }) + (c.edited ? ", edited" : "")}</Text>
                <Text size="sm">{c.text}</Text>
              </Stack>
            )) : <Text size="sm" c="dimmed">No comments yet.</Text>}
          </Stack>
          <Group justify="space-between" mt="md">
            <Group gap="xs">
              <Button variant="default" size="xs" leftSection={<IconChevronLeft size={14} />} disabled={!pos.prev}
                onClick={() => onMove(pos.prev)}>Previous</Button>
              <Button variant="default" size="xs" rightSection={<IconChevronRight size={14} />} disabled={!pos.next}
                onClick={() => onMove(pos.next)}>Next</Button>
            </Group>
            <Anchor href={recordHref(row.id, query)} size="sm">
              <Group gap={4} component="span"><IconExternalLink size={14} />Open record</Group>
            </Anchor>
          </Group>
        </Stack>
      ) : null}
    </Drawer>
  );
}
