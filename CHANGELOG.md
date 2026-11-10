# Changelog

## Unreleased

### Added

- `ui.markdown(text, {marks, clamp, onlyMarked})` for record sections, panels and pages: text as Markdown elements (headings as `h3` and `h4`, lists, bold, italic, code, quotes, tables), raw HTML shown as text, images as alt text, https links only, optional case-insensitive `mark` highlighting and block-level filtering. The allowed tags and attributes are unchanged; the component lint's `on*` key check now lets the option key `onlyMarked` through. The Desk gzip budget for `single/index.html` rises from 364500 to 364600 bytes.

### Changed

- The Desk is a React and Mantine app, prebuilt with Vite into one committed file (`assets/desk/index.html`) with everything inlined. It makes no network request of its own; only the store reaches the host. Routes, store calls and the custom component contract are unchanged. Pages keep their features but their markup and text are Mantine's, so the 0.8.1 and v2 text goldens describe the old Desk and are no longer compared (`tests/visual/golden/PROVENANCE.md`).
- Browse behaviour that differs from the classic Desk:
  - The peek shows the fields, the decision state, the Decision control and the comments. Drop from the peek opens the record page for its reason, and comments are written on the record page.
  - On a joined Desk only the owner gets Keep, Drop and Restore in the bulk bar, as on the record page and in the peek.
- `routineos bundle` writes one file. `--split` is kept as an alias: it writes the same file to `dashboard/artifact/` with a one-entry `files.json` and says split mode is gone.

### Removed

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
