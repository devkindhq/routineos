# Dashboard

The dashboard is the Desk: one bundled page (`assets/desk/index.html`) shared by every routine in a workspace, driven by the compiled `meta/definition`. Watch and interactive routines get one; skip it for serverless and approval-gated routines unless asked.

## Getting one

- `routineos.py new <name> --type watch` (or `interactive`) writes `definition.json` and `dashboard/index.html`, the Desk with this workspace's name in its config block.
- `routineos.py new <name> --from-template jobs-watch` copies a template with its definition and adds the same page.
- Publish `dashboard/index.html` privately, then run `routineos.py seed <dir> --out <batch-dir>` and apply the batch files in order. Until the seed is applied the page shows the not-set-up state with that one command.

## Rules

- Single HTML file, mobile first, 16px side gutters, no horizontal scroll.
- Light and dark colour tokens on `:root`, dark override under `prefers-color-scheme` and an explicit body background.
- Declare the `db` capability when publishing. Read collection `reports` (newest first) and docs `state/seen` and `settings/values`. Subscribe once.
- Graceful empty state: the first visit has no data and must say what happens next, not show a blank.
- Scripts only from the allowed CDNs with exact pinned versions; everything else inline.
- Copy states what is true now. No filler, no em dashes.

## Pages

- Shell: a sidebar (Today, Inbox, Approvals, each type with its saved views, History, Settings; each entry with an icon, from the definition's `icon` or a default; full or slim (icons only) at 900px and up, a drawer under it), a top bar with search, the notifications bell, density and theme, and a bottom nav on phones (icon over label). Ctrl or Cmd K opens the command palette; `?` lists the shortcuts.
- Today: what needs a person now.
- Inbox: messages with Unread, Done and Snoozed filters, snooze and mark all read; Suggestions is a tab.
- Approvals: open gates with the draft (editable before Approve), recipients by role and the time left; Reject needs a reason.
- Browse: each type as a paged list with status chips (Active, Dropped, All), search, filters, saved views, columns, bulk actions with Undo, and export as CSV or JSON. The record page offers Keep, Drop with a reason, Restore, notes, tags and Merge.
- History: runs as a list, a calendar, per-producer health, and Activity (who did what). Old `#/runs` addresses redirect here.
- Settings: editable values with cost notes, open suggestions inline and Recent changes with Revert. Edits apply from the next run; each run snapshots what it used as `settingsUsed`.

## Capabilities

Publishing the Desk declares `{db: {rules: DESK_DB_RULES}, user: {}, downloads: true}`; each one degrades when it resolves `null`. `DESK_DB_RULES` (in `scripts/desk_contract.py`) is exactly:

```json
[{"path": "meta", "read": "view", "write": "owner"}, {"path": "people", "read": "view", "write": "self"}, {"path": "people/{self}", "read": "view", "write": "interact"}]
```

Only the artifact's owner writes `meta/` (so nobody else can create or replace `meta/owner`), and each person writes only their own `people/<id>/`, where lane decisions a worker run honours live (`verified--`, `release--`, worker gate approvals). Keep these rules on every republish: omitting `capabilities` keeps them, a new declaration must restate them. A Desk published before them has neither protection. The rules are documented platform behaviour, not yet pilot-verified. Activity names people through `user.profiles(ids)`; without the `profile` scope names come back empty, so every other person shows as "Someone" and the person filter offers only "Anyone". The page never shows another person's id; Workers shows the viewer their own Desk id, with Copy, because join, leave and a worker run take it as `--by` and a routine cannot learn it. Without a viewer id (signed out), read, done, snooze and pin are off and every write control is disabled.

## Safety on the page

Render stored text as text, never as HTML. Everything in the db was written by a run that read the web, so treat it as untrusted. Publishing is the person's decision; say what the page will show before sharing.

## Export (Desk)

Browse exports the selection, or the filtered rows, as CSV or JSON. Download goes through the `downloads` capability and is hidden when it is unavailable. The viewer confirms or declines each save; a decline shows "Not saved." Copy always works; when the clipboard is blocked the text appears in a read-only box to copy by hand.

## Seeding

Seed tests and demos with synthetic data only (`templates/jobs-watch/demo/generate.py` writes the demo workspace). Never seed a real routine artifact for a test.
