import { useEffect, useState } from "react";
import { ActionIcon, Badge, Card, Group, Menu, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconArrowRight, IconDots } from "@tabler/icons-react";

const COLUMNS = ["todo", "doing", "done"];
const COLOR = { todo: "gray", doing: "blue", done: "teal" };

export default function Board({ ctx }) {
  const [records, setRecords] = useState(null);
  const [moved, setMoved] = useState({});

  useEffect(() => {
    let live = true;
    ctx.list({ type: "task" }).then((rows) => { if (live) setRecords(rows); });
    return () => { live = false; };
  }, [ctx]);

  if (!records) return <Text c="dimmed">Loading</Text>;
  const cards = records.map((r) => ({ id: r.id, f: r.data.display, status: moved[r.id] || r.data.display.status }));

  function move(card, to) {
    ctx.actions.saveField(card.id, "status", to).then(
      () => setMoved((m) => Object.assign({}, m, { [card.id]: to })),
      (err) => notifications.show({ color: "red", title: "Not saved", message: err.message }));
  }

  return (
    <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
      {COLUMNS.map((col) => {
        const mine = cards.filter((c) => c.status === col);
        return (
          <Stack key={col} gap="sm">
            <Group justify="space-between">
              <Title order={4} tt="capitalize">{col}</Title>
              <Badge color={COLOR[col]} variant="light">{mine.length}</Badge>
            </Group>
            {mine.slice(0, 8).map((c) => (
              <Card key={c.id} withBorder padding="sm">
                <Group justify="space-between" wrap="nowrap" align="flex-start">
                  <Stack gap={2}>
                    <Text fw={600} size="sm">{c.f.title}</Text>
                    <Text size="xs" c="dimmed">{c.f.owner} - due {c.f.due}</Text>
                  </Stack>
                  <Menu position="bottom-end" withinPortal>
                    <Menu.Target>
                      <ActionIcon variant="subtle" aria-label={"Move " + c.f.title}><IconDots size={16} /></ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Label>Move to</Menu.Label>
                      {COLUMNS.filter((x) => x !== c.status).map((x) => (
                        <Menu.Item key={x} leftSection={<IconArrowRight size={14} />} onClick={() => move(c, x)}>{x}</Menu.Item>
                      ))}
                    </Menu.Dropdown>
                  </Menu>
                </Group>
              </Card>
            ))}
            {mine.length > 8 ? <Text size="xs" c="dimmed">and {mine.length - 8} more</Text> : null}
          </Stack>
        );
      })}
    </SimpleGrid>
  );
}
