# Pack schema reference

Contents: top-level keys, routine, definition, desk, stages, connectors, files, content rules, catalog index, fetching.

A routine pack is one JSON file that holds a whole routine: its settings, definition, prompt, stages, schedule, gates, learning and Desk. This page lists every key. The machine-readable versions are `catalog/schema/pack.v1.schema.json` and `catalog/schema/catalog.v1.schema.json` (JSON Schema draft 2020-12). The code in `skills/routineos/scripts/pack.py` is the source of truth, and a test checks that the schemas match it.

Every object refuses keys it does not know. Duplicate keys at any level are refused. A pack is at most 512 KiB, and a catalog index at most 1 MiB.

## Top-level keys

Packs are written with the keys in this order.

| Key | Required | What |
|---|---|---|
| `$schema` | no | An editor hint, any string; ignored. Shipped packs leave it out. |
| `format` | yes | The constant `routineos.pack.v1`. |
| `id` | yes | Slug, lowercase letters, digits and hyphens, at most 64 characters. Equals `routine.routine.name`. |
| `version` | yes | Template version, `MAJOR.MINOR.PATCH`. |
| `title` | yes | Plain-English name, at most 80 characters. |
| `summary` | yes | One or two sentences, at most 280 characters. |
| `category` | yes | One of the categories below. |
| `maturity` | yes | `piloted` (a real run checked it) or `unpiloted`. |
| `license` | no | SPDX id text. |
| `inspiration` | no | Up to 10 `{source, title, url}`; `url` is https. |
| `routine` | yes | The parsed `routine.toml` as JSON. |
| `prompt` | yes | The text of `prompt.md`. |
| `readme` | yes | The text of `README.md`. |
| `definition` | when the workspace is on | The `definition.json` object. |
| `stages` | yes | Ordered workflow stages, 1 to 20. |
| `connectors` | yes | Declared connectors, 0 to 20. |
| `files` | no | `{relative path: text}`, at most 40 files, under `lib/` or `skills/`. |

Categories: `sales`, `marketing`, `ops`, `support`, `finance`, `recruiting`, `content`, `dev`, `general`.

A pack never carries page code. When `workspace.enabled` is true, install writes the bundled Desk page (`dashboard/index.html`, the same page `new` writes), and the definition drives it.

## `routine`

| Table | Keys |
|---|---|
| `routine` | `name`, `type`, `schedule`, `first_run` (absent or `report-only`) |
| `store` | `adapter` |
| `workspace` | `enabled`, `name`, `template`, `template_version` (`name` and `template` are slugs; `template_version` is a whole number of 1 or more) |
| `setting` (array) | `name`, `type`, `label`, `example`, `role`, `default`, `min`, `max`, `choices`, `cost_note`, `format` |
| `gate` | `enabled`, `transport`, `timeout_hours` |
| `action` (array) | `name`, `kind` |

The routine gets the same checks as `lint`: routine type, a schedule at least one hour apart, settings, a gate before any `send`, `post` or `delete` action, and the untrusted-data clause and a `Push rule:` line in the prompt.

A setting whose name says it holds who to contact (`recipient`, `approver`, `email`, `address`, `cc`, `bcc`, `channel`, `phone`) must default to an empty list. People fill it on the Desk.

## `definition`

| Level | Keys |
|---|---|
| top | `version`, `label`, `inbox`, `types`, `views`, `learning`, `desk` |
| type | `label`, `plural`, `identity`, `merge`, `fields`, `links`, `settingFilters` |
| field | `label`, `type`, `summary`, `choices` |
| setting filter | `setting`, `field` |
| view | `id`, `type`, `name`, `filters`, `sort`, `columns`, `window`, `group` |
| desk | `modules`, `health`, `record`, `pages` |
| desk module | `id`, `kind`, `label`, `icon`, `view`, `fields` |
| module view | `type`, `filters`, `window`, `sort`, `group`, `columns` |
| desk spec page | `id`, `title`, `nav`, `controls`, `filter`, `blocks` |
| spec page block | `id`, `kind` (`tile`, `chart`, `table`, `text`), `span`, and per kind: `label`, `title`, `heading`, `text`, `type`, `format`, `sparkline`, `columns`, `link`, `xLabel`, `yLabel`, `target`, `query` |
| block query | `type`, `where`, `window`, `groupBy`, `x`, `aggregate`, `orderBy`, `limit` |

The definition must compile with `definition.compile`, which applies the never-learnable rule (a setting whose name contains `push`, `gate`, `send`, `alert`, `permission`, `budget`, `maxruns` or `capoverride` cannot be bound while learning is on) and the Inbox cap rule.

### `desk`

Optional. `desk.modules` lists the routine's view modules: extra sidebar entries under an entity type, each a fixed
view over that type. `kind` is `view`. `id` matches `^[a-z][a-z0-9-]{1,31}$`, is unique across the workspace, is
not a page id and contains no never-learnable word. `label` is required (40 characters at most, no em dashes or
banned words); `icon` is a nav icon name. `view.type` names a type; `filters.tag` and `filters.source` may be a
list, matching any value. `fields` maps a field of that type to a component id that draws its cell. No key named
`script`, `html`, `js`, `code`, `template` or `style`, or ending in `Html`, is allowed at any depth. A pack never
carries page code: modules are data, and the Desk draws them. A definition without `desk` compiles exactly as before.
`routineos desk module add view <id> --routine <dir> --type <type>` adds one; `routineos desk lint` checks them.

`desk.pages` lists spec pages: declarative pages of tiles, charts, tables and text that the Desk draws at
`#/p/<id>` from entities it has already read. A spec page is data, so the lint refuses the same code keys as
modules. Each block's `query` names a declared entity `type` and the Desk computes the numbers; the spec carries
none. `controls` may list `refresh`, `dateRange` and `filter` (the last needs `filter: {field, label}`). Chart
`type` is one of `sparkline`, `line`, `bar`, `stackedBar`, `shareBar`; `format` is `number`, `percent` or
`currency`; `span` is `{base, md}`, each 1 to 12. An aggregate over a field needs a number field, except `count`.
This is not `routine.toml [desk] pages = true`, which turns on code pages. Say "spec page" for `desk.pages`.

## `stages`

A stage is an object with these keys.

| Key | Required | What |
|---|---|---|
| `id` | yes | Unique slug. |
| `kind` | yes | `code`, `model`, `skill` or `gate`. |
| `title` | yes | Short name. |
| `does` | yes | One plain sentence. |
| `connectors` | no | Connector ids declared in the pack. |
| `reads` | no | Store collections. Never a people collection such as `settings` or `decisions`. |
| `writes` | no | Store collections. Never a people collection. A stage that runs `routineos.py write` lists what the write contract writes: `runs`, `entities` and `inbox`, plus `pending` when the pack has a gate. |
| `command` | for `code` | One line starting `python3`, no shell characters, with the script straight after `python3` (no interpreter options such as `-m` or `-c`): `skills/routineos/scripts/routineos.py` or a `lib/*.py` file the pack ships. Install never runs it. |
| `skill` | for `skill` | A name with `skills/<name>/SKILL.md` in `files` whose frontmatter `name` matches. |

Kinds:

- `code`: a deterministic step, run as a command.
- `model`: judgement written in the prompt.
- `skill`: judgement guided by a skill file the pack ships.
- `gate`: a person approves before the next stage. It needs `routine.gate.enabled` true.

## `connectors`

A connector is an object with these keys.

| Key | Required | What |
|---|---|---|
| `id` | yes | Unique slug. |
| `label` | yes | Plain name. |
| `kind` | yes | `connector` (a claude.ai connector), `mcp` (an MCP server the person adds), `builtin` (a tool the run already has) or `http` (a host reached through a network secret). |
| `purpose` | yes | What it is for. |
| `required` | yes | `true` or `false`. A required connector is used by at least one stage. |
| `access` | yes | `read` or `write`. A `write` connector needs `routine.gate.enabled` true. |
| `stages` | yes | Stage ids that use it; each must list the connector back. |
| `alternatives` | no | Up to 5 plain product names, each at most 80 characters. Names only; availability is unverified. |
| `connect` | yes | Plain words on how the person connects it. Never a URL with a token, never a key. |

Install connects nothing. It prints a connector report and says that nothing was connected and the pack holds no secret.

## `files`

Paths match `(lib|skills)/<lowercase segment>/...` ending `.py`, `.md`, `.json` or `.txt`, exactly the pattern `^(lib|skills)/[a-z0-9_-]+(/(?!\.\.?/)[A-Za-z0-9_.-]+)*\.(py|md|json|txt)$` in the schema; no `.` or `..` segment, no reserved device names, no two paths that differ only by letter case, text only. Folders that hold a `pack.json` export only their `lib/` and `skills/` subfolders, so `templates/jobs-watch/demo/` is not part of the pack. Export refuses a symlink anywhere, or a path whose real location leaves the routine folder.

## Content rules

Every string and key in a pack is scanned. Problem messages name the key path and never echo the value.

- Secret patterns, email addresses and Slack-style ids are refused.
- Control characters other than a newline are refused, including tabs and carriage returns.

## Catalog index

`catalog/index.json` has the format `routineos.catalog.v1` and holds `{format, templates}`, sorted by id. Each entry has these keys:

| Key | What |
|---|---|
| `id` | The pack id. |
| `version` | The pack version. |
| `title` | The pack title. |
| `summary` | The pack summary. |
| `category` | The pack category. |
| `maturity` | `piloted` or `unpiloted`. |
| `type` | The routine type. |
| `schedule` | The cron schedule, UTC. |
| `path` | `<id>.json`, relative to the index. |
| `bytes` | Size of the pack file. |
| `sha256` | Hash of the pack file bytes, so a client can check what it fetched. |
| `connectors` | `[{id, label, required}]`. |
| `inspiration` | The inspiration URLs. |

## Fetching

A source is a file path or one `https://` URL. Other schemes are refused before any network call. Redirects are refused and not followed. The host name is resolved first, and the fetch is refused if any answer is a loopback, private, link-local, multicast or reserved address, or an IPv6 form that carries an IPv4 address (NAT64 `64:ff9b::/96` and `64:ff9b:1::/48`, 6to4, Teredo, IPv4-compatible `::/96`); the connection then goes to the checked address, so a second DNS answer is never used. Through a proxy, the CONNECT request names the checked IP, so the proxy never resolves the name, while TLS still verifies the certificate against the original host name. The timeout is 20 seconds, with no cookies, no auth headers, and the User-Agent `routineos-pack/0.8.1`. A catalog id is not resolved to a URL; pass the pack's own URL.
