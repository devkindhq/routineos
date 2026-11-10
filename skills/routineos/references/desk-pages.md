# Desk pages: spec pages and code pages

Two kinds of custom page. Prefer the first.

| | Spec page | Code page |
|---|---|---|
| Where | `desk.pages` in `definition.json` | `desk/components/<id>/` with slot `page` |
| What it is | Data: tiles, charts, tables, text | Plain JavaScript on the component host |
| Route | `#/p/<id>` | `#/x/<id>` |
| Approval | None needed, it carries no code | Hash approval (`permissions <dir> --approve`) |
| Check | `desk lint --routine <dir>` | `desk lint --routine <dir>` |

`desk.pages` in the definition is a spec page. `routine.toml [desk] pages = true` turns on code pages. Say "spec page" for the first.

## Authoring a spec page

1. Name the entity types the page reads and the fields on them (`desk components --routine <dir>` and the definition).
2. Add a page to `desk.pages` with `id`, `title`, optional `nav {label, icon}`, `controls`, optional `filter {field, label}` and `blocks`.
3. Run `desk lint --routine <dir>`. Fix each problem it prints; every line starts with `desk.pages.<id>:`.
4. Run `desk preview <dir>` against `demo/pages-demo.json` and look at it at desktop and phone width.

### Fields

| Level | Keys |
|---|---|
| page | `id`, `title`, `nav`, `controls` (`refresh`, `dateRange`, `filter`), `filter`, `blocks` |
| tile | `id`, `kind`, `span`, `label`, `query`, `format`, `sparkline` |
| chart | `id`, `kind`, `span`, `type` (`sparkline`, `line`, `bar`, `stackedBar`, `shareBar`), `title`, `query`, `format`, `xLabel`, `yLabel`, `target` |
| table | `id`, `kind`, `span`, `title`, `query`, `columns`, `link` |
| text | `id`, `kind`, `span`, `heading`, `text` |
| query | `type`, `where`, `window`, `groupBy`, `x`, `aggregate`, `orderBy`, `limit` |

- `span` is `{base, md}`, each a whole number from 1 to 12 (columns of 12). `base` applies on a phone, `md` from a medium screen up. No pixels.
- `format` is `number`, `percent` or `currency`. `currency` is a plain `$` prefix, it does not follow a currency field.
- `where` is a list of `[field, operator, value]`. Operators: `==`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `not-in`, `array-contains`.
- `window` is `"range"` (the date range control, so the page needs the `dateRange` control) or `{last: {n, unit}}` with unit `days` or `weeks`. `n` is at most 3660 days or 520 weeks; the lint refuses more and the Desk drops a block that has more. A table with a window needs `query.x`.
- `where` with `in` or `not-in` needs a list value. `query.x` must be a date field (or `lastSeen`, `firstSeen`). `columns` may not repeat a field, `sparkline` and `link` are true or false, `target` is a finite number, and `limit` is for a table only. A page filter field must be declared on a type one of its blocks queries.
- `target` and `format` on a chart are accepted by the lint but not drawn yet; `format` applies to tiles only.
- `aggregate` is `{op, field}`. `op` is `latest`, `sum`, `avg`, `count` or `delta`. Any op but `count` needs a number field.
- A tile and a chart need `query.x` (the date field they plot by) and `query.aggregate`. A tile has no `groupBy`.
- `limit` is 1 to 1000. The spec carries no numbers; the Desk computes them from the rows it read.
- A page shows when it last read its data ("Updated"). Capped reads say so on the page.
- Records with status `dropped` are never counted. A tile that compares with the previous window shows "no change data" unless the data reaches back over that whole previous window. Values that are not numbers are skipped and the block says how many ("1 value skipped, not a number"). A `latest` tile shows the last x that holds a number. A tile ignores `window: "range"` (it uses all data); only charts follow the date range control.
- A block that cannot be drawn shows "This block could not be drawn" and the rest of the page stays; a malformed `range` or `filter` value in the address falls back to the default.

### Worked example: weekly Overview

The `weekly-marketing-report` template stores one `metric` per source, metric name and week start date (fields `source`, `name`, `week`, `value`).

```json
"desk": {
  "pages": [
    {
      "id": "overview",
      "title": "Overview",
      "nav": {"label": "Overview", "icon": "chart-line"},
      "controls": ["refresh", "dateRange", "filter"],
      "filter": {"field": "source", "label": "Source"},
      "blocks": [
        {"id": "sessions", "kind": "tile", "label": "Sessions", "span": {"base": 12, "md": 4},
         "sparkline": true,
         "query": {"type": "metric", "where": [["name", "==", "sessions"]], "x": "week",
                   "aggregate": {"op": "latest", "field": "value"}}},
        {"id": "trend", "kind": "chart", "type": "line", "title": "Sessions by source",
         "span": {"base": 12, "md": 8}, "xLabel": "Week", "yLabel": "Sessions",
         "query": {"type": "metric", "where": [["name", "==", "sessions"]], "x": "week",
                   "groupBy": "source", "aggregate": {"op": "sum", "field": "value"}}},
        {"id": "share", "kind": "chart", "type": "shareBar", "title": "Share by source",
         "span": {"base": 12, "md": 4},
         "query": {"type": "metric", "where": [["name", "==", "sessions"]], "x": "week",
                   "groupBy": "source", "aggregate": {"op": "sum", "field": "value"}}},
        {"id": "read-me", "kind": "text", "heading": "About this page",
         "text": "Numbers come from the last weekly run."}
      ]
    }
  ]
}
```

Add Conversions and Revenue tiles the same way, changing the `where` name and `format`.

### Lint errors and fixes

| Error says | Fix |
|---|---|
| `the id is a built-in page; choose another id` | Pick an id that is not `today`, `approvals`, `runs` and the other built-in pages. |
| `the id is also a desk module id` | Page ids and module ids share one namespace. |
| `the id contains a word learning never touches` | Rename it (no push, gate, send, alert, permission, budget, maxruns, capoverride). |
| `would carry code; a spec page carries data only` | Remove `script`, `html`, `js`, `code`, `template`, `style` and keys ending in `Html`. Use a code page for code. |
| `the filter control needs a filter {field, label}` | Add `filter` or drop `filter` from `controls`. |
| `query.type is undeclared type` | Use a type that exists under `types`. |
| `aggregate field '<f>' is not a number field` | Aggregate a number field, or use `count`. |
| `a tile needs query.x` or `a chart needs query.x` | Name the date field to plot by. |
| `a tile has no groupBy` | Remove `groupBy`, or make it a chart. |
| `span.<k> must be a whole number from 1 to 12` | Use whole numbers in `base` and `md`. |
| `chart type '<t>' is not one of ...` | Use `sparkline`, `line`, `bar`, `stackedBar` or `shareBar`. |

## Code pages

For what the core blocks cannot do. A code page is a function `component_<id>(ctx, props, ui)` with slot `page`, written in plain JavaScript (no JSX, no compile step, no hooks). The contract is in [desk-components](desk-components.md); what changed for pages:

- SVG through `ui.el`: `svg`, `g`, `path`, `line`, `polyline`, `rect`, `circle`, `text` with safe attributes only. A value containing `url(` is refused. No `foreignObject`, no `use`, no `style` attribute.
- `ui.block(spec, records)` draws a `tile`, `chart`, `table` or `text` block from the spec format above. Use it for what a core block already does.
- `ctx.list` on a page reads past 50 records and returns a `capped` flag; the panel and record-section slots keep the 50 cap.
- A component file may be at most 64 KiB; the lint refuses a larger one.
- The lint is a text check and not a sandbox. Approval is enforced by the publisher.

## Platform claims

- Spec pages make no network request; the Desk reads only through the store.
- Commenter comments through the platform composer: documented, but no publisher in this repo declares `comments: {composer_only: true}` and it is unverified end to end, see `desk-native-comment-composer` in `registry/capabilities.toml`. Do not promise it.
- Static Refresh re-fetches the snapshot file; the auto-refresh timer needs a cron the Desk can parse (UTC, minute, hour and day of week only). Not verified in a published Desk.
