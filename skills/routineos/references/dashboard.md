# Dashboard

The dashboard is the Desk: one bundled page (`assets/desk/index.html`) shared by every routine in a workspace, driven by the compiled `meta/definition`. Watch and interactive routines get one; skip it for serverless and approval-gated routines unless asked.

## Getting one

- `routineos.py new <name> --type watch` (or `interactive`) writes `definition.json` and `dashboard/index.html`, the Desk with this workspace's name in its config block.
- `routineos.py new <name> --from-template jobs-watch` copies a template with its definition and adds the same page.
- To publish as an artifact, run `routineos.py bundle --routine <dir>` and publish `dashboard/index.html`. It is one file with everything inlined, so nothing comes from a CDN and the same file opens locally or by email. `--split` is an alias kept for old scripts: it writes the same one file to `dashboard/artifact/index.html` with a one-entry `files.json` and says split mode is gone.
- Publish the page privately, then run `routineos.py seed <dir> --out <batch-dir>` and apply the batch files in order. Until the seed is applied the page shows the not-set-up state with that one command.

## Rules

- Single HTML file, mobile first, 16px side gutters, no horizontal scroll.
- Light and dark colour tokens on `:root`, dark override under `prefers-color-scheme` and an explicit body background.
- Declare the `db` capability when publishing. Read collection `reports` (newest first) and docs `state/seen` and `settings/values`. Subscribe once.
- Graceful empty state: the first visit has no data and must say what happens next, not show a blank.
- Scripts only from the allowed CDNs with exact pinned versions; everything else inline.
- Copy states what is true now. No filler, no em dashes.

## Pages

- Shell: a sidebar (Today, Inbox, Approvals, each type with its saved views, History, Settings; each entry with an icon, from the definition's `icon` or a default; full or slim (icons only) at 900px and up, a drawer under it), a top bar with search, the notifications bell, density and theme, and a bottom nav on phones (icon over label). Ctrl or Cmd K opens the command palette, grouped Go to, Records, Actions and Settings; Records finds up to 20 records by title or key and opens the record. `?` lists the shortcuts. A build with `tour: true` shows a five-step starter tour once per browser; Skip or Done keeps it hidden, and the owner can switch it off for everyone.
- Today: what needs a person now.
- Inbox: messages with Unread, Done and Snoozed filters, snooze and mark all read; Suggestions is a tab.
- Approvals: open gates with the draft (editable before Approve), recipients by role and the time left; Reject needs a reason.
- Browse: each type as a paged list with status chips (Active, Dropped, All), search, filters, saved views, columns, bulk actions with Undo, and export as CSV or JSON. Health chips come from `desk.health` (`?health=`), else the type's first choice field. A row opens the record in a peek. The record page (two panes: main column and a Details rail) offers Keep, Drop with a reason, Restore, notes, tags, Merge, an activity timeline, comments (`people/<id>/comments/`) and image notes (`capture`); see [write contract](write-contract.md).
- History: runs as a list, a calendar, per-producer health, and Activity (who did what). Old `#/runs` addresses redirect here.
- Settings: Account (Appearance, Shortcuts, kept in this browser) and Workspace sections: Routine values with cost notes, open suggestions inline and Recent changes with Revert, Routine notifications, Members (derived from who decided, changed a setting or commented, plus the owner), Modules, Saved views, Privacy PIN (owner only: set, change or remove), Starter tour, Export, Settings history and About. Edits apply from the next run; each run snapshots what it used as `settingsUsed`.
- Spec pages: `desk.pages` in the definition adds pages at `#/p/<id>` of tiles, charts (sparkline, line, bar, stacked bar, share bar), tables and text, with Refresh, date range and a filter. Each chart has a show-as-table toggle and an "Updated" time. Refresh re-reads the data; in a static preview it re-fetches the snapshot file. See [desk-pages](desk-pages.md).
- Workers: the viewer's own Desk id with Copy, each lane with who serves it and Release, and the owner's join settings.

## Capabilities

Publishing the Desk is documented to declare `{db: {rules: DESK_DB_RULES}, user: {}, downloads: true, comments: {composer_only: true}}`; each one degrades when it resolves `null`. The `comments: {composer_only: true}` entry is documented only: no publisher in this repo declares it, so the composer path is unverified end to end. `DESK_DB_RULES` (in `scripts/desk_contract.py`) is exactly:

```json
[{"path": "meta", "read": "view", "write": "owner"}, {"path": "people", "read": "view", "write": "self"}, {"path": "people/{self}", "read": "view", "write": "interact"}]
```

Only the artifact's owner writes `meta/` (so nobody else can create or replace `meta/owner`), and each person writes only their own `people/<id>/`, where lane decisions a worker run honours live (`verified--`, `release--`, worker gate approvals). Comments live at `people/<id>/comments/` under the same `people/{self}` rule (observed on a probe artifact as the owner and with as_level interact, not with a second real account: a `{self}` rule covered its whole subtree, and a `{self}` segment had to be the last one in a rule path), so the path says who wrote a comment: the Desk reads the author from the path and never believes a `by` or `entity` field in the body, and a comment cannot make anyone a member or an owner. The platform refuses a rule with `write: "view"` at publish ("grants nothing that interact does not"), so a Commenter or Viewer writes no shared data under any rule: Desk comments are Contributor and up, and the Desk shows the comment box disabled, with the reason, to everyone below that, unless the platform offers its comment composer: then a Commenter or Viewer sees a Comment button that opens it (composer only, the Desk cannot list those threads; static previews have none; see `desk-native-comment-composer` in the registry, unverified). Listing `people` returns only real documents, so the Desk writes a marker document at `people/<id>` with the first comment; without it nobody else's visit can find that author's comments (same probe: a comment was not listed until the marker existed). A Desk published before this change needs a republish for the marker to be writable in the Desk's own path rules check, and comments written under the earlier fourth rule were never accepted by the platform. Comments an earlier Desk wrote flat at `comments/` still show, marked unverified, and are never used for identity. Every other shared write (views, decisions, settings, requests, and the per-viewer state under `data/users/`) needs Contributor (`interact`): the Desk asks `user.can("data.write")` and shows those controls disabled, with the reason, when it answers false; null (not told) leaves them enabled. Keep these rules on every republish: omitting `capabilities` keeps them, a new declaration must restate them. A Desk published before them has neither protection. The rules are documented platform behaviour, not yet pilot-verified. Activity names people through `user.profiles(ids)`; without the `profile` scope names come back empty, so every other person shows as "Someone" and the person filter offers only "Anyone". The page never shows another person's id; Workers shows the viewer their own Desk id, with Copy, because join, leave and a worker run take it as `--by` and a routine cannot learn it. Without a viewer id (signed out), read, done, snooze and pin are off and every write control is disabled.

## Safety on the page

Render stored text as text, never as HTML. Everything in the db was written by a run that read the web, so treat it as untrusted. Publishing is the person's decision; say what the page will show before sharing.

## Export (Desk)

Browse exports the selection, or the filtered rows, as CSV or JSON. Download goes through the `downloads` capability and is hidden when it is unavailable. The viewer confirms or declines each save; a decline shows "Not saved." Copy always works; when the clipboard is blocked the text appears in a read-only box to copy by hand.

## Seeding

Seed tests and demos with synthetic data only (`templates/jobs-watch/demo/generate.py` writes the demo workspace). Never seed a real routine artifact for a test.
