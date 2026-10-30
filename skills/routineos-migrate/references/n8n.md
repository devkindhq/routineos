# Migrate from n8n

`routineos migrate n8n <file-or-https-url> --out DIR` reads an n8n workflow export (a bare workflow, or a template response that holds it under `workflow`) and writes a pack and a report. See the [overview](README.md) and the [concept map](concepts.md) for the full node list. Facts about n8n below carry a source. n8n's own export format is documented at https://docs.n8n.io/workflows/export-import/.

## Supported nodes

| n8n | Concept | Becomes |
|---|---|---|
| Schedule Trigger | trigger.schedule | the routine schedule, see below |
| Webhook, Form Trigger, chat triggers, Manual, Execute Workflow Trigger | trigger.webhook, form, chat, manual, subworkflow | the default schedule `0 22 * * 1-5` plus the Desk action queue, with an issue |
| app triggers | trigger.app | a scheduled poll every hour on the hour |
| Error Trigger, error workflow setting | trigger.error, failure.workflow | failure handling: an Inbox alert |
| a node for a known app (Gmail, Slack, Sheets and others) | step.app | a model stage using a connector, read or write |
| HTTP Request | step.http | a model stage using an `http` connector; headers and auth are never copied |
| Code, Function | step.code | a code stage with a stub and the original source kept |
| AI Agent | step.agent | a skill stage with a generated `skills/<id>/SKILL.md` |
| LLM, summarisation, extractor, classifier chains | step.llm | a skill stage |
| IF, Switch, Filter | step.branch | a model stage that states the condition |
| Merge | step.merge | a model stage that states how inputs combine |
| Loop Over Items | step.loop | a model stage that runs the body for each item |
| Set, Aggregate, Split Out, Sort, Limit, Rename | step.transform | a model stage |
| No Operation | step.noop | dropped, recorded as info |
| Wait | step.wait-time, step.wait-approval | a delay becomes "on the next run"; an approval wait becomes a gate stage |
| Execute Workflow | step.subworkflow | a model stage naming the child, needs a person |
| Respond to Webhook | step.respond | output goes to the Desk Inbox, needs a person |
| Sticky Note | step.note | text goes to the pack readme |
| Error output (a node set to continue using the error output) | failure.node | steps reachable only from the error output are kept, start with "Only if an earlier step failed:" and raise a needs-person issue; n8n appends the error output after a node's own outputs (https://raw.githubusercontent.com/n8n-io/n8n/master/packages/workflow/src/node-helpers.ts, fetched 2026-10-30); the slot is verified for IF (2) and one-output nodes (1), unverified for Switch and for Filter's discarded output |
| anything else | step.unknown | a "Needs a person" model stage and an `unmapped` issue |

Static data between runs becomes a store collection. Per-node error settings (`onError`, continue on fail) become the stage's failure rule.

## Schedule

The Schedule Trigger parameter shape is read from https://raw.githubusercontent.com/n8n-io/n8n/master/packages/nodes-base/nodes/Schedule/ScheduleTrigger.node.ts (fetched 2026-10-30): `rule.interval[]` items with a `field` (seconds, minutes, hours, days, weeks, months or cronExpression), per-field interval keys and time keys (`triggerAtHour`, `triggerAtMinute`, `triggerAtDay` where 0 is Sunday, `triggerAtDayOfMonth`).

| n8n | cron |
|---|---|
| seconds, minutes | `0 * * * *`, plus an issue: RoutineOS runs at most hourly |
| hours (N) | `M */N * * *` (N=1 gives `M * * * *`) |
| days (N) | `M H */N * *` (N=1 gives `M H * * *`) |
| weeks | `M H * * D1,D2`; a week interval above 1 is reported |
| months (N) | `M H DOM */N *` |
| cronExpression | a 6-field expression drops the seconds field; a minute field that is not one number becomes its first number, or 0, plus an issue |

Several rules: the first is used and the rest are reported. The workflow timezone is kept in the plan and reported, because RoutineOS schedules are UTC. The converter does not shift hours. The legacy `cron` node is treated as unverified and gets the default schedule.

## Expressions

A deterministic pattern pass runs over strings that start with `=` or contain `{{ }}`. Expression syntax is documented at https://docs.n8n.io/data/expressions/. That page does not cover every variable, so the rewriter is our own and anything it does not recognise is kept and flagged.

| Pattern | Rewritten as |
|---|---|
| `$json.a.b`, `$json["a"]`, `$input.item.json.a`, `$input.first().json.a` | "`a.b` from the previous step" |
| `$('Node').item.json.a`, `$('Node').first().json.a`, `$node["Node"].json.a` | "`a` from step `<id of Node>`" |
| `$now`, `$today` | "the run's start time" |
| `$execution.resumeUrl` | "the gate decision", plus an issue |
| anything else in `{{ }}` | kept verbatim in backticks plus a `needs-person` expression issue |

Each rewritten reference is added to the step's `inputs`, so stage inputs are explicit. The skill rewrites flagged expressions by hand.

## AI nodes

AI Agent and chain nodes become skill stages; their system message and prompt go to the generated skill with expressions rewritten (see https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.agent/ for the node). Sub-nodes are read from the `ai_*` connections:

- chat model: the model is Claude, and the provider is recorded (step.ai-model)
- memory: a store collection `memory/<id>` (step.ai-memory)
- tools: connectors on the owning skill stage (step.ai-tool)
- output parser: the output shape is described in the skill (step.ai-output-parser)
- vector stores, embeddings, document loaders and text splitters: reported only, because RoutineOS has no vector store (step.ai-vector, unmapped)

## Code nodes

The converter writes `lib/<id>.py`, a stub that prints "not translated yet" to stderr and exits 2, and keeps the original in `lib/source/<id>.<lang>.txt`. The Code node runs JavaScript or Python (https://docs.n8n.io/code/code-node/). Translating it is the skill's job, with a person reviewing, or the step is replaced by a model stage. The converter never runs it.

## Template search and fetch

- `migrate search "<words>" [--rows N]` calls `https://api.n8n.io/api/templates/search` and prints id, name and views, plus the gallery total.
- `migrate fetch <id> --out DIR` calls `https://api.n8n.io/api/templates/workflows/{id}` and converts `.workflow`. The id must be digits only.
- Both use the vetted pack reader: https only, no redirects, public addresses only, a 20 second timeout, and a size cap (1 MiB for search, 2 MiB for a workflow).
- The API shape (search returns `totalWorkflows`, `workflows[]`, `filters`; one template returns the importable JSON under `workflow`) was observed on 2026-10-30 by direct request. n8n publishes no documentation or stability guarantee for it that we found, so treat it as undocumented and subject to change. Rate limits: unverified.
- Nothing is stored. A fetched template is marked untrusted: generated skills get a third-party banner and the report gets a "Read before you install" section. See [limits](limits.md) for the licence question.

## Wrapping for a later tool

The functions return plain data, so a later MCP tool can wrap them without the CLI. In `migrate_n8n.py`:

| Function | Returns | Tool |
|---|---|---|
| `search(query, rows, opener)` | `{'total', 'results': [{'id', 'name', 'views'}]}` | `search_n8n` |
| `fetch(template_id, opener)` | `(workflow dict, source dict)` | `convert_n8n` (first half) |
| `parse(workflow, source)` | a `routineos.migration.v1` plan dict | `convert_n8n` (second half) |
| `rewrite(text, names_to_ids)` | the rewritten text, with inputs and issues | internal |

And in `migrate.py`: `emit(plan)` returns `(pack dict, MIGRATION.md text)`, `validate_plan(plan)` returns a list of problems, and `write_out(pack, report, out_dir)` writes the two files. All raise `migrate.MigrateError` with a plain message.
