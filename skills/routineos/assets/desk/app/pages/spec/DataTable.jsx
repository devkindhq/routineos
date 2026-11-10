// app/pages/spec/DataTable.jsx: a table block of a spec page. Plain Mantine Table; every cell is text.
import { Anchor, Card, Stack, Table, Text, Title } from "@mantine/core";
import { browseText, rowValue } from "../../../core/pages/browse.js";
import { tableRows } from "../../../core/pages/spec-query.js";
import { entityHash } from "../../../core/shared.js";
import { EMPTY } from "./states.js";

export default function DataTable({ block, rows, ctx }) {
  var out = rows ? tableRows(rows, block.query, ctx) : [];
  var cols = Array.isArray(block.columns) ? block.columns : [];
  return (
    <Card withBorder padding="md" data-block={block.id}>
      <Stack gap="xs">
        {block.title ? <Title order={2} size="h4">{block.title}</Title> : null}
        {out.length === 0 ? <Text c="dimmed">{EMPTY}</Text> : (
          <Table.ScrollContainer minWidth={320}>
            <Table>
              <Table.Thead>
                <Table.Tr>{cols.map((c) => <Table.Th key={c}>{c}</Table.Th>)}</Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {out.map((r) => (
                  <Table.Tr key={r.id}>
                    {cols.map((c, i) => {
                      var text = browseText(rowValue(r, c));
                      return <Table.Td key={c}>{block.link && i === 0 && text ? <Anchor href={entityHash(r.id)}>{text}</Anchor> : text}</Table.Td>;
                    })}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Stack>
    </Card>
  );
}
