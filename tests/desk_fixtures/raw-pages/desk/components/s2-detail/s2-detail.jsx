import { useEffect, useState } from "react";
import { Badge, Button, Drawer, Group, Modal, Stack, Tabs, Text, TextInput, Timeline, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconActivity, IconEdit, IconInfoCircle, IconList } from "@tabler/icons-react";

const COLOR = { todo: "gray", doing: "blue", done: "teal" };

export default function Detail({ ctx, ui, props }) {
  const wanted = props && props.args && props.args[0];
  const [id, setId] = useState(wanted || null);
  const [rec, setRec] = useState(undefined);
  const [drawer, drawerCtl] = useDisclosure(false);
  const [modal, modalCtl] = useDisclosure(false);

  useEffect(() => {
    let live = true;
    if (wanted) {
      ctx.read(wanted).then((d) => { if (live) { setId(wanted); setRec(d); } });
    } else {
      ctx.list({ type: "task" }).then((rows) => {
        if (live && rows.length) { setId(rows[0].id); setRec(rows[0].data); } else if (live) setRec(null);
      });
    }
    return () => { live = false; };
  }, [ctx, wanted]);

  if (rec === undefined) return <Text c="dimmed">Loading</Text>;
  if (rec === null) return <Text>That task does not exist.</Text>;
  const f = rec.display || {};
  const sightings = rec.sightings || [];

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Group gap="sm">
          <Title order={2}>{f.title}</Title>
          <Badge color={COLOR[f.status] || "gray"} variant="light">{f.status}</Badge>
        </Group>
        <Group gap="xs">
          <Button variant="default" leftSection={<IconInfoCircle size={16} />} onClick={drawerCtl.open}>All fields</Button>
          <Button leftSection={<IconEdit size={16} />} onClick={modalCtl.open}>Edit</Button>
        </Group>
      </Group>

      <Tabs defaultValue="summary">
        <Tabs.List>
          <Tabs.Tab value="summary" leftSection={<IconList size={16} />}>Summary</Tabs.Tab>
          <Tabs.Tab value="activity" leftSection={<IconActivity size={16} />}>Activity</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="summary" pt="md">
          <Stack gap="xs">
            <Text>Owner: {f.owner}</Text>
            <Text>Due: {f.due}</Text>
            <Text>Amount: {f.amount}</Text>
            <Text size="sm" c="dimmed">Record {id}</Text>
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="activity" pt="md">
          <Timeline active={sightings.length - 1} bulletSize={20} lineWidth={2}>
            {sightings.map((s, i) => (
              <Timeline.Item key={i} title={"Seen " + s.outcome}>
                <Text size="sm" c="dimmed">{s.at} by {s.producer}</Text>
              </Timeline.Item>
            ))}
          </Timeline>
        </Tabs.Panel>
      </Tabs>

      <Drawer opened={drawer} onClose={drawerCtl.close} position="right" title="Record fields">
        <Stack gap="xs">
          {Object.keys(f).map((k) => (
            <Group key={k} justify="space-between">
              <Text fw={600}>{k}</Text>
              <Text>{String(f[k])}</Text>
            </Group>
          ))}
        </Stack>
      </Drawer>

      <Modal opened={modal} onClose={modalCtl.close} title="Edit task">
        <Stack gap="sm">
          <TextInput label="Title" defaultValue={f.title} />
          <TextInput label="Owner" defaultValue={f.owner} />
          <Text size="xs" c="dimmed">Edits are not saved on this page.</Text>
          <Group justify="flex-end">
            <Button onClick={modalCtl.close}>Close</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
