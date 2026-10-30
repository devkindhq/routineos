# invoice-exceptions

Reads incoming invoices and flags duplicates, large amounts and new vendors for a person to check. It never pays. Status: template, version 1, unpiloted (no real run has checked it yet).

## What it does

It reads incoming invoices and flags the ones a person should check before anyone pays them. Its push rule: report-only. It never pays. Never pay, approve, schedule, reply to or mark anything. Write only the run plan the write contract allows (runs, entities, inbox, agent views and columns).

## Stages

| Stage | Kind | Does |
|---|---|---|
| collect | model | Lists recent invoices and reads each into structured fields, leaving out anything unclear. |
| check | code | Flags duplicates, amounts over the threshold and new vendors; AMOUNT is the amount_threshold setting. |
| learn | code | Turns feedback on earlier runs into learning and proposals before the write. |
| write | code | Applies the run input under the write contract. |

## Connectors

Installing the pack connects nothing and holds no secret. Connect each one yourself. Products named as alternatives are examples; whether each offers the access listed is unverified.

| Connector | Kind | Needed | Access | Used by |
|---|---|---|---|---|
| Invoice mailbox or folder | connector | required | read | collect |

## Settings

People edit these on the Desk Settings page.

| Setting | Type | Default | Note |
|---|---|---|---|
| `amount_threshold` | number | `1000` | no extra cost; a lower value means more flags |
| `known_vendors` | list | `[]` | no extra cost; vendors not listed are flagged as new |
| `lookback_days` | number | `7` | a longer window means more invoices to read |
| `max_inbox_per_run` | number | `10` | no extra cost; more messages ask more of your attention |

## Files

- `routine.toml`: type, schedule, store, settings and the gate.
- `prompt.md`: the routine prompt, with the untrusted-data clause and the push rule.
- `definition.json`: the record types, identity rules, setting filters and views.
- `pack.json`: the pack metadata, stages and connectors.
- `lib/invoice_checks.py`: a standard-library script the code stage runs.

## Known risks

- Reading a PDF can misread an amount or number. The routine leaves unclear values out, and every flag is for a person to check, never a decision.
- Duplicate checks look back 90 days of recorded invoices; an older duplicate is not caught.
- Invoice fraud often arrives as changed bank details. The prompt flags it, but this routine is not a fraud control.

## Inspiration

Inspired by these public n8n workflows (an idea source, not a port):

- [Invoice data extraction with LlamaParse and OpenAI](https://n8n.io/workflows/2320)
