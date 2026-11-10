// app/settings/common.jsx: what every Settings section shares: the write context, the section frame, the read-only
// reason, the failed-write toast and a watch over several collections.
import { useEffect, useState } from "react";
import { Card, Stack, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { canWrite, watchAll, writeMessage } from "../../core/actions.js";
import { StateView } from "../States.jsx";
import { usePageCtx, useStore } from "../StoreContext.jsx";

export function useCtx() {
  return usePageCtx();
}

export function Section({ id, title, note, children }) {
  return (
    <Card withBorder padding="md" component="section" data-section={id} aria-labelledby={"settings-" + id}>
      <Stack gap="sm">
        <Title id={"settings-" + id} order={2} size="h3">{title}</Title>
        {note ? <Text size="sm" c="dimmed">{note}</Text> : null}
        {children}
      </Stack>
    </Card>
  );
}

// Why this visit cannot change anything here, or nothing when it can.
export function ReadOnlyReason({ ctx }) {
  var w = canWrite(ctx);
  return w.ok ? null : <Text size="sm" c="dimmed" role="status">{w.reason + ". These values are shown read only."}</Text>;
}

export function failToast(e) {
  notifications.show({ color: "red", title: "Not saved", message: writeMessage(e) });
}

// A write that saved but missed its settings history entry (e.partial) is kept and says so.
export function partialToast(e) {
  notifications.show({ color: "yellow", message: writeMessage(e) });
}

// specs: {name: {collection}}. Resolves {got, failed, retry}; got is null until every collection answered.
export function useWatch(specs, deps) {
  const store = useStore();
  const [got, setGot] = useState(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    var live = true;
    var stop = watchAll({ store: store }, specs, (g) => { if (live) { setGot(Object.assign({}, g)); setFailed(false); } },
      () => { if (live) setFailed(true); });
    return () => { live = false; stop(); };
  }, [store, tick].concat(deps || []));
  return { got: got, failed: failed, retry: () => setTick(tick + 1) };
}

// The loading or error state for a watch, or null once it has answered.
export function WatchState({ w, label }) {
  if (w.failed && !w.got) return <StateView kind="error" collection={label} onRetry={w.retry} />;
  if (!w.got) return <StateView kind="loading" label={label} />;
  return null;
}
