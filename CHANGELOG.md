# Changelog

## 0.11.0

### Added

- Desk spec pages: `desk.pages` in `definition.json` declares pages of tiles, charts (sparkline, line, bar, stacked bar, share bar), tables and text, drawn at `#/p/<id>` from entities the Desk has read. The lint refuses code keys, undeclared types and fields, aggregates over non-number fields and id collisions with built-in pages and modules. Controls: Refresh, date range and a filter. Each chart has a show-as-table toggle, an accessible summary and a visible notice when the read was capped. See `references/desk-pages.md`.
- Desk: charts use `@mantine/charts` 9.7.5 with `recharts` 3.10.1. The gzip budget for `single/index.html` rises to cover them (each raise has a `raise_reason` in `tests/desk_budgets.json`); the cap agreed for this release is 521,723 bytes.
- Desk: Refresh works in a static Desk (`staticStore.reload()` re-fetches the snapshot), spec pages show "Updated", and a page refreshes once after the next scheduled run when the cron parses.
- Desk: a Commenter comments through the platform composer (`claude.use("comments")`) when the published Desk declares `comments: {composer_only: true}`; the Desk cannot list those threads. The declaration is documented but no publisher in this repo declares it, so this is unverified end to end. Registry record `desk-native-comment-composer`, status unverified.
- Desk spec pages: dropped records are excluded, a previous window with less than a full period of data shows "no change data", skipped non-number values are counted on the block, a bad `range` or a block that cannot be drawn no longer blanks the page, and windows are limited to 3660 days or 520 weeks. The code host now checks the body of a `ui.block` for script, frames, event handlers and non-https links.
- Desk code pages: allow-listed SVG through `ui.el`, `ui.block(spec, records)` for core blocks, a page-slot `ctx.list` that reads past 50 records with a `capped` flag, and a 64 KiB size limit per component in the lint.

### Changed

- `site-compliance-review` and `shopify-content-qa` `lib/` fetchers (`fetch_results.py`, `fetch_shots.py`, `worker_shots.py`) no longer follow a redirect from the Worker URL; a redirect is an error, so a Worker or store setting that redirects cannot send the fetcher to another host.
- `site-compliance-review` Worker: the screenshot and scrape calls now pass `allowRequestPattern`, so the browser loads only https requests to `ALLOWED_HOSTS` (and data: URLs). This closes a gap where the redirect-free status check and the browser's own navigation were separate requests, so a page could send the browser to another host. Pages that load assets from other hosts need those hosts added to `ALLOWED_HOSTS`.
- `weekly-marketing-report` template: runs on Thursday 21:00 UTC, and a new `lib/weeks.py` step gives every source the same explicit Monday to Sunday weeks (the last completed one and the one before). It reads Google Analytics 4 through one read-only `runReport` call (two explicit date ranges) and a new `lib/ga_weeks.py` step that splits the response into this-week.json and last-week.json. New `ga_property` setting. A second source, `search`, reads Google Search Console through two read-only queries (the same two weeks) and a new `lib/gsc_weeks.py` (`merge`), with a new `search_site` setting; the `sources` default is `analytics` and `search`. The prompt limits the run to report tools. The Desk overview page gains Search clicks, Search impressions and Average position tiles and line charts of clicks and impressions by week, and drops the sessions share chart; the demo snapshot covers the search metrics. Piloted: run end to end twice in a cloud routine on a live site, report-only.

### Known issues

- List settings (for example `pages_to_audit`) are not validated by the Desk or the routines, and a routine prompt may pass a value to a shell command. On a Desk with other writers (a shared or joined Desk), someone who can write `settings/` could put a crafted value there. A Desk only its owner can write is not affected. Until this is fixed, share a Desk's write access only with people you trust, and read the settings values on the Desk before a run. Planned for 0.11.1: per-template checks on list values, quoting, and a lint rule against interpolating setting values into shell commands.

## 0.10.0

### Added

- `site-compliance-review` template (unpiloted, watch): reviews a website's pages against a swappable rule pack (`lib/rules.json`) and records flags with severity, a screenshot and boxed capture notes, tracks them across runs and honours Keep and Drop decisions. Captures come from a Cloudflare Worker in the template's `worker/` folder (repository only, not in the pack) that reads the sitemap daily and captures pages with Browser Run. Clef on Workers AI (default `@cf/cloudflare/clef-flash`, Worker vars `USE_CLEF`, `CLEF_MODEL`, `CLEF_FLAG_AT`, `CLEF_IMAGE`) scores every rule on each capture and is the main verdict engine: a score at or above the flag line is a flag, a rule hit Clef scores low stays a flag marked needs review, and Clef off or failing leaves the rule flags unchanged. Flags carry `origin`, `clef_score` and `needs_review`; the Desk adds Clef verdicts and Needs review views, and an optional repository-only `clef-card` record section. The Clef endpoint shape is unverified, image input untested and the flag line uncalibrated.
- `site-compliance-review`: a `clef_flag_at` setting (percent, default 70) that the run pushes to the Worker's new `POST /config` (stored in R2; precedence stored config, then the `CLEF_FLAG_AT` var, then 0.7; `GET /summary` shows `flagAt` and `flagAtSource`); no boxes on a screenshot whose width is not a whole multiple of the 1280 viewport; a recapture without a new image keeps the page's previous screenshot, and an uploaded asset url is stored as `/_blob/<id>`, the form that loads for viewers (observed on one host); `MAX_NEW_PER_SYNC` now ships at 5 for a small fresh start; new entries in `risks.md`.
- `ui.markdown(text, {marks, clamp, onlyMarked})` for record sections, panels and pages: text as Markdown elements (headings as `h3` and `h4`, lists, bold, italic, code, quotes, tables), raw HTML shown as text, images as alt text, https links only, optional case-insensitive `mark` highlighting and block-level filtering. The allowed tags and attributes are unchanged; the component lint's `on*` key check now lets the option key `onlyMarked` through. The Desk gzip budget for `single/index.html` rises from 364500 to 364600 bytes.
- Desk: a viewer who may not write shared data (a Commenter or Viewer, when the platform answers `user.can("data.write")` false) sees Save view, Approve, Decline, Mark reviewed, Remind me, Run now, Retry, Mark seen, the Decision control, star, notes and the comment box disabled with the reason "Saving needs Contributor access or above", in place of a save that fails. When the platform does not answer, the controls stay enabled and a refused write shows "Not saved", as before.
- Desk: the columns a viewer picks on a list are kept per viewer (`data/users/<id>/state/cols/<type>`, or this device's storage for a viewer who cannot write) and come back when the list is reopened. The address `cols=` wins, then a saved view's columns, then the personal choice, then the defaults. "Reset columns" in the Columns menu clears it.
- Desk: the last route is remembered per viewer and opened when the Desk is opened with no address (for a host that does not show the Desk's own address). In a frame the Desk uses a slash-free address, `#d--<piece>--<piece>...` (letters, digits and hyphens only, other characters written as `-` and two hex digits), because the host passes only a plain `#name` to its own address bar (observed on one host page, not a `#/path`). `#/...` is still accepted, an explicit address of either form wins over the saved route, and Copy link in a frame copies the slash-free address (the page address itself is not available to the Desk) and says to put it after the page address.
- Test harness: `fakeClaude` takes `canWrite` (true, false, null) for `user.can("data.write")`.

### Changed

- The Desk is a React and Mantine app, prebuilt with Vite into one committed file (`assets/desk/index.html`) with everything inlined. It makes no network request of its own; only the store reaches the host. Routes, store calls and the custom component contract are unchanged. Pages keep their features but their markup and text are Mantine's, so the 0.8.1 and v2 text goldens describe the old Desk and are no longer compared (`tests/visual/golden/PROVENANCE.md`).
- Browse behaviour that differs from the classic Desk:
  - The peek shows the fields, the decision state, the Decision control and the comments. Drop from the peek opens the record page for its reason, and comments are written on the record page.
  - On a joined Desk only the owner gets Keep, Drop and Restore in the bulk bar, as on the record page and in the peek.
- `routineos bundle` writes one file. `--split` is kept as an alias: it writes the same file to `dashboard/artifact/` with a one-entry `files.json` and says split mode is gone.
- The component registry describes the Desk's building blocks and pages by id and purpose. `desk component new` no longer writes a library key; a routine's `component.json` that still has one passes `desk lint` (the key is ignored).
- Desk comments are written at `people/<viewer>/comments/<entity>--<ts36>`, under the existing `people/{self}` rule (no new db rule: the platform refuses `write: "view"` at publish, and a `{self}` segment must be the last one). Only the person in the path writes there, so the path says who wrote a comment; a `by` or `entity` field in the body is ignored. A comment never makes anyone a member or the owner of a record. Commenting is Contributor and up; a Commenter or Viewer sees the comment box disabled with the reason. The first comment also writes a marker document `people/<viewer>` so other visits can list the author (listing returns only real documents). A Desk published earlier needs a republish.
- Whose comments the Desk reads is capped at 50 people (the viewer, the owner, the people collection, then names from decisions and settings in that order), because a Contributor can write any `by` and each name costs a subscription; names past the cap are not read.
- Comments an earlier Desk wrote flat at `comments/` still show, marked unverified, are never used for identity and cannot be edited. Nothing migrates them.
- `ownerOf` and `deriveMembers` no longer read comments: the owner shown for a record is the person who decided it, and Members lists only people from decisions and settings.

### Removed

- Split mode's lazy page loading and basic mode (`components=native`).
- The classic Desk scripts in `assets/desk/src/`.

## 0.9.0

### Added

- Desk icons `desk`, `improve` and `desk-mark`; the sidebar brand block shows the Desk mark.

### Changed

- The template catalog moved from `site/templates/` to `catalog/` at the repo root: `catalog/index.json`, one `catalog/<id>.json` per pack, and the JSON Schemas in `catalog/schema/`. `pack catalog` writes there.
- The landing page is no longer part of this repo, and `site/` is ignored. `bundle_desk.py` still writes `site/desk.html` and `site/tokens.css` when a local `site/` folder exists.
- The Jobs watch demo snapshot moved to `templates/jobs-watch/demo/desk-demo.json`, which `generate.py` now writes by default.

## 0.8.1

### Security

- An owner's Release is final for the person it released: a worker cannot undo it by rewriting `joinedAt`, and a missing or malformed `joinedAt` counts as released. The owner re-admits that person by removing the release.
- A worker's learning evidence comes only from the joiner's own `people/<id>/decisions/`. `outcomes/` documents, which the worker writes, are never evidence.
- Run counters must hold non-negative integers. An invalid counter refuses its own writer's run and is skipped for everyone else. A Desk-wide cap counts only workers still serving a card lane, and the owner's cap never counts worker counters, so no joiner can block the owner.

## 0.8.0

### Added

- Join a Desk. An owner can open a Desk so other people serve it from their own accounts, with their own connectors. A `join` block in the Desk-level `definition.json` (one per Desk; a second fails compile) holds lanes, worker kinds, params, connectors, schedule, gate and a daily `cap`. `seed` writes it to `meta/join`; `seed --url` stores the Desk link for Copy link.
- Two worker kinds, `mail-draft` and `mail-send` (gated). A worker's prompt is the kind's fixed template filled in one checked pass; the card's `summary` and `label` never reach a model as instructions.
- `join` and `leave` subcommands: lane list, connector check, a permission screen, `worker-routine.json` for RemoteTrigger, and the `workers/<laneKey>` batch. `--by` (your Desk id) is required with `--lane` and is pinned in the worker's prompt. `join-settings --open` or `--closed` for the owner.
- Worker runs: `write --worker <laneKey>` (an allow-list of the lane's own `workers/`, `outcomes/` and `pending/` documents), `worker-items`, `budget-inputs` (cap per account or for the whole Desk) and `learn --worker`.
- The owner's `learn` reads every worker's learning, rebuilt from trusted data, and each proposal carries `sources`. The Desk shows them as "From 7 decisions by you and 5 by Alex Rivera (sender lane)"; names only when a Desk has more than one writer, never an email.
- A Workers page on the Desk: each lane, who serves it, last run and health, items waiting and done, Copy link for an unserved lane, the viewer's own Desk id with Copy, and Release for the owner. Worker gates are approved only by the person serving the lane.
- `references/join.md`, a join row in SKILL.md and a build question: "Should other people be able to join this Desk with their own routines?"
- The plugin bundles the docs MCP server (`https://docs.routineos.org/api/mcp`) in `plugin.json`, so installing the plugin in Claude Code connects it. No account or sign in.
- Registry: `run-reads-shared-artifact-db` and `run-writes-shared-artifact-db` (pilot), `desk-db-path-rules` (docs).

### Security

- The Desk declares `DESK_DB_RULES`: only the artifact owner writes `meta/`, and each person writes only their own `people/<id>/`. The owner record `meta/owner` is written by the page for the real owner only, and a mismatch in either direction turns owner controls off. Verified, release and worker-gate decisions are read only from `people/<id>/decisions/`, never from a `by` field. These rules are documented by the platform, not yet pilot-verified.
- A worker gate approval counts only for the item and the exact gate content the person was shown (copied into the decision); an edit to `pending/<id>` after the click voids it, and the send uses the approved copy. The approval request email is a notice only: a reply never approves.
- A worker run counts itself against the daily cap before any work, so a run that fails later still counts.

### Changed

- The pack fetch User-Agent is now `routineos-pack/0.8.0`.
- The `docs/` folder is gone. The migrate pages now ship with the plugin in `skills/routineos-migrate/references/`, and `authoring.md` and `pack-schema.md` in `skills/routineos/references/`. Honest limits, the migrate guides and template authoring are published at https://docs.routineos.org. The README images moved to `.github/assets/readme/`.
- The status dashboard, research notes, Kindform run and design plans and specs left the repo. The two registry records that cited raw research notes now point at the docs pages that summarise them.

## 0.7.0

### Added

- Desk navigation icons. A type or a view in `definition.json`, a pack's definition or an agent-proposed view can name an `icon`. There are 28 names (`definition.NAV_ICONS`), from the same Lucide 1.63.0 set and ISC licence as the other Desk icons. Today, Inbox, Approvals, History and Settings have fixed icons; a type without one shows `list` and a view `dot`.
- An unknown icon is a lint error (`type 'role': icon 'sparkles' is not a Desk icon; use one of ...`), a `pack validate` error through the same lint and the pack schema's enum, and a `ContractError` in `plan_run` for an agent-proposed view. The Desk falls back to the default for any name it does not carry.
- Explicit icons on the template and demo types where one reads better than the default, for example `building-2` for companies, `briefcase` for roles and `receipt` for invoices. The catalog and `site/desk-demo.json` are regenerated.

### Changed

- The sidebar shows an icon in place of the letter badge. Slim mode shows icons only; each link and the slim toggle keep their name for screen readers and as a title.
- The phone bottom nav shows an icon over a short label that truncates cleanly. Each entry is at least 44px tall, the bar respects the left, right and bottom safe areas, and the current page has a pill behind its icon and a heavier label instead of a full-cell outline.
- The pack fetch User-Agent is now `routineos-pack/0.7.0`.

### Fixed

- In slim mode the slim toggle had no accessible name, and after a toggle every sidebar title read the letter badge plus the label (for example "TToday").
- The desktop top bar showed the phone menu button, which opened nothing at 900px and up. It is now phone only.

## 0.6.0

### Added

- Routine packs: one JSON file (`routineos.pack.v1`) that holds a routine's settings, definition, prompt, stages, schedule, gates, learning and Desk. There are five `pack` commands: `validate`, `install`, `export`, `list` and `catalog`.
- Install reads a file path or one https URL. It refuses redirects and any host that resolves to a loopback, private, link-local or reserved address. It writes the folder atomically, connects nothing and prints a connector report (`--json` gives the same report as JSON).
- Export turns a routine folder into a pack. A round trip gives back the same pack. `routine.toml` comes back value-equal and the other files byte-equal.
- A catalog at `site/templates/index.json` (`routineos.catalog.v1`) with one pack per template, plus JSON Schemas in `site/templates/schema/`. `pack catalog --check` keeps it current.
- Eight new templates, all unpiloted: meeting-brief, weekly-marketing-report, inbox-triage, support-gap-digest, invoice-exceptions, candidate-shortlist, content-calendar and engineering-digest. Six of them ship standard-library scripts under `lib/`, and two ship skill files.
- jobs-watch and watch ship as packs, both piloted.
- Docs: `docs/templates/authoring.md` and `docs/templates/pack-schema.md`, plus a pack install and connector walk-through in SKILL.md.
- `migrate`: turn an n8n workflow, a Windmill flow or a described Zap into a routine pack. Seven subcommands: `n8n`, `windmill`, `steps`, `plan`, `search`, `fetch` and `concepts`. The output is `pack.json` plus `MIGRATION.md`, written to a folder that must not exist or must be empty. Exit 0 means nothing needs a person, 1 means the pack was written and the report lists needs-person or unmapped issues, and 2 means usage, IO or conversion failure.
- A migration plan format (`routineos.migration.v1`) between the parsers and the emitter. The same plan always gives the same pack bytes. `migrate plan` prints a plan and `migrate steps` emits one, so the guided Zapier path can write a plan from what the person describes.
- A concept map and app catalog (`skills/routineos/registry/migrate-concepts.json`), documented in `docs/migrate/concepts.md` and kept in step by a test.
- n8n conversion: schedule mapping, an expression rewriter, AI Agent and chain nodes as skill stages, sub-nodes read from `ai_*` connections, code nodes as stubs with the original source kept, credentials listed by type and name. Windmill conversion reads OpenFlow JSON and refuses YAML.
- `migrate search` and `migrate fetch` read the public n8n template gallery through the vetted pack reader (https only, no redirects, public addresses only, size cap). Nothing from n8n.io is stored.
- A `routineos-migrate` skill for the judgement half (code translation, expressions, routine kind, untrusted text review, the Zapier guided path) and a pointer section in the `routineos` skill.
- Docs: `docs/migrate/` with an overview, n8n, Windmill, Zapier and limits pages.

### Changed

- Any step that writes makes a converted routine approval-gated, and write steps move after the gate. Converted packs are `unpiloted` and start report-only.
- The pack fetch User-Agent is now `routineos-pack/0.6.0`.

### Security

- `workspace.name` and `workspace.template` must be slugs. The Desk config block escapes `<`, `>` and `&`, so a name cannot break out of the script tag.
- Pack strings and keys holding control characters other than a newline are refused, and problem messages never echo one.
- Export refuses symlinks and any path whose real location leaves the routine folder.
- Packs are refused when they hold secrets, email addresses, Slack-style ids, unsafe commands, a write connector without a gate, or a stage that reads or writes a people collection.
- Every string from a source workflow passes a sanitiser: control characters, secret-shaped values, email addresses and Slack-style ids become `[removed]`, and the report names the field, never the value.
- A third-party source marks its generated skills with a banner and the report gets a "Read before you install" section.

## 0.5.0 (2026-10-30)

Desk v2: the people workspace gets a new shell, new pages and a restyle.

### Added

- Shell: a sidebar with Today, Inbox, Approvals, each type with its saved views, History and Settings. Full or slim at 900px and up (`[` toggles it), a drawer on phones. A top bar with search, the notifications bell, density and theme.
- Command palette (Ctrl K or Cmd K) and keyboard shortcuts (`g` then a page letter, `/`, `f`, `n`, `[`, `?`, Esc).
- Notifications column: run trouble, open gates, new messages and records, with All and Unread and Mark all read.
- Approvals page: open gates with the draft (editable before Approve), recipients by role and the time left. Reject needs a reason.
- History page: runs as a list, a calendar, per-producer health and Activity (who did what). `#/runs` links redirect to `#/history`.
- Inbox: Unread, Done and Snoozed filters, snooze, mark all read, and Suggestions as a tab.
- Browse: paged lists with status chips (Active, Dropped, All), bulk actions with Undo, export as CSV or JSON with Copy, and saved views in the sidebar.
- Record page: Drop with a reason and Restore by a person.
- Settings: Recent changes with Revert.
- Demo data: a settings history entry, a gate draft and recipient, two person drops and a snooze.

### Changed

- New palette and type (Public Sans, IBM Plex Mono), 22px chips and compact density.
- Suggestions and Views moved out of the sidebar: Suggestions is an Inbox tab, Views live under each type.
