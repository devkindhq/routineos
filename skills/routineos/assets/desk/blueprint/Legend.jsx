// blueprint/Legend.jsx: what each border colour means.
import { Badge, Group } from "@mantine/core";
import { STATE_COLOR, STATE_LABEL } from "./kinds.js";

var ORDER = ["verified", "docs", "unverified", "needs-research", "needs-building", "conflict", "null"];

export default function Legend() {
  return (
    <Group gap="xs" aria-label="State colours" data-testid="bp-legend">
      {ORDER.map(function (s) {
        return <Badge key={s} variant="outline" color={STATE_COLOR[s]} size="sm">{STATE_LABEL[s]}</Badge>;
      })}
    </Group>
  );
}
