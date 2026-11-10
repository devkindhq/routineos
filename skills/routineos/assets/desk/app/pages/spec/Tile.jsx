// app/pages/spec/Tile.jsx: one number of a spec page: the label, the value, and its change against the window before
// as a number, an arrow and the word up or down (never colour alone), and an optional sparkline.
import { Sparkline } from "@mantine/charts";
import { Card, Group, Stack, Text } from "@mantine/core";
import { aggregateTile } from "../../../core/pages/spec-query.js";
import { EMPTY, skippedNote } from "./states.js";

function format(v, kind) {
  var n = Number(v);
  var text = n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (kind === "percent") return text + "%";
  if (kind === "currency") return "$" + text;
  return text;
}

var ARROWS = { up: "↑", down: "↓", flat: "→" };

function changeLine(change) {
  if (!change || change.pct === null || !change.direction) return "no change data";
  if (change.direction === "flat") return ARROWS.flat + " no change";
  var shown = Math.abs(Math.round(change.pct * 10) / 10);
  if (shown === 0) return ARROWS[change.direction] + " under 0.1% " + change.direction;
  return ARROWS[change.direction] + " " + shown + "% " + change.direction;
}

export default function Tile({ block, rows, ctx }) {
  var t = rows ? aggregateTile(rows, block.query, ctx) : null;
  var has = t && t.value !== null;
  return (
    <Card withBorder padding="md" data-block={block.id}>
      <Stack gap={4}>
        <Text size="sm" c="dimmed">{block.label}</Text>
        {has ? (
          <Group gap="xs" align="baseline">
            <Text fz={28} fw={700} lh={1.1}>{format(t.value, block.format)}</Text>
            <Text size="sm" c="dimmed">{changeLine(t.change)}</Text>
          </Group>
        ) : <Text c="dimmed">{EMPTY}</Text>}
        {t && t.skipped > 0 ? <Text size="xs" c="dimmed">{skippedNote(t.skipped)}</Text> : null}
        {has && block.sparkline && t.spark.length > 1 ? <Sparkline h={32} data={t.spark} aria-hidden /> : null}
      </Stack>
    </Card>
  );
}
