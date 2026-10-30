# content-calendar

Drafts cited posts from your topics and sources in your house style, and publishes only what a person approves. Status: template, version 1, unpiloted (no real run has checked it yet).

## What it does

It keeps a content calendar: research the topics, draft posts in the house style with citations, and queue each for approval. Its push rule: gated. Nothing is published until a person has approved it on its gate; only an approved draft is posted, once. Never edit or delete a published post.

Anything that leaves the routine waits behind an email gate that times out after 72 hours. The first run is report-only and sends no gated messages.

## Stages

| Stage | Kind | Does |
|---|---|---|
| research | model | Reads the feeds and searches each topic, keeping every source URL. |
| draft | skill | Drafts each post in each format in the house style, with a marker per claim. |
| cite | code | Checks every citation marker has a source and every source is cited. |
| learn | code | Turns feedback on earlier runs into learning and proposals before the write. |
| write | code | Applies the run input under the write contract. |
| approve | gate | A person approves, edits or declines each draft; the gate times out after 72 hours. |
| publish | model | On a later run, publishes only the drafts whose decision is approved, exactly as approved. |

## Connectors

Installing the pack connects nothing and holds no secret. Connect each one yourself. Products named as alternatives are examples; whether each offers the access listed is unverified.

| Connector | Kind | Needed | Access | Used by |
|---|---|---|---|---|
| Web search | builtin | required | read | research |
| Web fetch | builtin | required | read | research |
| Mail for approvals | connector | optional | write | approve |
| Publishing platform | mcp | optional | write | publish |

## Settings

People edit these on the Desk Settings page.

| Setting | Type | Default | Note |
|---|---|---|---|
| `topics` | list | `["product updates", "how-to guides"]` | each topic adds research per run |
| `source_feeds` | list | `["https://example.org/feed.xml"]` | each feed adds at least one page open per run |
| `formats` | list | `["blog", "linkedin"]` | each format is one more draft per post |
| `posts_per_week` | number | `2` | each post is one research and drafting pass |
| `max_inbox_per_run` | number | `5` | no extra cost; more messages ask more of your attention |

## Files

- `routine.toml`: type, schedule, store, settings and the gate.
- `prompt.md`: the routine prompt, with the untrusted-data clause and the push rule.
- `definition.json`: the record types, identity rules, setting filters and views.
- `pack.json`: the pack metadata, stages and connectors.
- `lib/check_citations.py`: a standard-library script the code stage runs.
- `skills/house-style/SKILL.md`: the skill the skill stage uses.

## Known risks

- A model can misread a source. Every claim carries a marker and the citation check runs before a draft is queued, but a person should open the sources before approving.
- Copying too closely from a source is a copyright risk. The house-style skill asks for your own words and short quotes only.
- Publishing is permanent in practice. Nothing posts without approval, and the routine never edits a published post.

## Inspiration

Inspired by these public n8n workflows (an idea source, not a port):

- [Multi-platform social content creation with AI](https://n8n.io/workflows/3066)
- [Personalized AI tech newsletter (RSS, OpenAI, Gmail)](https://n8n.io/workflows/3986)
- [Write a WordPress post with AI from keywords](https://n8n.io/workflows/2187)
- [SEO WordPress content with Perplexity research](https://n8n.io/workflows/3291)
