# inbox-triage

Labels new mail threads, drafts replies in your style, and sends a reply only after a person approves it. Status: template, version 1, unpiloted (no real run has checked it yet).

## What it does

It triages a shared mailbox: label each new thread, summarise it, and draft a reply where one is needed. Its push rule: gated. Nothing leaves this routine until a person has approved it on its gate; only an approved draft is sent, once. Never delete, archive or move mail.

Anything that leaves the routine waits behind an email gate that times out after 24 hours. The first run is report-only and sends no gated messages.

## Stages

| Stage | Kind | Does |
|---|---|---|
| read | model | Lists and reads threads received inside the look-back window. |
| label | model | Gives each thread one label and a short factual summary. |
| draft | skill | Drafts a reply for each thread that needs one, in the house reply style. |
| learn | code | Turns feedback on earlier runs into learning and proposals before the write. |
| write | code | Applies the run input under the write contract. |
| approve | gate | A person approves, edits or declines each draft; the gate times out after 24 hours. |
| send | model | On a later run, sends only the drafts whose decision is approved, exactly as approved. |

## Connectors

Installing the pack connects nothing and holds no secret. Connect each one yourself. Products named as alternatives are examples; whether each offers the access listed is unverified.

| Connector | Kind | Needed | Access | Used by |
|---|---|---|---|---|
| Mail (read) | connector | required | read | read |
| Mail for approvals | connector | optional | write | approve |
| Mail (send) | connector | optional | write | send |

## Settings

People edit these on the Desk Settings page.

| Setting | Type | Default | Note |
|---|---|---|---|
| `labels` | list | `["needs-reply", "fyi", "billing", "sales", "suspect"]` | no extra cost; every thread gets exactly one label |
| `lookback_hours` | number | `12` | a longer window means more threads to read |
| `skip_from_domains` | list | `[]` | no extra cost; threads from these domains are kept but marked dropped |
| `draft_replies` | toggle | `true` | drafting adds a model step per thread labelled needs-reply |
| `max_inbox_per_run` | number | `10` | no extra cost; more messages ask more of your attention |

## Files

- `routine.toml`: type, schedule, store, settings and the gate.
- `prompt.md`: the routine prompt, with the untrusted-data clause and the push rule.
- `definition.json`: the record types, identity rules, setting filters and views.
- `pack.json`: the pack metadata, stages and connectors.
- `skills/reply-style/SKILL.md`: the skill the skill stage uses.

## Known risks

- A wrong label hides a thread that needed a reply. The skipped view shows every thread the settings dropped, and the label is a suggestion a person can correct.
- A draft can sound confident about something the thread did not say. The reply-style skill forbids new promises, and nothing is sent without approval.
- Mail is private. The routine stores the sender's domain, subject and a short summary, never full bodies or addresses.

## Inspiration

Inspired by these public n8n workflows (an idea source, not a port):

- [Gmail AI auto-responder: draft replies](https://n8n.io/workflows/2271)
- [Auto-categorise Outlook emails with AI](https://n8n.io/workflows/2454)
- [Suggest meeting slots using AI](https://n8n.io/workflows/1953)
- [Email summary agent](https://n8n.io/workflows/2722)
