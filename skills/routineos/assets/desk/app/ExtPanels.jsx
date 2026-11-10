// app/ExtPanels.jsx: the panels an agent wrote, on Today. Each is bound to a view ({type, filters}): the host reads
// those records, filters them like a saved view, and hands the component at most 50 as {view, records}.
import { useEffect, useState } from "react";
import { Text } from "@mantine/core";
import { forSlot, listView } from "../core/ext.js";
import ExtHost from "./ExtHost.jsx";
import SectionCard, { sectionId } from "./SectionCard.jsx";
import { useStore } from "./StoreContext.jsx";

function Panel({ ext }) {
  const store = useStore();
  const [records, setRecords] = useState(null);
  useEffect(() => {
    var live = true;
    setRecords(null);
    listView(store, ext.view).then((r) => { if (live) setRecords(r); }, () => { if (live) setRecords([]); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, ext.id]);
  var title = ext.title || ext.id;
  return (
    <SectionCard id={sectionId("today", title)} title={title}>
      {records === null ? <Text size="sm" c="dimmed">Loading</Text> : (
        <ExtHost id={ext.id} props={{ view: ext.view, records: records }}
          fallback={<Text size="sm" c="dimmed">This panel could not be shown.</Text>} />
      )}
    </SectionCard>
  );
}

export default function ExtPanels() {
  var list = forSlot(typeof window !== "undefined" ? window.DESK_EXTENSIONS : null, "panel");
  return list.length ? <>{list.map((e) => <Panel key={e.id} ext={e} />)}</> : null;
}
