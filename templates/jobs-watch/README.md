# jobs-watch

A watch routine that tracks public job postings for commerce and automation roles, links each role to its company, and puts the few that need a person in the Inbox. Status: template, version 1.

## What it does

Twice a week it searches each market for postings whose title matches a keyword, records every role and company it read, and writes a run record with what was claimed, parsed and dropped. Roles outside the settings are kept and marked dropped with a reason, so a person can see what the settings cut. It never sends, posts or deletes. Intro notes wait behind an email gate that times out after 48 hours.

## Files

- `routine.toml`: type, schedule, store, settings and the gate.
- `prompt.md`: the routine prompt, with the untrusted-data clause and the push rule.
- `definition.json`: the entity types (company, role), their identity rules, setting filters and default views.
- `demo/`: a synthetic seed generator and two demo producers (content-radar, lead-signals). Demo only, never copied by `routineos new`.

## Settings

People edit these on the Desk Settings page. Each run snapshots the values it used as `settingsUsed` on its run record.

| Setting | Type | Default | Note |
|---|---|---|---|
| markets | list, include | AU, US, CA, NZ, PH | each market adds a search |
| title_keywords | list, include | Shopify, headless, commerce, AI automation | each keyword adds a search per market |
| excluded_companies | list, exclude | none | roles from these domains are marked dropped |
| excluded_title_words | list, exclude | none | roles whose title carries one of these words are marked dropped; learning suggests words people keep dropping |
| lookback_days | number 1 to 30 | 7 | longer window, more comparison |
| max_inbox_per_run | number 0 to 20 | 5 | extra messages are counted, not sent |

## Use

```
python3 skills/routineos/scripts/routineos.py new jobs-nz --from-template jobs-watch
python3 skills/routineos/scripts/routineos.py seed jobs-nz --out jobs-nz/seed
```

Publish `jobs-nz/dashboard/index.html` privately with the `db` capability, then apply the seed batch files in order with ArtifactData batch.

## Desk icons

The Desk this template scaffolds carries a small inline SVG sprite vendored from [Lucide](https://lucide.dev) (lucide-static 1.63.0, ISC, with the Feather-derived icons also under MIT). The source is `skills/routineos/assets/desk/src/icons.js`; the licence text sits beside it as `icons.LICENSE.txt` and is repeated in the bundle. Icons draw in `currentColor` on a 24 grid, so they take the colour of the control that holds them.

- `icon(name)` returns a decorative `<svg>` that points at the sprite. The control around it carries the name.
- `button(label, onClick, { icon: name })` puts the icon before the visible label.
- `button(label, onClick, { icon: name, iconOnly: true })` shows the icon alone; `label` becomes the `aria-label` and the `title` tooltip.
- `starToggle(ctx, itemName, starred, run)` is the star: outline or filled, `aria-pressed`, and the label "Star" or "Unstar" plus the item name.

Available: star, star-filled, pencil, check, x, external-link, chevron-down, filter, columns-3, download, triangle-alert, search, sun, moon, monitor. To add one, copy its elements from `lucide-static` `icons/<name>.svg` at the same version into `ICONS`, then run `routineos.py bundle`.

## Demo data

```
python3 templates/jobs-watch/demo/generate.py --out /tmp/desk-demo --snapshot templates/jobs-watch/demo/desk-demo.json
```

Every name, domain and URL is invented and ends in `.example`.
