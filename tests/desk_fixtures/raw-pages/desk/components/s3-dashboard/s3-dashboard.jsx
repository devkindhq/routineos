import { useEffect, useState } from "react";
import { Alert, Card, ColorSwatch, Group, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { BarChart, DonutChart, LineChart } from "@mantine/charts";
import { DatePickerInput } from "@mantine/dates";
import dayjs from "dayjs";
import { IconChartBar } from "@tabler/icons-react";

const SUM = { type: "task", x: "due", aggregate: { op: "sum", field: "amount" } };
const BY_STATUS = { type: "task", x: "status", aggregate: { op: "count" } };
const BY_OWNER = { type: "task", x: "owner", aggregate: { op: "count" } };
const COLORS = ["blue.6", "teal.6", "grape.6", "orange.6"];
const TOTAL_TILE = { kind: "tile", id: "s3-total", label: "Total amount (spec tile)", query: SUM };

function Tile({ label, value }) {
  return (
    <Card withBorder padding="md">
      <Text size="sm" c="dimmed">{label}</Text>
      <Text fz={28} fw={700}>{value}</Text>
    </Card>
  );
}

export default function Dashboard({ ctx, ui }) {
  const [range, setRange] = useState(["2026-10-01", "2026-12-31"]);
  const [data, setData] = useState(null);
  const [records, setRecords] = useState([]);
  const [failed, setFailed] = useState(null);

  useEffect(() => {
    let live = true;
    Promise.all([ctx.query(SUM), ctx.query(BY_STATUS), ctx.query(BY_OWNER), ctx.list({ type: "task" })]).then(
      ([sum, status, owner, list]) => { if (live) { setData({ sum: sum.rows, status: status.rows, owner: owner.rows }); setRecords(list); } },
      (err) => { if (live) setFailed(err && err.message ? err.message : "The query failed"); });
    return () => { live = false; };
  }, [ctx]);

  if (failed) return <Alert color="red" title="Could not load the dashboard">{failed}</Alert>;
  if (!data) return <Text c="dimmed">Loading</Text>;

  const from = range[0] ? dayjs(range[0]) : null;
  const to = range[1] ? dayjs(range[1]) : null;
  const line = data.sum
    .filter((p) => (!from || !dayjs(p.x).isBefore(from, "day")) && (!to || !dayjs(p.x).isAfter(to, "day")))
    .map((p) => ({ due: p.x, amount: p.y || 0 }));
  const total = line.reduce((n, p) => n + p.amount, 0);
  const done = (data.status.find((p) => p.x === "done") || {}).y || 0;
  const bar = data.status.map((p) => ({ status: p.x, tasks: p.y || 0 }));
  const donut = data.owner.map((p, i) => ({ name: p.x, value: p.y || 0, color: COLORS[i % COLORS.length] }));

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Group gap="xs"><IconChartBar size={20} /><Title order={3}>Task overview</Title></Group>
        <DatePickerInput type="range" label="Due between" value={range} onChange={setRange} valueFormat="D MMM YYYY" w={280} />
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 4 }}>
        <Tile label="Tasks" value={records.length} />
        <Tile label="Done" value={done} />
        <Tile label="Amount in range" value={total} />
        <ui.block spec={TOTAL_TILE} records={records} />
      </SimpleGrid>
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Card withBorder padding="md">
          <Text fw={600} mb="sm">Amount by due date</Text>
          <LineChart h={240} data={line} dataKey="due" series={[{ name: "amount", color: "blue.6" }]} curveType="linear" />
        </Card>
        <Card withBorder padding="md">
          <Text fw={600} mb="sm">Tasks by status</Text>
          <BarChart h={240} data={bar} dataKey="status" series={[{ name: "tasks", color: "teal.6" }]} />
        </Card>
      </SimpleGrid>
      <Card withBorder padding="md">
        <Text fw={600} mb="sm">Tasks by owner</Text>
        <Group justify="center"><DonutChart data={donut} withTooltip /></Group>
        <Group justify="center" gap="md" mt="sm">
          {donut.map((d) => (
            <Group key={d.name} gap={6} wrap="nowrap">
              <ColorSwatch color={`var(--mantine-color-${d.color.replace(".", "-")})`} size={12} />
              <Text size="sm">{d.name} ({d.value})</Text>
            </Group>
          ))}
        </Group>
      </Card>
    </Stack>
  );
}
