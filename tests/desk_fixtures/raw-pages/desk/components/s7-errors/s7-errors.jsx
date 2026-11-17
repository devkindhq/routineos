import { useState } from "react";
import { Alert, Button, Group, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAlertCircle, IconBell, IconBug, IconCheck } from "@tabler/icons-react";

export default function Errors({ ctx }) {
  const [boom, setBoom] = useState(false);
  const [refused, setRefused] = useState(null);

  // A button sets this; the next render throws and the Desk's error boundary shows Try again.
  if (boom) throw new Error("S7 test error: the page threw on purpose");

  function tryWrite() {
    ctx.actions.saveField("task--t01", "status", "done").then(
      () => { setRefused(null); notifications.show({ color: "teal", title: "Saved", message: "The write went through" }); },
      (err) => {
        setRefused(err.message);
        notifications.show({ color: "red", title: "Not saved", message: err.message });
      });
  }

  return (
    <Stack gap="md" maw={560}>
      <Group gap="xs"><IconBell size={18} /><Text>Notifications</Text></Group>
      <Group>
        <Button leftSection={<IconCheck size={16} />} color="teal"
          onClick={() => notifications.show({ color: "teal", title: "All good", message: "This is a success notification" })}>
          Show success
        </Button>
        <Button leftSection={<IconAlertCircle size={16} />} color="red" variant="light"
          onClick={() => notifications.show({ color: "red", title: "Something failed", message: "This is an error notification" })}>
          Show error
        </Button>
      </Group>
      <Group gap="xs"><IconBug size={18} /><Text>Writes and errors</Text></Group>
      <Group>
        <Button variant="default" onClick={tryWrite}>Try a write</Button>
        <Button color="orange" variant="light" onClick={() => setBoom(true)}>Throw on next render</Button>
      </Group>
      {refused ? <Alert color="red" title="Not saved" icon={<IconAlertCircle size={16} />}>{refused}</Alert> : null}
    </Stack>
  );
}
