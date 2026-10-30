# watch

A generic routine that watches a list of sources for changes and reports them. Status: live in v0.

## What it does

On each scheduled run it opens every source in `sources`, finds items inside the lookback window, compares them with what it has seen, and writes one report to the store. It never sends, posts or deletes. The first run is report-only.

## Files

- `routine.toml`: type, schedule, store, settings.
- `prompt.md`: the routine prompt, with the untrusted-data clause and the push rule.
- `definition.json`: the entity type (item), its identity rule and the default view the Desk shows.

## Settings

| Setting | Type | Default | Note |
|---|---|---|---|
| sources | list | two example URLs | each source adds page opens |
| lookback_days | number 1 to 30 | 7 | longer window, more comparison |
| max_items | number 5 to 100 | 25 | more items, more page opens |
| report_when_empty | toggle | true | quiet runs still leave a report |

People edit these on the Desk Settings page. Changes apply from the next run, and each run snapshots the values it used as `settingsUsed` on its run record.

## Use

```
python3 skills/routineos/scripts/routineos.py lint templates/watch
```

Replace the example sources before enabling the routine. To get a Desk for it, scaffold a copy with `routineos.py new <name> --type watch`, which writes `dashboard/index.html`.

## Desk icons

The Desk this template scaffolds carries a small inline SVG sprite vendored from [Lucide](https://lucide.dev) (lucide-static 1.63.0, ISC, with the Feather-derived icons also under MIT). The source is `skills/routineos/assets/desk/src/icons.js`; the licence text sits beside it as `icons.LICENSE.txt` and is repeated in the bundle. Icons draw in `currentColor` on a 24 grid, so they take the colour of the control that holds them.

- `icon(name)` returns a decorative `<svg>` that points at the sprite. The control around it carries the name.
- `button(label, onClick, { icon: name })` puts the icon before the visible label.
- `button(label, onClick, { icon: name, iconOnly: true })` shows the icon alone; `label` becomes the `aria-label` and the `title` tooltip.
- `starToggle(ctx, itemName, starred, run)` is the star: outline or filled, `aria-pressed`, and the label "Star" or "Unstar" plus the item name.

Available: star, star-filled, pencil, check, x, external-link, chevron-down, filter, columns-3, download, triangle-alert, search, sun, moon, monitor. To add one, copy its elements from `lucide-static` `icons/<name>.svg` at the same version into `ICONS`, then run `routineos.py bundle`.
