// blueprint/Requirements.jsx: the requirements the routine is meant to meet. Choosing one shows the parts that serve it.
import { Badge, Group, Stack, Text, Title, UnstyledButton } from "@mantine/core";

export default function Requirements({ requirements, selected, highlighted, onSelect, onShowAll }) {
  if (!requirements.length) return null;
  return (
    <Stack gap="xs" data-testid="bp-requirements">
      <Group justify="space-between" gap="sm">
        <Title order={2} size="h4">Requirements</Title>
        {selected ? <UnstyledButton data-testid="bp-showall" onClick={onShowAll} c="var(--mantine-color-anchor)" fz="sm" fw={600}>Show all</UnstyledButton> : null}
      </Group>
      {requirements.map(function (r) {
        var on = selected === r.id;
        var hl = highlighted.indexOf(r.id) !== -1;
        return (
          <UnstyledButton
            key={r.id}
            data-testid={"bp-req-" + r.id}
            aria-pressed={on}
            data-highlighted={hl}
            onClick={function () { onSelect(r.id); }}
            p="sm"
            style={{
              borderRadius: 8, border: "1px solid var(--mantine-color-default-border)", textAlign: "left",
              background: on || hl ? "var(--mantine-color-default-hover)" : "transparent",
              outline: on ? "2px solid var(--mantine-primary-color-filled)" : "none",
            }}
          >
            <Group gap="sm" wrap="wrap" justify="space-between">
              <Text size="sm">{r.text}</Text>
              {r.origin === "pack" ? <Badge data-testid={"bp-pack-" + r.id} color="yellow" variant="light">from a pack, unconfirmed</Badge> : null}
              {r.gap ?<Badge data-testid={"bp-gap-" + r.id} color="red" variant="light">nothing serves this yet</Badge> : null}
            </Group>
          </UnstyledButton>
        );
      })}
    </Stack>
  );
}
