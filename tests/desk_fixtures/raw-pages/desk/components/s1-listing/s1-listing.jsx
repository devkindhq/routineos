import { useEffect, useMemo, useState } from "react";
import { Badge, Group, Stack, Text, TextInput } from "@mantine/core";
import { DataTable } from "mantine-datatable";
import { IconSearch } from "@tabler/icons-react";

const PAGE_SIZE = 10;
// Owner and Due are hidden below 48em so the right-aligned Amount column stays on screen.
const PHONE_HIDDEN = "(min-width: 48em)";
const COLOR = { todo: "gray", doing: "blue", done: "teal" };

export default function Listing({ ctx, ui }) {
  const [records, setRecords] = useState(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ columnAccessor: "title", direction: "asc" });

  useEffect(() => {
    let live = true;
    ctx.list({ type: "task" }).then((rows) => { if (live) setRecords(rows); });
    return () => { live = false; };
  }, [ctx]);

  const rows = useMemo(() => {
    const all = (records || []).map((r) => Object.assign({ id: r.id }, r.data.display));
    const q = query.trim().toLowerCase();
    const kept = q ? all.filter((r) => ((r.title ?? "") + " " + (r.owner ?? "") + " " + (r.status ?? "")).toLowerCase().includes(q)) : all;
    const dir = sort.direction === "desc" ? -1 : 1;
    return kept.slice().sort((a, b) => {
      const x = a[sort.columnAccessor];
      const y = b[sort.columnAccessor];
      const nx = x === null || x === undefined;
      const ny = y === null || y === undefined;
      if (nx || ny) return nx && ny ? 0 : nx ? 1 : -1;
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  }, [records, query, sort]);

  const shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <TextInput
          aria-label="Search tasks"
          placeholder="Search title, owner or status"
          leftSection={<IconSearch size={16} />}
          value={query}
          onChange={(e) => { setQuery(e.currentTarget.value); setPage(1); }}
          w="100%"
          maw={320}
        />
        <Text size="sm" c="dimmed">{rows.length} of {(records || []).length} tasks</Text>
      </Group>
      <DataTable
        withTableBorder
        highlightOnHover
        minHeight={180}
        fetching={records === null}
        records={shown}
        idAccessor="id"
        noRecordsText="No tasks match this search"
        totalRecords={rows.length}
        recordsPerPage={PAGE_SIZE}
        page={page}
        onPageChange={setPage}
        sortStatus={sort}
        onSortStatusChange={(s) => { setSort(s); setPage(1); }}
        onRowClick={({ record }) => ui.navigate("#/x/s2-detail/" + record.id)}
        columns={[
          { accessor: "title", title: "Title", sortable: true },
          { accessor: "owner", title: "Owner", sortable: true, visibleMediaQuery: PHONE_HIDDEN },
          { accessor: "status", title: "Status", sortable: true,
            render: (r) => <Badge color={COLOR[r.status] || "gray"} variant="light">{r.status}</Badge> },
          { accessor: "due", title: "Due", sortable: true, visibleMediaQuery: PHONE_HIDDEN },
          { accessor: "amount", title: "Amount", sortable: true, textAlign: "right" },
        ]}
      />
    </Stack>
  );
}
