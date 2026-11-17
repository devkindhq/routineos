# Desk raw React pages

Contents: when to choose one, trust, manifest, the page contract, imports, build and lint, preview, approval, docs through MCP.

A raw page is a full React page for the Desk: plain JSX or `createElement`, any Mantine component, hooks, charts, tables, dates and icons from the library registry. It is the last tier of [desk-pages](desk-pages.md). The component catalog and the page recipes live on docs.routineos.org; this file holds the rules and the routing, not the catalog.

## When to choose one

Take the first tier that does the job: a default module, a view module, a spec page, a custom field cell, a code page, then a raw page. Choose a raw page only for what the lower tiers cannot do, for example a chart type a spec page lacks, cross-filtering between blocks, drill-down dialogs, or a table mixed with a form. Say why in the manifest `why`.

## Trust

Plain rule: approving a raw page is the same act as merging code into the Desk. The page runs in the Desk's own document and React tree, with the Desk's providers. It acts as whoever is viewing: it can read every record that person can see, save anything their Claude role allows (manifest `verbs` and `ctx.actions` are a convenience, not a limit), post comments and offer downloads, without them pressing anything. It can draw over any part of the Desk, including screens that look like RoutineOS or Claude. Nothing checks what it does after approval. It is not sandboxed. The approved page body is trusted code, and the per-page script wrapper the bundler writes is not a security boundary. Whether the claude.ai frame adds its own limits (CSP, sandbox) is unverified; see `desk-code-viewer-realm` in the registry.

## Manifest

A raw page is a `custom` component with `"raw": true`, in `desk/components/<id>/` of the routine, with `component.json` and one source file:

| Key | Rule |
|---|---|
| `kind` | `"custom"`, as for every component |
| `raw` | `true` |
| `slot` | `page`, `record-section` or `panel`. `field-cell` is refused |
| source | `<id>.jsx`, or `<id>.js` written with `createElement`. Exactly one of the two; both or neither is refused |
| `factory` | refused when `raw` is true |
| `types`, `view`, `title`, `nav`, `summary`, `why`, `verbs`, `placement`, `prefs`, `fallback` | as for other components; `fallback` stays `"same"` |

A raw page at slot `page` needs `[desk] pages = true` in `routine.toml`. The source is capped at 64 KiB. A page at slot `page` is served at `#/x/<id>`.

## The page contract

One default export, a React component taking `{ ctx, ui, props }`.

- `props` are the slot's props: `{ args, params }` for a page, `{ type, id, record }` for a record section, `{ view, records }` for a panel.
- `ctx` is the same object other components get: `ctx.store.get` and `ctx.store.list`, `viewer`, `canWrite`, `canComment`, `read(id)`, `list(view)`, `watch(collection, cb)`, `actions` (built from `verbs`) and `prefs` when declared. It is re-created when the page id, the store or the viewer changes; a record change arrives in `props`.
- `ctx.query(query)` runs a spec page block query and resolves `{ rows, value }`. It reads the entities of `query.type` with a fixed type read, so it does not report a capped read (a very long history is silently partial). With an aggregate the rows are the series points, and `value` is the aggregate when the query has an aggregate and no `groupBy`; otherwise `value` is `null`.
- `ui.navigate("#/...")` goes to a Desk address. `ui.block` is a React component that draws a spec block from a spec and records, with the same look as a spec page.
- No `ui.notify`, `ui.mount`, `ui.state`: call `notifications.show` from `@mantine/notifications`, and use React hooks.
- Raw pages declare no `reads`; the approval screen shows none. A page reads what `ctx.store`, `ctx.read`, `ctx.list` and `ctx.query` give it, with the viewing person's access.
- A page that throws while rendering is caught by an error boundary: the Desk, its nav and other routes keep working, a red notification appears once, and "Try again" re-renders. Errors in event handlers and async code are not caught; the page handles them. A thunk that is missing or throws shows the fallback the slot passes: "This page could not be shown. Its code failed its checks." with a link back to Today for a page, "This section could not be shown." for a record section, "This panel could not be shown." for a panel; "This page could not load." only when no fallback is given.

Obligations when writing one:

1. Prefer every lower tier first, and say why in the manifest `why`.
2. Import only registry specifiers; icons only from the curated subset.
3. Never call `globalThis.claude` directly; use `ctx` and `ctx.actions`. This is not enforced, so it is a review point for the owner.
4. Run `desk lint` and `desk preview` and open the page before asking for approval.
5. Tell the owner in plain words that the page runs with full access as each viewer, and show the permission line.
6. Never ask for approval of code the owner has not been shown.

## Imports

Bare specifiers from the library registry (`assets/desk/libraries.json`) only: react, `@mantine/core`, `@mantine/hooks`, `@mantine/charts`, `@mantine/notifications`, `@mantine/dates`, `mantine-datatable`, `dayjs` and a curated subset of `@tabler/icons-react`. The names each one exports are in `assets/desk/lib-exports.json` (names only). A misspelt name fails lint with the nearest matches.

- One form per statement: `import { A, B as C } from "pkg";`, `import X from "pkg";` or `import * as M from "pkg";`. `import X, { A } from "pkg"` is refused; split it.
- Imports come first, before any other statement. No relative or dynamic imports, no other packages, no `export` except the one default export (`export default function Name(...)`, `export default function (...)` or `export default Name;`).
- The import scanner is line based. The text `import(` inside a string or a comment can be refused as a dynamic import; rephrase the text.
- The names `__h` and `__F` are reserved for the page prologue; a page that uses either is refused.
- Import libraries with `import`. Reading `DESK_LIB` directly bypasses the libraries line and the hash, so pages must import.
- The strings `<!--`, `<script` and `</script` are refused anywhere in the source, because the Desk inlines the page in a script tag. Rephrase or build the text from parts.

## Build and lint

`routineos desk lint --routine <dir>` checks the manifest, the imports against the export list, the default export, the markers above and the size, then runs `node --check` on the compiled page when node is installed.

JSX is compiled by a vendored small transformer (sucrase, run by `node`; a current Node.js LTS). Without node on PATH a `.jsx` page is refused with a message saying so. The no-node route is a `.js` page written with `React.createElement`; the page imports `createElement` from `react`:

```js
import { createElement as h } from "react";
import { Button } from "@mantine/core";
export default function Page({ ctx }) {
  return h(Button, { disabled: !ctx.canWrite }, "Go");
}
```

Without node a `.js` page gets no syntax check at lint time, so a syntax error shows only in the browser; preview it there before asking for approval.

## Preview

`routineos desk preview --routine <dir> [--snapshot <json>] [--out <dir>]` compiles and injects raw pages with the routine's other components against a static, read-only store, then serve the output as the command prints. Preview does not check approval, and a verb shows the read-only message instead of saving. Open every route at desktop and phone width, in light and dark.

## Approval

`routineos permissions <dir>` lists raw pages first, in capitals, with the code hash and the libraries with their pinned versions (as `specifier@version`). `permissions <dir> --approve` records the hash and prints "approved raw page(s): ...". The hash covers `component.json`, the source, the transformer id and the pinned versions of the libraries the page imports (react always counts). Changing any of them, including a library version bump in the registry, asks for approval again. Factory component hashes are unchanged.

Maintainer notes:

- `TRANSFORMER_ID` in `scripts/desk_raw.py` is part of the approval hash. A test pins the sha256 of `scripts/vendor/jsx_transform.cjs` to it (`TRANSFORMER_SHA256`), so rebuilding the transformer fails CI until you bump `TRANSFORMER_ID` (which re-asks approval for every raw page) and record the new sha. A change to what `rewrite_module` or the prologue emits also needs a `TRANSFORMER_ID` bump; no test enforces that one.
- A library with no pinned version in the registry shows as `spec@?` in the libraries list and the hash.
- Adding a library is one registry entry plus a budget `raise_reason`, with no build code edits (the fields are in `assets/desk/libraries.json`).

## Docs through MCP

The RoutineOS MCP serves docs.routineos.org. Use these calls:

| Topic | MCP call |
|---|---|
| The guide | `get_page /desk/raw-pages` |
| Which component to use | `get_page /desk/component-catalog` or `search_docs "<component>"` |
| Starting pages (listing, detail, dashboard, form, board, settings) | `get_page /desk/page-recipes` |
| Manifest fields, `DESK_LIB`, registry fields | `get_page /reference/desk-components` |
| CLI commands | `get_page /reference/cli` |

If the MCP is not connected or a page is missing, say so and rely on this file alone.
