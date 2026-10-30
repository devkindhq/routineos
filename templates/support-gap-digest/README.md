# support-gap-digest

Each week, groups repeated support questions and flags the ones your help pages do not answer yet. Status: template, version 1, unpiloted (no real run has checked it yet).

## What it does

It finds support questions that keep coming back and checks whether the help pages answer them. Its push rule: report-only. Never reply to a ticket, close one or edit a help page. Write only the run plan the write contract allows (runs, entities, inbox, agent views and columns).

## Stages

| Stage | Kind | Does |
|---|---|---|
| collect | model | Reads each ticket's question text and reference, with customer details removed. |
| group | code | Groups questions by a normalised form and counts each group. |
| check | model | Looks for an answer to each repeated question on the help pages. |
| learn | code | Turns feedback on earlier runs into learning and proposals before the write. |
| write | code | Applies the run input under the write contract. |

## Connectors

Installing the pack connects nothing and holds no secret. Connect each one yourself. Products named as alternatives are examples; whether each offers the access listed is unverified.

| Connector | Kind | Needed | Access | Used by |
|---|---|---|---|---|
| Help desk | mcp | required | read | collect |
| Web fetch | builtin | required | read | check |

## Settings

People edit these on the Desk Settings page.

| Setting | Type | Default | Note |
|---|---|---|---|
| `lookback_days` | number | `7` | a longer window means more tickets to read |
| `min_repeats` | number | `3` | no extra cost; a lower value means more groups to check |
| `help_center_urls` | list | `["https://example.org/help"]` | each page adds at least one page open per run |
| `max_inbox_per_run` | number | `5` | no extra cost; more messages ask more of your attention |

## Files

- `routine.toml`: type, schedule, store, settings and the gate.
- `prompt.md`: the routine prompt, with the untrusted-data clause and the push rule.
- `definition.json`: the record types, identity rules, setting filters and views.
- `pack.json`: the pack metadata, stages and connectors.
- `lib/group_questions.py`: a standard-library script the code stage runs.

## Known risks

- The grouping is literal: two wordings of one question land in two groups. The digest is a starting point for a person, not a count to report upward.
- Ticket text can hold personal data. The prompt removes it before grouping, but check the stored examples on the first runs.
- A help page can look like an answer and not be one. `answered` is the model's judgement; a person should confirm before closing a gap.

## Inspiration

Inspired by these public n8n workflows (an idea source, not a port):

- [RAG chatbot for company documents (Drive + Gemini)](https://n8n.io/workflows/2753)
- [HR and IT helpdesk chatbot](https://n8n.io/workflows/2752)
- [WhatsApp sales chatbot](https://n8n.io/workflows/2465)
