// app/settings/shortcuts.jsx: the keyboard shortcuts, the same list as the ? key shows.
import { Kbd, Table } from "@mantine/core";
import { navTypes_, shortcutRows } from "../../core/palette.js";
import { useModel } from "../StoreContext.jsx";
import { Section } from "./common.jsx";

export default function Shortcuts() {
  const model = useModel();
  return (
    <Section id="shortcuts" title="Shortcuts" note="Press g, then a letter, to go to a page. Shortcuts pause while you type in a field.">
      <Table>
        <Table.Thead><Table.Tr><Table.Th scope="col">Keys</Table.Th><Table.Th scope="col">Does</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {shortcutRows(navTypes_(model.definition)).map(([keys, what]) => (
            <Table.Tr key={keys + what}><Table.Td><Kbd>{keys}</Kbd></Table.Td><Table.Td>{what}</Table.Td></Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Section>
  );
}
