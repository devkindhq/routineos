// app/pages/spec/Controls.jsx: the controls a spec page declares (desk.pages[].controls): Refresh, a date range and
// a filter on one field. The range and filter live in the address (range=<from>..<to>, filter=<value>) so a link
// shares them; the auto-refresh switch is this viewer's own choice.
import { Button, Group, NativeSelect, Switch, Text, TextInput } from "@mantine/core";

export default function Controls({ page, range, filter, values, onRange, onFilter, onRefresh, refreshing, auto, onAuto, updated, canAuto }) {
  var has = (name) => (page.controls || []).indexOf(name) !== -1;
  var from = range ? range.from : "";
  var to = range ? range.to : "";
  return (
    <Group gap="md" align="flex-end" wrap="wrap">
      {has("refresh") ? <Button variant="light" onClick={onRefresh} loading={refreshing}>Refresh</Button> : null}
      {has("dateRange") ? (
        <Group gap="xs" align="flex-end">
          <TextInput type="date" label="From" value={from} onChange={(e) => onRange(e.currentTarget.value, to)} />
          <TextInput type="date" label="To" value={to} onChange={(e) => onRange(from, e.currentTarget.value)} />
        </Group>
      ) : null}
      {has("filter") && page.filter ? (
        <NativeSelect label={page.filter.label || page.filter.field} value={filter || ""} onChange={(e) => onFilter(e.currentTarget.value)}
          data={[{ value: "", label: "All" }].concat(values.map((v) => ({ value: v, label: v })))} />
      ) : null}
      {has("refresh") && canAuto ? <Switch label="Refresh after each run" checked={auto} onChange={(e) => onAuto(e.currentTarget.checked)} /> : null}
      {updated ? <Text size="sm" c="dimmed">{"Updated " + updated}</Text> : null}
    </Group>
  );
}
