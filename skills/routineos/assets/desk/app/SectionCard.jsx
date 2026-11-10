// app/SectionCard.jsx: a card section that folds. id is "<page>:<section>"; the open state is kept per viewer at
// routineos-desk-section:<id> (the base sectionCard key), and a section is open until the viewer folds it.
import { useState } from "react";
import { ActionIcon, Card, Collapse, Group, Title } from "@mantine/core";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { readPref, savePref } from "../core/prefs.js";

export var SECTION_KEY = "routineos-desk-section:";

// "<page>:<slug of the title>", e.g. sectionId("record", "Raw fields") is "record:raw-fields".
export function sectionId(page, title) {
  return page + ":" + String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// aside: shown after the heading (a count badge).
export default function SectionCard({ id, title, aside, children }) {
  const [open, setOpen] = useState(() => readPref(SECTION_KEY + id, ["0", "1"], "1") === "1");
  var bodyId = "section-" + id.replace(/[^a-zA-Z0-9-]/g, "-");
  function toggle() {
    var next = !open;
    savePref(SECTION_KEY + id, next ? "1" : "0");
    setOpen(next);
  }
  return (
    <Card withBorder padding="md" component="section" aria-label={title} data-section={id}>
      <Group gap="xs" justify="space-between" wrap="nowrap" mb={open ? "xs" : 0}>
        <Group gap="xs">
          <Title order={2} size="h4">{title}</Title>
          {aside}
        </Group>
        <ActionIcon variant="subtle" color="gray" onClick={toggle} aria-expanded={open} aria-controls={bodyId}
          aria-label={(open ? "Collapse " : "Expand ") + title}>
          {open ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
        </ActionIcon>
      </Group>
      <Collapse expanded={open} id={bodyId}>{children}</Collapse>
    </Card>
  );
}
