// app/settings/tour.jsx: take the starter tour again, and the owner's switch that turns it off or on for everyone
// (settings/workspace values.tour).
import { useState } from "react";
import { Button, Group, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { canWrite, isDeskOwner, writeSettings } from "../../core/actions.js";
import { WORKSPACE_SETTINGS } from "../../core/pages/settings.js";
import { useModel, usePatchModel } from "../StoreContext.jsx";
import { useTour } from "../Tour.jsx";
import { Section, failToast, partialToast, useCtx } from "./common.jsx";

export default function Tour() {
  const ctx = useCtx();
  const model = useModel();
  const patch = usePatchModel();
  const tour = useTour();
  const [busy, setBusy] = useState(false);
  if (!model.tour) {
    return <Section id="tour" title="Starter tour"><Text c="dimmed">This Desk was built without the starter tour.</Text></Section>;
  }
  var off = !!model.tourOff;
  var owner = isDeskOwner(ctx) && !ctx.ownerTampered && canWrite(ctx).ok;
  function flip() {
    setBusy(true);
    writeSettings(ctx, WORKSPACE_SETTINGS, { tour: off }).then(() => {
      setBusy(false);
      patch({ tourOff: !off });
      notifications.show({ message: off ? "The starter tour is on." : "The starter tour is off." });
    }, (e) => {
      setBusy(false);
      if (e && e.partial) { patch({ tourOff: !off }); partialToast(e); return; }
      failToast(e);
    });
  }
  return (
    <Section id="tour" title="Starter tour" note="Five short steps over Today, Approvals, the lists, the peek and the bell.">
      {off ? <Text>The starter tour is off for everyone.</Text> : null}
      <Group gap="xs">
        {!off ? <Button variant="default" onClick={tour.start}>Take the tour</Button> : null}
        {owner ? <Button variant="light" loading={busy} onClick={flip}>{off ? "Turn the tour on" : "Turn the tour off"}</Button> : null}
      </Group>
    </Section>
  );
}
