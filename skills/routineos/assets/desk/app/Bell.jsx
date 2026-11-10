// app/Bell.jsx: the shell's live data (saved views, pins, hidden modules, the notice feed and what waits for the
// viewer) and the bell that shows it (core/notify.js). Opening a notice marks it read for a signed-in viewer.
import { useEffect, useState } from "react";
import { ActionIcon, Drawer, Indicator, NavLink, ScrollArea, SegmentedControl, Stack, Text } from "@mantine/core";
import { IconBell } from "@tabler/icons-react";
import { idSet, markViewer, watchAll, withViewerState } from "../core/actions.js";
import { human } from "../core/dates.js";
import { NOTIF_ICONS, bellBadge, deriveNotifications, notifTab, unreadCount, waitingSummary } from "../core/notify.js";
import { deskModules, navHidden } from "../core/palette.js";
import { icon } from "./icons.js";
import { useModel } from "./StoreContext.jsx";

export var EMPTY_FEED = { views: [], pins: null, hidden: [], items: [], waiting: { count: 0, soon: null } };

export function useShellFeed(model) {
  const [feed, setFeed] = useState(EMPTY_FEED);
  useEffect(() => {
    if (!model || !model.definition || model.failed || !model.store) return undefined;
    var specs = withViewerState(model, {
      views: { collection: "views" }, inbox: { collection: "inbox" }, pending: { collection: "pending" },
      decisions: { collection: "decisions" }, runs: { collection: "runs" }, columns: { collection: "columns" },
    }, ["read", "pin"]);
    if (model.viewer) specs.mine = { collection: "people/" + model.viewer + "/decisions" };
    // Only a definition with desk modules has a module to hide; only its settings/workspace doc is kept.
    if (deskModules(model.definition).length) specs.settings = { collection: "settings" };
    return watchAll(model, specs, (got) => {
      setFeed({
        views: got.views || [],
        pins: idSet(got.pin),
        hidden: navHidden(got.settings),
        items: deriveNotifications({
          inbox: got.inbox, pending: got.pending, decisions: idSet(got.decisions), runs: got.runs,
          producers: model.definition.producers || [], read: idSet(got.read) || new Set(),
        }),
        waiting: waitingSummary({
          pending: got.pending, inbox: got.inbox, views: got.views, columns: got.columns, decisions: got.decisions,
          personDecisions: got.mine || [], runs: got.runs,
        }, undefined, model.viewer),
      });
    });
  }, [model]);
  return feed;
}

export default function Bell({ feed, opened, onChange }) {
  const model = useModel();
  const [tab, setTab] = useState("all");
  const badge = bellBadge(feed.waiting.count, unreadCount(feed.items));
  const items = notifTab(feed.items, tab);
  function open(n) {
    if (n.unread && model && model.viewer) markViewer(model, "read", n.readId, true).catch(() => {});
    onChange(false);
  }
  return (
    <Indicator label={badge.text || undefined} disabled={!badge.text && !badge.dot} size={badge.text ? 16 : 8} offset={4}>
      <ActionIcon data-tour="bell" variant="subtle" color="gray" size="lg" aria-label={badge.label} aria-haspopup="dialog"
        aria-expanded={!!opened} onClick={() => onChange(!opened)}>
        <IconBell size={20} stroke={1.5} />
      </ActionIcon>
      <Drawer opened={opened} onClose={() => onChange(false)} position="right" size="min(380px, 100%)" title="Notifications">
        <Stack gap="xs">
          {feed.waiting.count ? (
            <NavLink href="#/approvals" label={feed.waiting.count + " waiting for you"}
              description={feed.waiting.soon ? feed.waiting.soon.label : undefined} onClick={() => onChange(false)} />
          ) : null}
          <SegmentedControl size="xs" value={tab} onChange={setTab}
            data={[{ label: "All", value: "all" }, { label: "Unread", value: "unread" }]} />
          {items.length ? (
            <ScrollArea.Autosize mah={360}>
              {items.map((n) => {
                var Icon = icon(NOTIF_ICONS[n.kind]);
                return (
                  <NavLink key={n.id} href={n.href} onClick={() => open(n)} leftSection={<Icon size={16} stroke={1.5} />}
                    label={<Text size="sm" fw={n.unread ? 600 : 400}>{n.title}</Text>}
                    description={human(n.at, Date.now(), { style: "sentence" })} />
                );
              })}
            </ScrollArea.Autosize>
          ) : (
            <Text c="dimmed" size="sm">{tab === "unread" ? "Nothing unread." : "Nothing new this week."}</Text>
          )}
        </Stack>
      </Drawer>
    </Indicator>
  );
}
