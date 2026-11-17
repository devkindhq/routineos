import { Component } from "react";
import { Paper, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import {
  AreaChart, AreaGradient, BarChart, BarsList, BubbleChart, BulletChart, CandlestickChart, ChartBrush, ChartLegend,
  ChartTooltip, CompositeChart, DonutChart, FunnelChart, GaugeChart, Heatmap, LineChart, MatrixChart, PieChart,
  RadarChart, RadialBarChart, SankeyChart, ScatterChart, Sparkline, SunburstChart, Treemap, WaffleChart,
} from "@mantine/charts";

// One labelled cell per component. data-cell lists the component names the cell covers; a cell that throws shows
// data-cell-failed instead of taking the whole page down, so the verification run can name the component.
class CellBoundary extends Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (this.state.err) return <Text c="red" data-cell-failed={this.props.name}>FAILED {this.props.name}: {String(this.state.err.message)}</Text>;
    return this.props.children;
  }
}
function Cell({ name, children }) {
  return (
    <Paper withBorder p="xs" data-cell={name}>
      <Text size="xs" ff="monospace" c="dimmed" mb={6}>{name}</Text>
      <CellBoundary name={name}>{children}</CellBoundary>
    </Paper>
  );
}

const week = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day, i) => ({
  day, tasks: [12, 18, 9, 22, 15, 7, 11][i], done: [8, 11, 6, 15, 9, 4, 8][i], hours: [4, 6, 3, 8, 5, 2, 4][i],
}));
const series2 = [{ name: "tasks", color: "blue.6" }, { name: "done", color: "teal.6" }];
const slices = [
  { name: "todo", value: 14, color: "blue.6" },
  { name: "doing", value: 9, color: "yellow.6" },
  { name: "done", value: 22, color: "teal.6" },
];
const candles = [
  { day: "Mon", open: 10, high: 14, low: 8, close: 13 },
  { day: "Tue", open: 13, high: 15, low: 11, close: 12 },
  { day: "Wed", open: 12, high: 16, low: 10, close: 15 },
  { day: "Thu", open: 15, high: 17, low: 13, close: 14 },
  { day: "Fri", open: 14, high: 18, low: 12, close: 17 },
];
const heat = {};
for (let i = 0; i < 90; i++) {
  const d = new Date(Date.UTC(2026, 7, 1 + i));
  heat[d.toISOString().slice(0, 10)] = (i * 7) % 11;
}
const matrix = [];
["A", "B", "C", "D"].forEach((x, xi) => ["P", "Q", "R"].forEach((y, yi) => matrix.push({ x, y, value: (xi + 1) * (yi + 2) })));

export default function ChartsShowcase() {
  return (
    <Stack gap="md">
      <Title order={3}>Charts showcase</Title>
      <Text size="sm" c="dimmed">All 26 @mantine/charts exports with demo data. Components covered are listed in each cell.</Text>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
        <Cell name="AreaChart AreaGradient">
          <AreaChart h={180} data={week} dataKey="day" series={series2} curveType="linear" withGradient />
          <svg width="100%" height="24" aria-label="AreaGradient swatch">
            <defs><AreaGradient id="showcase-grad" color="var(--mantine-color-blue-6)" withGradient fillOpacity={0.4} /></defs>
            <rect width="100%" height="24" fill="url(#showcase-grad)" />
          </svg>
        </Cell>
        <Cell name="BarChart">
          <BarChart h={180} data={week} dataKey="day" series={series2} />
        </Cell>
        <Cell name="LineChart ChartBrush">
          <LineChart h={180} data={week} dataKey="day" series={series2} curveType="linear" withBrush />
          <svg width="100%" height="40" aria-label="ChartBrush"><ChartBrush data={week} dataKey="day" x={0} y={0} width={260} height={30} /></svg>
        </Cell>
        <Cell name="CompositeChart">
          <CompositeChart h={180} data={week} dataKey="day" maxBarWidth={20}
            series={[{ name: "tasks", color: "blue.6", type: "bar" }, { name: "done", color: "teal.6", type: "line" }, { name: "hours", color: "orange.6", type: "area" }]} />
        </Cell>
        <Cell name="ScatterChart">
          <ScatterChart h={180} dataKey={{ x: "tasks", y: "done" }} data={[{ color: "blue.6", name: "weeks", data: week }]} />
        </Cell>
        <Cell name="BubbleChart">
          <BubbleChart h={180} data={week} range={[16, 225]} label="hours" color="violet.6" dataKey={{ x: "day", y: "tasks", z: "hours" }} />
        </Cell>
        <Cell name="PieChart">
          <PieChart data={slices} withTooltip withLabels size={160} />
        </Cell>
        <Cell name="DonutChart">
          <DonutChart data={slices} withTooltip withLegend size={140} chartLabel="45" />
        </Cell>
        <Cell name="RadarChart">
          <RadarChart h={200} data={week} dataKey="day" series={[{ name: "tasks", color: "blue.6", opacity: 0.2 }]} withPolarRadiusAxis />
        </Cell>
        <Cell name="RadialBarChart">
          <RadialBarChart h={200} data={slices.map((s) => ({ name: s.name, value: s.value, fill: "var(--mantine-color-" + s.color.split(".")[0] + "-6)" }))} dataKey="value" withLabels />
        </Cell>
        <Cell name="FunnelChart">
          <FunnelChart data={[{ name: "Leads", value: 400, color: "blue.6" }, { name: "Trials", value: 250, color: "teal.6" }, { name: "Paid", value: 90, color: "orange.6" }]} size={150} withLabels />
        </Cell>
        <Cell name="Treemap">
          <Treemap height={180} data={[{ name: "Docs", value: 40, color: "blue.6" }, { name: "Code", value: 30, color: "teal.6" }, { name: "Media", value: 18, color: "orange.6" }, { name: "Other", value: 8, color: "grape.6" }]} />
        </Cell>
        <Cell name="SunburstChart">
          <SunburstChart size={180} data={[{ name: "Work", color: "blue.6", children: [{ name: "A", value: 10, color: "blue.4" }, { name: "B", value: 14, color: "blue.8" }] }, { name: "Home", color: "teal.6", children: [{ name: "C", value: 9, color: "teal.4" }] }]} />
        </Cell>
        <Cell name="SankeyChart">
          <SankeyChart height={180} data={{ nodes: [{ name: "Leads", color: "blue.6" }, { name: "Trial", color: "teal.6" }, { name: "Paid", color: "orange.6" }, { name: "Lost", color: "gray.6" }], links: [{ source: 0, target: 1, value: 60 }, { source: 1, target: 2, value: 25 }, { source: 1, target: 3, value: 35 }, { source: 0, target: 3, value: 20 }] }} />
        </Cell>
        <Cell name="Sparkline">
          <Sparkline w={200} h={60} data={[3, 7, 5, 11, 9, 14, 12]} withGradient />
        </Cell>
        <Cell name="GaugeChart">
          <GaugeChart value={64} size={160} label="64%" sections={[{ value: 40, color: "red.6" }, { value: 30, color: "yellow.6" }, { value: 30, color: "teal.6" }]} />
        </Cell>
        <Cell name="BulletChart">
          <BulletChart value={72} target={80} label="Revenue" ranges={[{ value: 50, color: "red.2" }, { value: 80, color: "yellow.2" }, { value: 100, color: "teal.2" }]} />
        </Cell>
        <Cell name="Heatmap">
          <Heatmap data={heat} startDate="2026-08-01" endDate="2026-10-29" withMonthLabels withWeekdayLabels />
        </Cell>
        <Cell name="MatrixChart">
          <MatrixChart data={matrix} xLabels={["A", "B", "C", "D"]} yLabels={["P", "Q", "R"]} withLegend />
        </Cell>
        <Cell name="WaffleChart">
          <WaffleChart data={[{ name: "done", value: 55, color: "teal.6" }, { name: "doing", value: 25, color: "yellow.6" }]} rows={10} columns={10} total={100} withLegend size={150} />
        </Cell>
        <Cell name="CandlestickChart">
          <CandlestickChart h={180} data={candles} dataKey="day" dataKeys={{ open: "open", high: "high", low: "low", close: "close" }} />
        </Cell>
        <Cell name="BarsList">
          <BarsList barsLabel="Page" valueLabel="Views" data={[{ name: "/pricing", value: 420 }, { name: "/docs", value: 310 }, { name: "/blog", value: 150 }]} />
        </Cell>
        <Cell name="ChartLegend">
          <ChartLegend payload={[{ value: "tasks", dataKey: "tasks", color: "blue.6" }, { value: "done", dataKey: "done", color: "teal.6" }]} onHighlight={() => {}} legendPosition="top" series={series2} />
        </Cell>
        <Cell name="ChartTooltip">
          <ChartTooltip label="Mon" payload={[{ name: "tasks", dataKey: "tasks", value: 12, color: "blue.6", payload: { tasks: 12, done: 8 } }, { name: "done", dataKey: "done", value: 8, color: "teal.6", payload: { tasks: 12, done: 8 } }]} series={series2} />
        </Cell>
      </SimpleGrid>
    </Stack>
  );
}
