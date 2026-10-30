# engineering-digest

A daily digest of open pull requests, issues and failing builds, with the stale ones flagged. Status: template, version 1, unpiloted (no real run has checked it yet).

## What it does

It writes a daily digest of open engineering work across a few repositories and flags what has gone stale. Its push rule: report-only. Never merge, close, comment, label or rerun. Write only the run plan the write contract allows (runs, entities, inbox, agent views and columns).

## Stages

| Stage | Kind | Does |
|---|---|---|
| collect | model | Lists open pull requests, bug issues and the latest default-branch build per repository. |
| age | code | Computes age in days and the stale flag; DATE is today in UTC and DAYS is stale_after_days. |
| learn | code | Turns feedback on earlier runs into learning and proposals before the write. |
| write | code | Applies the run input under the write contract. |

## Connectors

Installing the pack connects nothing and holds no secret. Connect each one yourself. Products named as alternatives are examples; whether each offers the access listed is unverified.

| Connector | Kind | Needed | Access | Used by |
|---|---|---|---|---|
| Code host | connector | required | read | collect |

## Settings

People edit these on the Desk Settings page.

| Setting | Type | Default | Note |
|---|---|---|---|
| `repositories` | list | `[]` | each repository adds reads per run |
| `stale_after_days` | number | `7` | no extra cost; a lower value means more stale flags |
| `include_drafts` | toggle | `false` | more items to read |
| `max_inbox_per_run` | number | `5` | no extra cost; more messages ask more of your attention |

## Files

- `routine.toml`: type, schedule, store, settings and the gate.
- `prompt.md`: the routine prompt, with the untrusted-data clause and the push rule.
- `definition.json`: the record types, identity rules, setting filters and views.
- `pack.json`: the pack metadata, stages and connectors.
- `lib/stale_items.py`: a standard-library script the code stage runs.

## Known risks

- Stale is about time since the last update, not about whether work is blocked. Treat it as a prompt to ask, not a judgement.
- A private repository's titles land in the store. Check that is acceptable before adding one.
- With no repositories set, the routine does nothing but say so.

## Inspiration

Inspired by these public n8n workflows (an idea source, not a port):

- [Back up n8n workflows to GitHub](https://n8n.io/workflows/1534)
