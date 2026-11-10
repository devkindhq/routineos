# weekly-marketing-report

Each week, compares marketing metrics with the week before, audits a few key pages, and flags big moves. Status: template, version 1, piloted (run end to end twice in a cloud routine on a live site, report-only).

## What it does

It writes a weekly marketing report that compares this week's numbers with last week's and checks a few key pages. Its push rule: report-only. Never change a campaign, budget, bid or page. Write only the run plan the write contract allows (runs, entities, inbox, agent views and columns).

## Stages

| Stage | Kind | Does |
|---|---|---|
| windows | code | Works out the last completed Monday to Sunday week and the week before it, so both sources use the same dates. |
| collect | model | Runs one read-only Google Analytics report and two read-only Search Console queries (this week and last week) and saves the responses, for those two weeks. |
| normalize | code | Turns the analytics report into this-week.json and last-week.json, so no figure is the model's arithmetic. |
| normalize-search | code | Adds the search source (clicks, impressions, click rate, average position) to those two files. |
| compare | code | Computes the change per source and metric, so no figure is the model's arithmetic. |
| audit | model | Opens each page to audit and notes visible issues. |
| learn | code | Turns feedback on earlier runs into learning and proposals before the write. |
| write | code | Applies the run input under the write contract. |

## Connectors

Installing the pack connects nothing and holds no secret. Connect each one yourself. Products named as alternatives are examples; whether each offers the access listed is unverified.

| Connector | Kind | Needed | Access | Used by |
|---|---|---|---|---|
| Google Analytics (GA4) | mcp | optional | read | collect |
| Google Search Console | mcp | optional | read | collect |
| Web fetch | builtin | optional | read | audit |

## Settings

People edit these on the Desk Settings page.

| Setting | Type | Default | Note |
|---|---|---|---|
| `sources` | list | `["analytics", "search"]` | analytics is one report, search is two queries |
| `ga_property` | list | `[]` | the first entry is read; no extra cost |
| `search_site` | list | `[]` | the first entry is read, for example `sc-domain:example.com`; no extra cost |
| `pages_to_audit` | list | `[]` | each page adds one page open per run |
| `change_alert_pct` | number | `20` | no extra cost; a lower value means more alerts |
| `max_inbox_per_run` | number | `5` | no extra cost; more messages ask more of your attention |

## Files

- `routine.toml`: type, schedule, store, settings and the gate.
- `prompt.md`: the routine prompt, with the untrusted-data clause and the push rule.
- `definition.json`: the record types, identity rules, setting filters and views.
- `pack.json`: the pack metadata, stages and connectors.
- `lib/ga_weeks.py`: a standard-library script that splits one Google Analytics report into the two weeks.
- `lib/weeks.py`: a standard-library script that prints the two Monday to Sunday weeks every source uses.
- `lib/gsc_weeks.py`: a standard-library script that merges the two Search Console query responses into the weekly files.
- `lib/week_over_week.py`: a standard-library script the code stage runs.

## Known risks

- Schedule: Thursday 21:00 UTC. Both sources use the same explicit Monday to Sunday week (the last completed one as of the run's UTC date), and its Monday is the week label for every record.
- Google Analytics dates follow the property's time zone and Search Console dates are Pacific, so the edge days of a week can differ slightly between the two.
- Search Console data for the last day of a week can be incomplete if the run is early; a Thursday run avoids that.
- What `conversions` counts depends on the property's key events. Check them before reading it as a conversion rate.
- A week with no search rows is reported as zero clicks and impressions, and its average position is left out (an average over no impressions is not a number). Position is an average, and lower is better.
- Revenue is 0 when the property has no ecommerce data.
- A connector such as Composio also offers tools that change a property. Read-only is enforced by the prompt, not by the connector (this includes Search Console, whose connector can also submit sitemaps).
- Platforms report on different time zones and attribution windows, so a week can differ between sources. The report states the source of each number.
- A metric renamed by a platform looks like one metric gone and a new one at zero. Check a sudden drop to null before acting.
- Recommendations are the model's suggestion, never a change to spend.

## Inspiration

Inspired by these public n8n workflows (an idea source, not a port):

- [AI marketing report (GA, Google Ads, Meta Ads)](https://n8n.io/workflows/2783)
- [On-page SEO audit of any website](https://n8n.io/workflows/3224)
