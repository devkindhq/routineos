// app/Filters.jsx: the Filters panel for Browse. It opens from its button and on the desk:open-filters event (the f
// key), which it claims with preventDefault. Every change goes straight to onChange, which writes the hash. Choice
// fields that declare no choices, the drop reason and bool fields offer the values found in the rows.
import { useEffect } from "react";
import { Button, Drawer, NativeSelect, SegmentedControl, Stack, Switch, Text, TextInput } from "@mantine/core";
import {
  BROWSE_DEFAULT_SORT, BROWSE_STATUSES, BROWSE_WINDOWS, HEALTH_LABELS, HEALTH_TONES, WINDOW_LABELS, missing, rowValue,
} from "../core/pages/browse.js";
import { OPEN_FILTERS } from "./Keyboard.jsx";

// The distinct values the rows hold for one key, sorted, plus the value chosen now so a select can show it.
function distinct(rows, key, chosen) {
  // A Set, not an object: the values are record data, and "__proto__" must stay an ordinary option.
  var seen = new Set();
  (rows || []).forEach((r) => { [].concat(rowValue(r, key)).forEach((v) => { if (!missing(v)) seen.add(String(v)); }); });
  if (chosen) seen.add(chosen);
  return Array.from(seen).sort();
}

// fs: the filter state; t: the type; rows: every row of the type; cols: the columns ({key, label}) to sort by;
// sources: [{value, label}]; health: chipSource when it is a health rule.
export default function Filters({ opened, onOpen, onClose, fs, t, rows, cols, sources, health, onChange, onClear }) {
  useEffect(() => {
    function on(e) { e.preventDefault(); onOpen(); }
    window.addEventListener(OPEN_FILTERS, on);
    return () => window.removeEventListener(OPEN_FILTERS, on);
  }, [onOpen]);

  function set(patch) { onChange(Object.assign({}, fs, patch)); }
  function setField(k, v) {
    var fields = Object.assign({}, fs.fields || {});
    if (v === "") delete fields[k];
    else fields[k] = v;
    set({ fields: fields });
  }
  var fields = (t && t.fields) || {};
  var choiceKeys = Object.keys(fields).filter((k) => fields[k].type === "choice" || fields[k].type === "bool");
  var sort = fs.sort || BROWSE_DEFAULT_SORT;
  function options(k) {
    var chosen = (fs.fields || {})[k] || "";
    if (fields[k].type === "bool") return [{ value: "true", label: "yes" }, { value: "false", label: "no" }];
    var vals = (fields[k].choices || []).length ? fields[k].choices.map(String) : distinct(rows, k, chosen);
    if (chosen && vals.indexOf(chosen) === -1) vals = vals.concat([chosen]);
    return vals.map((v) => ({ value: v, label: v }));
  }

  return (
    <Drawer opened={opened} onClose={onClose} position="right" size="sm" title="Filters" closeButtonProps={{ "aria-label": "Close filters" }}>
      <Stack gap="md">
        <div>
          <Text size="sm" fw={500} mb={4}>Status</Text>
          <SegmentedControl fullWidth value={fs.status} onChange={(v) => set({ status: v })} aria-label="Status"
            data={BROWSE_STATUSES.map((s) => ({ value: s[0], label: s[1] }))} />
        </div>
        <Switch label="Starred only" checked={!!fs.starred} onChange={(e) => set({ starred: e.currentTarget.checked })} />
        <TextInput label="Tag" value={fs.tag} onChange={(e) => set({ tag: e.currentTarget.value })} />
        {sources.length ? (
          <NativeSelect label="Source" value={fs.source} onChange={(e) => set({ source: e.currentTarget.value })}
            data={[{ value: "", label: "Any source" }].concat(sources)} />
        ) : null}
        <NativeSelect label="Drop reason" value={fs.reason || ""} onChange={(e) => set({ reason: e.currentTarget.value })}
          data={[{ value: "", label: "Any" }].concat(distinct(rows, "dropReason", fs.reason).map((v) => ({ value: v, label: v })))} />
        <NativeSelect label="Last seen" value={fs.window} onChange={(e) => set({ window: e.currentTarget.value })}
          data={BROWSE_WINDOWS.map((w) => ({ value: w, label: w === "all" ? "Any time" : WINDOW_LABELS[w] }))} />
        {health ? (
          <NativeSelect label="Health" value={fs.health} onChange={(e) => set({ health: e.currentTarget.value })}
            data={[{ value: "", label: "Any" }].concat(HEALTH_TONES.map((h) => ({ value: h, label: HEALTH_LABELS[h] })))} />
        ) : null}
        {choiceKeys.map((k) => (
          <NativeSelect key={k} label={fields[k].label || k} value={(fs.fields || {})[k] || ""}
            onChange={(e) => setField(k, e.currentTarget.value)}
            data={[{ value: "", label: "Any" }].concat(options(k))} />
        ))}
        <NativeSelect label="Group by" value={fs.group || ""} onChange={(e) => set({ group: e.currentTarget.value })}
          data={[{ value: "", label: "None" }].concat(choiceKeys.map((k) => ({ value: k, label: fields[k].label || k })))} />
        <NativeSelect label="Sort by" value={sort.field} onChange={(e) => set({ sort: { field: e.currentTarget.value, dir: sort.dir } })}
          data={(cols || []).map((c) => ({ value: c.key, label: c.label }))} />
        <div>
          <Text size="sm" fw={500} mb={4}>Order</Text>
          <SegmentedControl fullWidth value={sort.dir} onChange={(v) => set({ sort: { field: sort.field, dir: v } })} aria-label="Order"
            data={[{ value: "desc", label: "Descending" }, { value: "asc", label: "Ascending" }]} />
        </div>
        <Button variant="default" onClick={onClear}>Clear filters</Button>
      </Stack>
    </Drawer>
  );
}
