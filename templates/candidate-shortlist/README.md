# candidate-shortlist

Scores new applicants against your rubric with evidence per criterion and suggests a shortlist. It never rejects anyone. Status: template, version 1, unpiloted (no real run has checked it yet).

## What it does

It scores new applicants against a written rubric and suggests a shortlist for a person to review. Its push rule: report-only. It never rejects anyone. Never reject, advance, contact or move an applicant. Write only the run plan the write contract allows (runs, entities, inbox, agent views and columns).

## Stages

| Stage | Kind | Does |
|---|---|---|
| collect | model | Lists new applicants per role and reads each CV. |
| mark | model | Marks each criterion met, partly or not, with a short quote as evidence. |
| score | code | Turns the marks into a weighted 0 to 100 score. |
| learn | code | Turns feedback on earlier runs into learning and proposals before the write. |
| write | code | Applies the run input under the write contract. |

## Connectors

Installing the pack connects nothing and holds no secret. Connect each one yourself. Products named as alternatives are examples; whether each offers the access listed is unverified.

| Connector | Kind | Needed | Access | Used by |
|---|---|---|---|---|
| Applicant tracking system | mcp | required | read | collect |

## Settings

People edit these on the Desk Settings page.

| Setting | Type | Default | Note |
|---|---|---|---|
| `roles` | list | `[]` | each role adds its new applicants to the run |
| `must_have` | list | `["the core skill named in the role"]` | each criterion adds one mark per applicant |
| `nice_to_have` | list | `[]` | each criterion adds one mark per applicant |
| `shortlist_size` | number | `5` | no extra cost |
| `max_inbox_per_run` | number | `5` | no extra cost; more messages ask more of your attention |

## Files

- `routine.toml`: type, schedule, store, settings and the gate.
- `prompt.md`: the routine prompt, with the untrusted-data clause and the push rule.
- `definition.json`: the record types, identity rules, setting filters and views.
- `pack.json`: the pack metadata, stages and connectors.
- `lib/score_rubric.py`: a standard-library script the code stage runs.

## Known risks

- Automated screening can carry bias in from the rubric or from the CV text. The routine scores only written criteria, records evidence for each mark, and a person makes every decision.
- Hiring rules on automated decisions differ by country. Check yours before use; this template makes no legal claim.
- A CV can hide instructions aimed at the model. The prompt ignores them and notes them for the reviewer.

## Inspiration

Inspired by these public n8n workflows (an idea source, not a port):

- [AI HR workflow for CV analysis and candidate evaluation](https://n8n.io/workflows/2860)
