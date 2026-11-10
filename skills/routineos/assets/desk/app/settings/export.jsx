// app/settings/export.jsx: where exports live. Each list and History export from their own pages; the links show only
// when this view can save a file.
import { Anchor, List, Text } from "@mantine/core";
import { useCanDownload, useModel } from "../StoreContext.jsx";
import { Section } from "./common.jsx";

export default function Export() {
  const model = useModel();
  const can = useCanDownload();
  var types = (model.definition && model.definition.types) || {};
  return (
    <Section id="export" title="Export">
      {can === null ? <Text c="dimmed">Checking whether this view can save files.</Text> : null}
      {can === false ? <Text c="dimmed">Saving files is not available in this view. Each list can still copy its rows.</Text> : null}
      {can === true ? (
        <>
          <Text size="sm">Export a list from its page: open it, filter if you like, then press Export. You get CSV or JSON of the rows shown.</Text>
          <List>
            {Object.keys(types).sort().map((k) => (
              <List.Item key={k}><Anchor href={"#/browse/" + encodeURIComponent(k)}>{"Export " + String(types[k].plural || types[k].label || k)}</Anchor></List.Item>
            ))}
          </List>
          <Text size="sm"><Anchor href="#/history">Export history</Anchor> from the History page.</Text>
        </>
      ) : null}
    </Section>
  );
}
