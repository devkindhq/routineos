// app/pages/spec/TextBlock.jsx: a text block of a spec page, an optional heading and Markdown text. Raw HTML in the
// text shows as plain text (components/Markdown.jsx).
import { Card, Stack, Title } from "@mantine/core";
import Markdown from "../../components/Markdown.jsx";

export default function TextBlock({ block }) {
  return (
    <Card withBorder padding="md" data-block={block.id}>
      <Stack gap="xs">
        {block.heading ? <Title order={2} size="h4">{block.heading}</Title> : null}
        <Markdown text={String(block.text || "")} />
      </Stack>
    </Card>
  );
}
