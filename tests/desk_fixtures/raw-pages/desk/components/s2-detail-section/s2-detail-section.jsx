import { Badge, Group, Stack, Text, Timeline } from "@mantine/core";
import { IconActivity } from "@tabler/icons-react";

const COLOR = { todo: "gray", doing: "blue", done: "teal" };

export default function DetailSection({ props }) {
  const given = (props && props.record) || {};
  const rec = given.data || given;
  const f = rec.display || {};
  const sightings = rec.sightings || [];
  return (
    <Stack gap="sm">
      <Group gap="xs">
        <IconActivity size={16} />
        <Badge color={COLOR[f.status] || "gray"} variant="light">{f.status}</Badge>
        <Text size="sm" c="dimmed">{sightings.length} sightings</Text>
      </Group>
      <Timeline active={sightings.length - 1} bulletSize={16} lineWidth={2}>
        {sightings.map((s, i) => (
          <Timeline.Item key={i} title={"Seen " + s.outcome}>
            <Text size="xs" c="dimmed">{s.at}</Text>
          </Timeline.Item>
        ))}
      </Timeline>
    </Stack>
  );
}
