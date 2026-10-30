# weekly-marketing-report

Each week, compares marketing metrics with the week before, audits a few key pages, and flags big moves. Status: template, version 1, unpiloted (no real run has checked it yet).

## What it does

It writes a weekly marketing report that compares this week's numbers with last week's and checks a few key pages. Its push rule: report-only. Never change a campaign, budget, bid or page. Write only the run plan the write contract allows (runs, entities, inbox, agent views and columns).

## Stages

| Stage | Kind | Does |
|---|---|---|
| collect | model | Reads this week's and last week's totals per source and metric. |
| compare | code | Computes the change per source and metric, so no figure is the model's arithmetic. |
| audit | model | Opens each page to audit and notes visible issues. |
| learn | code | Turns feedback on earlier runs into learning and proposals before the write. |
| write | code | Applies the run input under the write contract. |

## Connectors

Installing the pack connects nothing and holds no secret. Connect each one yourself. Products named as alternatives are examples; whether each offers the access listed is unverified.

| Connector | Kind | Needed | Access | Used by |
|---|---|---|---|---|
| Analytics and ad platforms | mcp | required | read | collect |
| Web fetch | builtin | optional | read | audit |

## Settings

People edit these on the Desk Settings page.

| Setting | Type | Default | Note |
|---|---|---|---|
| `sources` | list | `["analytics", "search-ads", "social-ads"]` | each source is one more read from the analytics connector |
| `pages_to_audit` | list | `[]` | each page adds one page open per run |
| `change_alert_pct` | number | `20` | no extra cost; a lower value means more alerts |
| `max_inbox_per_run` | number | `5` | no extra cost; more messages ask more of your attention |

## Files

- `routine.toml`: type, schedule, store, settings and the gate.
- `prompt.md`: the routine prompt, with the untrusted-data clause and the push rule.
- `definition.json`: the record types, identity rules, setting filters and views.
- `pack.json`: the pack metadata, stages and connectors.
- `lib/week_over_week.py`: a standard-library script the code stage runs.

## Known risks

- Platforms report on different time zones and attribution windows, so a week can differ between sources. The report states the source of each number.
- A metric renamed by a platform looks like one metric gone and a new one at zero. Check a sudden drop to null before acting.
- Recommendations are the model's suggestion, never a change to spend.

## Inspiration

Inspired by these public n8n workflows (an idea source, not a port):

- [AI marketing report (GA, Google Ads, Meta Ads)](https://n8n.io/workflows/2783)
- [On-page SEO audit of any website](https://n8n.io/workflows/3224)
