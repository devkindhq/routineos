// app/pages/spec/ChartBlock.jsx: a chart block of a spec page: Mantine LineChart, BarChart (grouped, stacked or share)
// or Sparkline over the points of its query. A figure with a name and a one sentence summary; a "Show as table"
// switch swaps the chart for the same numbers in a table, so nothing depends on seeing it. Names and values are text.
import { useState } from "react";
import { BarChart, LineChart, Sparkline } from "@mantine/charts";
import { Box, Card, Stack, Switch, Table, Text, Title } from "@mantine/core";
import { chartData, sparkValues } from "./chartData.js";
import { EMPTY, skippedNote } from "./states.js";

var BAR_TYPES = { bar: "default", stackedBar: "stacked", shareBar: "percent" };

function cellText(v) {
  return v === null || v === undefined ? "" : String(Math.round(v * 100) / 100);
}

function unitOf(spec) {
  var w = spec.query && spec.query.window;
  return w && w.last ? w.last.unit : "points";
}

function TableView({ out }) {
  return (
    <Table.ScrollContainer minWidth={280}>
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{"x"}</Table.Th>
            {out.series.map((s) => <Table.Th key={s.name}>{s.name}</Table.Th>)}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {out.tableRows.map((r) => (
            <Table.Tr key={r.x}>
              <Table.Td>{r.x}</Table.Td>
              {out.series.map((s) => <Table.Td key={s.name}>{cellText(r[s.name])}</Table.Td>)}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

function Drawing({ spec, out, points }) {
  var series = out.series.map((s) => ({ name: s.name, color: s.color, strokeDasharray: s.dash || undefined }));
  var common = { h: 240, data: out.data, dataKey: "x", series: series, withLegend: true, xAxisLabel: spec.xLabel, yAxisLabel: spec.yLabel,
    "aria-hidden": true };
  if (spec.type === "sparkline") return <Sparkline h={48} data={sparkValues(points)} aria-hidden />;
  if (BAR_TYPES[spec.type]) {
    return <BarChart {...common} type={BAR_TYPES[spec.type]} series={out.series.map((s) => ({ name: s.name, color: s.color }))} />;
  }
  return <LineChart {...common} curveType="linear" />;
}

export default function ChartBlock({ spec, points, skipped }) {
  var [asTable, setAsTable] = useState(false);
  var title = spec.title || "Chart";
  if (!points || points.length === 0) {
    return (
      <Card withBorder padding="md" data-block={spec.id}>
        <Stack gap="xs">
          <Title order={2} size="h4">{title}</Title>
          <Text c="dimmed">{EMPTY}</Text>
          {skipped > 0 ? <Text size="xs" c="dimmed">{skippedNote(skipped)}</Text> : null}
        </Stack>
      </Card>
    );
  }
  var out = chartData(points, spec.type, { title: title, unit: unitOf(spec) });
  return (
    <Card withBorder padding="md" data-block={spec.id}>
      <Box component="figure" m={0} aria-label={title}>
        <Stack gap="xs">
          <Title order={2} size="h4">{title}</Title>
          <Text size="sm" c="dimmed" component="figcaption">{out.summary}</Text>
          {skipped > 0 ? <Text size="xs" c="dimmed">{skippedNote(skipped)}</Text> : null}
          {asTable ? <TableView out={out} /> : <Drawing spec={spec} out={out} points={points} />}
          <Switch label="Show as table" checked={asTable} onChange={(e) => setAsTable(e.currentTarget.checked)} />
        </Stack>
      </Box>
    </Card>
  );
}
