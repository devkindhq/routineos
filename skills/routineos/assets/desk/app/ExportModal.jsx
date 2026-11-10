// app/ExportModal.jsx: the export dialog (core/exporter.js). CSV or JSON of the rows given; Copy goes through
// app/Copy.jsx, so a refused clipboard write opens the text to copy by hand and never says Copied;
// Download shows only when the store says this view can save, goes through store.saveFile on click, and a refused
// save says why (downloadToast) instead of copying behind the viewer's back. History reuses it with its own rows.
import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Group, Modal, SegmentedControl, Stack, Text, Textarea } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCopy, IconDownload } from "@tabler/icons-react";
import { EXPORT_FORMATS, EXPORT_HINT, downloadToast, exportData, exportName } from "../core/exporter.js";
import { CopyTextButton } from "./Copy.jsx";
import { useCanDownload, useStore } from "./StoreContext.jsx";

var TONE_COLORS = { quiet: "gray", warn: "yellow", fail: "red" };

// rows: plain objects keyed by column key. cols: [{key, label}]. label: what is exported ("2 selected").
export default function ExportModal({ opened, onClose, title, rows, cols, label, workspace, plural }) {
  const store = useStore();
  const can = useCanDownload();
  const [format, setFormat] = useState("csv");
  const [toast, setToast] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (opened) setToast(null); }, [opened]);
  const data = useMemo(() => (opened ? exportData(rows || [], cols || [], format) : ""), [opened, rows, cols, format]);

  function download() {
    setSaving(true);
    setToast(null);
    var name = exportName(workspace, plural, new Date(), format);
    Promise.resolve().then(() => store.saveFile(name, data)).then(() => {
      setToast({ tone: "quiet", text: "Saved " + name + "." });
      notifications.show({ message: "Saved " + name + "." });
    }, (err) => {
      var t = downloadToast(err);
      setToast(t);
      if (t.hide) setHidden(true);
    }).finally(() => setSaving(false));
  }

  return (
    <Modal opened={opened} onClose={onClose} title={title || "Export " + plural} size="lg">
      <Stack gap="sm">
        <Group justify="space-between">
          <Text size="sm">{label}</Text>
          <SegmentedControl size="xs" value={format} onChange={setFormat} aria-label="Format"
            data={EXPORT_FORMATS.map((f) => ({ value: f[0], label: f[1] }))} />
        </Group>
        <Textarea aria-label="Export data" readOnly value={data} autosize minRows={4} maxRows={12} ff="monospace" />
        {toast ? <Alert color={TONE_COLORS[toast.tone] || "gray"} role="status">{toast.text}</Alert> : null}
        <Group justify="flex-end">
          <CopyTextButton value={data} label="Copy" leftSection={<IconCopy size={16} />} />
          {can === true && !hidden ? (
            <Button leftSection={<IconDownload size={16} />} onClick={download} loading={saving}>Download</Button>
          ) : null}
        </Group>
        {can === true && !hidden ? <Text size="xs" c="dimmed" ta="right">{EXPORT_HINT}</Text> : null}
      </Stack>
    </Modal>
  );
}
