// app/pages/spec/Board.jsx: a board block of a spec page. Read-only lanes (block.columns or the choices of the groupBy
// field), each card a title, optional text and up to three badges. Every value is text; nothing here writes.
import { Anchor, Badge, Card, Group, ScrollArea, Stack, Text, Title } from "@mantine/core";
import { browseText, rowValue } from "../../../core/pages/browse.js";
import { boardLanes } from "../../../core/pages/spec-query.js";
import { entityHash } from "../../../core/shared.js";
import { useModel } from "../../StoreContext.jsx";
import { EMPTY } from "./states.js";

var BADGES_MAX = 3;

function choicesOf(model, block) {
  var type = model && model.definition && model.definition.types && model.definition.types[block.query.type];
  var field = type && type.fields && type.fields[block.query.groupBy];
  return field && field.type === "choice" && Array.isArray(field.choices) ? field.choices : [];
}

function cell(row, field) {
  var v = rowValue(row, field);
  return browseText(v === undefined ? row[field] : v);
}

export default function Board({ block, rows, ctx }) {
  var model = useModel();
  var lanes = rows ? boardLanes(rows, block, ctx, choicesOf(model, block)) : [];
  var card = block.card || {};
  var total = lanes.reduce((n, l) => n + l.cards.length, 0);
  return (
    <Card withBorder padding="md" data-block={block.id}>
      <Stack gap="xs">
        {block.title ? <Title order={2} size="h4">{block.title}</Title> : null}
        {total === 0 ? <Text c="dimmed">{EMPTY}</Text> : (
          <ScrollArea type="auto">
            <Group align="flex-start" wrap="nowrap" gap="md">
              {lanes.map((lane) => (
                <Stack key={lane.value || "(other)"} gap="xs" w={240} flex="0 0 240px" data-lane={lane.value}>
                  <Group justify="space-between" gap="xs">
                    <Text fw={600} size="sm">{lane.title}</Text>
                    <Text size="xs" c="dimmed">{lane.cards.length}</Text>
                  </Group>
                  {lane.cards.map((r) => {
                    var title = cell(r, card.title);
                    var text = card.text ? cell(r, card.text) : "";
                    var badges = (card.badges || []).slice(0, BADGES_MAX).map((f) => cell(r, f)).filter((t) => t !== "");
                    return (
                      <Card key={r.id} withBorder padding="xs" data-card={r.id}>
                        <Stack gap={4}>
                          <Text fw={500} size="sm">{block.link && title ? <Anchor href={entityHash(r.id)}>{title}</Anchor> : title}</Text>
                          {text ? <Text size="xs" c="dimmed">{text}</Text> : null}
                          {badges.length ? <Group gap={4}>{badges.map((b, i) => <Badge key={i} variant="light" size="sm">{b}</Badge>)}</Group> : null}
                        </Stack>
                      </Card>
                    );
                  })}
                </Stack>
              ))}
            </Group>
          </ScrollArea>
        )}
      </Stack>
    </Card>
  );
}
