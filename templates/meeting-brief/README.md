# meeting-brief

Before each outside meeting, researches the other company and writes a short, cited brief to the Desk. Status: template, version 1, unpiloted (no real run has checked it yet).

## What it does

It prepares a short brief before each meeting that includes someone from outside the company. Its push rule: report-only. Never send, post, accept, decline or change a meeting. Write only the run plan the write contract allows (runs, entities, inbox, agent views and columns).

## Stages

| Stage | Kind | Does |
|---|---|---|
| calendar | model | Lists meetings inside the look-ahead window that include an outside domain. |
| research | model | Searches for each outside company and reads a few pages, keeping each source URL. |
| learn | code | Turns feedback on earlier runs into learning and proposals before the write. |
| write | code | Applies the run input under the write contract. |

## Connectors

Installing the pack connects nothing and holds no secret. Connect each one yourself. Products named as alternatives are examples; whether each offers the access listed is unverified.

| Connector | Kind | Needed | Access | Used by |
|---|---|---|---|---|
| Calendar | connector | required | read | calendar |
| Web search | builtin | required | read | research |
| Web fetch | builtin | required | read | research |

## Settings

People edit these on the Desk Settings page.

| Setting | Type | Default | Note |
|---|---|---|---|
| `lookahead_hours` | number | `24` | a longer window means more meetings to research per run |
| `internal_domains` | list | `[]` | no extra cost; meetings with only these domains are skipped |
| `max_research_pages` | number | `5` | each page is one more page open |
| `max_inbox_per_run` | number | `5` | no extra cost; more messages ask more of your attention |

## Files

- `routine.toml`: type, schedule, store, settings and the gate.
- `prompt.md`: the routine prompt, with the untrusted-data clause and the push rule.
- `definition.json`: the record types, identity rules, setting filters and views.
- `pack.json`: the pack metadata, stages and connectors.

## Known risks

- A wrong company match: two companies can share a name. The brief keys on the attendee's domain, and each line names its source so a person can check it.
- Calendar contents are private. The routine stores attendee domains and the meeting title, never attendee names or addresses; check that storing titles is acceptable where you work.
- A meeting description or web page can carry instructions. The prompt treats all of it as data.

## Inspiration

Inspired by these public n8n workflows (an idea source, not a port):

- [AI web researcher for sales](https://n8n.io/workflows/2324)
- [Company enrichment from website content](https://n8n.io/workflows/1862)
- [Website chatbot with lead capture and Outlook calendar](https://n8n.io/workflows/2786)
