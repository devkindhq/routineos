import { useState } from "react";
import { Accordion, Button, Group, Modal, NumberInput, SegmentedControl, Stack, Text } from "@mantine/core";
import { IconSettings } from "@tabler/icons-react";

export default function Settings({ ctx }) {
  const [density, setDensity] = useState(ctx.pref("density", "comfortable"));
  const [size, setSize] = useState(Number(ctx.pref("page-size", "10")) || 10);
  const [confirm, setConfirm] = useState(false);

  function pickDensity(v) { setDensity(v); ctx.setPref("density", v); }
  function pickSize(v) {
    const n = Number(v) || 10;
    setSize(n);
    ctx.setPref("page-size", String(n));
  }
  function reset() {
    pickDensity("comfortable");
    pickSize(10);
    setConfirm(false);
  }

  return (
    <Stack gap="md" maw={560}>
      <Group gap="xs"><IconSettings size={18} /><Text c="dimmed" size="sm">Kept in this browser only.</Text></Group>
      <Accordion defaultValue="layout" variant="separated">
        <Accordion.Item value="layout">
          <Accordion.Control>Layout</Accordion.Control>
          <Accordion.Panel>
            <Stack gap="xs">
              <Text size="sm">Row density</Text>
              <SegmentedControl value={density} onChange={pickDensity} data={["compact", "comfortable", "spacious"]} />
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
        <Accordion.Item value="lists">
          <Accordion.Control>Lists</Accordion.Control>
          <Accordion.Panel>
            <NumberInput label="Rows per page" min={5} max={100} step={5} value={size} onChange={pickSize} />
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
      <Group>
        <Button color="red" variant="light" onClick={() => setConfirm(true)}>Reset to defaults</Button>
      </Group>
      <Modal opened={confirm} onClose={() => setConfirm(false)} title="Reset settings">
        <Stack gap="md">
          <Text>Reset density and rows per page to their defaults?</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button color="red" onClick={reset}>Reset</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
