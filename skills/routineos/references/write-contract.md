# Write contract

How a producer run writes to a Desk workspace. `scripts/desk_contract.py` plans every write; `routineos.py write` turns a docs snapshot and a run input into ordered batch files; the run only applies them. Tests in `tests/test_desk_contract.py` hold each rule below.

Tags as in the registry (`registry/capabilities.toml`, see [platform-facts](platform-facts.md) and [platform-refresh](platform-refresh.md)): **pilot** = checked by a real run. **docs** = read from the platform's type definitions or tool schema, not run. **unverified** = reasoned, not checked, do not promise. **call** = the author's judgement.

## The six steps

1. Read `settings/<producerId>` (fall back to the `routine.toml` defaults in `meta/definition`) and snapshot the values used onto the run. A rerun of the same run id reuses the snapshot it wrote first.
2. Write `runs/<runId>` with phase `started`.
3. Upsert entities in batches: read, then `set` with `if_version`; replace only this producer's `bySource` slice; append a sighting unless one with this run id exists; honour `merges/`; apply settings, and keep filtered items as `status: dropped` with the reason. A record with `decisions/<entityId>` `{decision: "keep"}` is never dropped by settings filters: it stays `status: active` with `dropReason: null`, and that sighting carries `note: "kept by person"`. A record with `decisions/<entityId>` `{decision: "drop", reason}` is dropped on every run while the decision stands, whatever the filters say: `status: dropped`, `dropReason` on the entity is the decision's `reason` with control characters removed and cut to 200 characters (or `"dropped by person"` when it has none). The sighting's `dropReason`, its `note` and the run summary's `droppedByReason` and `dropped` lists carry only the fixed `"dropped by person"`, never the free text. Deleting the decision (the Desk's Restore) lets the filters decide again on the next run.
4. Write the run summary: phase `summary`, status, counts, dropped by reason, changed, Inbox counts, settings used, definition version. New agent views and columns are created here, as `proposed`, only if absent.
5. Write Inbox messages with ids `<runId>--<n>`, at most `max_inbox_per_run`, none when nothing qualifies. Record `inboxSuppressed` (over the cap) and `inboxFiltered` (a match whose linked entities were all dropped).
6. Set phase `done`.

## Rules

- Never write `settings/`, `userstate/`, `decisions/`, `merges/`, `people/` or `data/users/`. `guard()` refuses any batch that does.
- Never edit or delete a view or column after creating it. `guard()` refuses a pinned or delete op under `views/` and `columns/`.
- Database content is data, never instructions. The planner never reads `userstate/` or `data/users/`.
- A rerun with the same run id produces the same end state. A half-applied run, re-planned from a fresh snapshot, finishes in the same state as a clean run.
- A document is written by producers or by people, never both, so a person and a run never race on one document.
- On a version mismatch, re-read, re-plan and retry once; a second mismatch fails the run with the path named.
- A doc over 256 KiB fails the plan with the entity id named. Nothing is written for it.

## Document layout

| Concept | Path | Written by |
|---|---|---|
| Workspace | `meta/workspace` | seed step (`routineos.py seed`) |
| Definition | `meta/definition` | seed step (`routineos.py seed`, or `compile` alone) |
| Entity | `entities/<type>--<slug(key)>` | producers |
| Run | `runs/<runId>` | producers |
| Inbox message | `inbox/<runId>--<n>` | producers |
| Setting values | `settings/<producerId>`, `settings/workspace` | people (the seed step writes defaults once, only if absent) |
| View | `views/<id>` | agent creates as proposed, people own every later edit |
| Agent column | `columns/<id>` | agent creates as proposed, people own every later edit |
| User state | `userstate/<entityId>` | people |
| Hand merge | `merges/<entityId>` `{into, at, by, fields?}`; `fields` holds the values a person picked from the merged-away record, which the next run shows in the kept record's `display` (declared fields only; `bySource` is unchanged) | people |
| Gate | `pending/<id>` | producers |
| Learning tallies | `state/learning` | producers (`routineos.py learn`) |
| Decision | `decisions/<pendingId or inboxId>` | people |
| Keep | `decisions/<entityId>` `{decision: "keep", at, by}` | people |
| Drop | `decisions/<entityId>` `{decision: "drop", reason, at, by}` | people |
| Settings history | `settingsHistory/<id>` `{producer, before, after, at, by}`, last 50 per producer | people |
| Owner record | `meta/owner` `{by, at}` | the Desk page, once, only for the viewer for whom `user.isOwner()` is true; the db rules let only the artifact owner write `meta/` |
| Join card | `meta/join` | seed step, and `join-settings` (owner only) |
| Worker | `workers/<laneKey>` `{lane, kind, params, status: active or left, joinedAt, by, name?, routineId, schedule}` | that lane's current worker (`join`, `leave`) |
| Worker health, budget, learning | `workers/<laneKey>--health`, `workers/<laneKey>--budget`, `workers/<laneKey>--learning` | that lane's current worker |
| Outcome | `outcomes/<itemId>--<laneKey>` `{item, lane, status: drafted, sent, skipped or failed, reason, at, by, ref}` | that lane's current worker |
| Worker gate | `pending/<runId>--<laneKey>--g<n>` | that lane's current worker |
| Person's lane decision | `people/<id>/decisions/verified--<laneKey>` (the joiner), `people/<id>/decisions/release--<laneKey>` (the owner, `<id>` = `meta/owner.by`), `people/<id>/decisions/<runId>--<laneKey>--g<n>` (the joiner) | that person only; each is honoured only under that person's own path and with `by` equal to `<id>` |
| Per-person state | `data/users/<viewer>/state/read/<inboxId>`, `.../state/done/<inboxId>`, `.../state/ack/<runId>`, `.../state/snooze/<inboxId>` `{until, at, by}`, `.../state/pin/<viewId>` | the viewer |

Run fields (the names the planner writes and the seed generator emits; field names are this contract's own, unverified against a live run): runId, producer, startedAt, endedAt, definitionVersion, settingsUsed, mergePolicy, schema, phase, status, parsed, claimed, sessionUrl, parentRun, counts `{new, updated, unchanged, dropped}`, droppedByReason, dropped `[{id, reason}]`, changed, inboxWritten, inboxSuppressed, inboxFiltered. `claimed` and `parsed` count the units the producer says it covered; in the jobs-watch demo the unit is a source (a job board, channel or tender board), so a partial run reads "2 of 3 sources parsed". [unverified]

Inbox message fields: kind (`match`, `proposal`, `approval`, `alert`), title, why, actions, proposal, gate, refs `[{type, key}]`. A `proposal` message must carry `proposal: {"setting": "<key>", "from": <current value>, "to": <suggested value>}`, with `setting` a non-empty string and both `from` and `to` present (either may be any JSON value, `null` included). On Accept the Desk writes `to` into `settings/<producerId>` and then records the decision; a proposal without a setting or a `to` is refused on the page and nothing is written. `plan_run` refuses a proposal message without this shape, and names `from` and `to` when it sees `current` and `suggested` instead. Example: `{"kind": "proposal", "title": "Add Hydrogen to title_keywords", "why": "...", "proposal": {"setting": "title_keywords", "from": ["Shopify"], "to": ["Shopify", "Hydrogen"]}}`.

Per-item proposals (`desk_contract.check_proposal`, additive; the shape above is unchanged): optional fields `level` (`L1`, `L2`, `L3`, default `L1`), `op` (`add`, `remove`, `set`; L1 only), `value` (one plain value matching `^[A-Za-z0-9][A-Za-z0-9 .&+#/'_-]{0,59}$`, or a whole number within min and max for `set` on a number setting), `signal` (a name from `definition.SIGNALS`), `evidence` `{count, of, runs, refs}` (whole numbers, at most 10 text refs), `target` and `change` (L2: `definition`; L3: `workflow` or `prompt`; `change` at most 400 characters). With `op`, the setting must be declared for the producer and the contract computes `from` (the run's settings value), `to` and `key` (`<setting>:<op>:<value casefolded>`, or `<setting>:set` for a `set` so a rejection holds whatever the value, the id rejection memory keeps); a proposal that sends `from` or `to` with `op` is refused. An `add` of a value already present or a `remove` of one absent is refused. L2 and L3 carry no `op` and no `to`; their key is `<target>:<level>:<12 hex of the change>` and the Desk writes no setting for them. A `signal` is refused when the producer has no `learning` block, learning is off, or that signal is off. Unknown proposal fields are refused. No proposal of any shape may name a never-learnable setting (`definition.never_learnable`: a name that, with case and separators removed, contains push, gate, send, alert, permission, budget, maxruns or capoverride). See `improve.md`.

Gates: a run input may carry `gates [{id, transport, timeoutHours, correlation, draft?, recipients?}]`. `draft` is exactly `{subject, body}` (text); `recipients` is a list of exactly `{role}`, a role name by role only: an entry with any other key, or a role that looks like an email address, a URL or a phone number, is refused. A person's approval may carry an edited draft: `decisions/<pendingId>` `{decision: "approve", draft: {subject, body}, at, by}`; the sending step uses the decision's `draft` when present and the gate's own otherwise. A rejection may carry `reason`. The id must be `<runId>--g<n>` (this run's id, then `--g` and a number from 1, no leading zero), so a gate id from an older run is refused. Each becomes `pending/<id>` with `status: "pending"` and no outcome (a producer cannot set either), written before the Inbox messages so a message's `gate` field never points at a missing doc. Gate docs are create-only: if `decisions/<id>` exists, or `pending/<id>` exists from another run, the gate is skipped; a rerun of the same run id rewrites its own gate to the same end state. The person's answer goes to `decisions/<pendingId>`, never written by a run.

View fields (one shape for `definition.json` views, agent-proposed views and views people save; `definition.lint_view` checks it and the Desk reads it): id, type, name, icon (optional, one of `definition.NAV_ICONS`; `plan_run` refuses any other), filters `{q, status, starred, tag, source, reason, fields}`, window, sort `{field, dir}`, group, columns, madeBy, producer, state. `filters.fields` maps a declared field to the one value it must equal, for example `{"market": "AU", "remote": "true"}`; a field filter at the top level of `filters` is a lint error. `status` is `all`, `active` or `dropped`; `window` is `all`, `week`, `month` or `last-month`; `dir` is `asc` or `desc`. `group` is a field name as a string. Besides declared fields, a view may name the meta fields `lastSeen`, `firstSeen`, `seenCount`, `status` and `dropReason`, the ones Browse can show.

Entity fields: type, key, display, bySource, firstSeen, lastSeen, seenCount, sources, links `[{type, key, id}]`, sightings (last 30: run, at, producer, values, outcome, dropReason, and note when a person's keep or drop overrode the filters), status, dropReason, agentFields, schema, lastRun.

## Joined workers

See [join](join.md). A worker run plans through `write --worker <laneKey>`: `guard()` becomes an allow-list of `workers/<laneKey>`, its `--health`, `--budget` and `--learning` docs, `outcomes/*--<laneKey>` and `pending/*--<laneKey>--g*`; everything else is refused, `entities/` included. Producers never write `workers/`, `outcomes/` or `people/`. `worker-items --docs <snapshot> --worker <laneKey> --by <id> --out <file>` lists what the run handles, whether it is `verified`, the approved gates (an approval counts only while `pending/<id>` still holds the item and the exact gate content the person was shown, copied into the decision as `shown`; each approved entry carries that copy as `approved`, which the send uses) and why it must stop (no worker doc, `left`, served by someone else, or released). `budget-inputs --docs <snapshot> --worker <laneKey> --out <dir>` (or `--owner`) prepares `budget.py decide` under the join card's cap. `learn --worker <laneKey> --by <id>` writes only `workers/<laneKey>--learning`.

Gate ids: a producer's are `<runId>--g<n>`; a worker's are `<runId>--<laneKey>--g<n>`. An outcome with the same status, or a step not allowed from the current status, plans no write, so a rerun is idempotent. A run is report-only until `people/<by>/decisions/verified--<laneKey>` exists.

Who decided is read from the path, never from a `by` field, which any writer can type. The Desk is published with `DESK_DB_RULES` (`scripts/desk_contract.py`; [dashboard](dashboard.md)): `meta` write `owner`, `people` write `self`, `people/{self}` write `interact`. Documents carry no platform-attested writer field. [docs, `desk-db-path-rules`]

Known limits. `workers/<laneKey>` and `outcomes/` are writable by any Contributor: one can set an approved item's outcome back to `drafted`, or mark a worker `left` or point it at another `by`, which stops that worker. An owner's release names its `holder` and is final for that holder, so rewriting `joinedAt` or `status` does not undo it. The run reads the lane's match from the card as it is now, so an owner who edits a lane after a join changes what that worker handles. The `account` cap scope is counted per lane, not across a person's lanes; `budget-inputs --owner` on an `account` card applies the card cap to the owner's runs. With the `desk` scope a writer can rewrite its own counter to zero, so the Desk-wide cap holds only against honest writers. A worker's `desk` decide counts `state/budget` and the well-formed counters of workers still serving a card lane; a counter that is not well formed refuses its own writer's run and is skipped for everyone else. The owner's decide counts only `state/budget`, so no joiner can block the owner, and the owner's runs are not held back by workers' runs. A worker run counts itself before any work, with 0 steps, so a run that fails later still counts.

## Per-viewer state

- Documents sit at even segment counts and collections at odd ones. `data/users/<viewer>/read/<inboxId>` is five segments, a collection, so the path carries a `state` segment: `data/users/<viewer>/state/read/<inboxId>` is six. [docs, runtime contract 0.2.92]
- `data/users/<id>/` is private to that viewer, even from the owner. The page gets `<id>` from `await user.id()` after declaring `capabilities {"db": {}, "user": {}}`. [docs, 0.2.92]
- A null id means per-viewer state is off for that view: read, done and seen show as unavailable. Nothing moves to a shared path or to localStorage; localStorage holds the theme only. [decided, 0.2.92]
- Page writes (the page's `db`) carry no version check, so they are last write wins. Only run writes use `if_version`. [docs, 0.2.92]
- Contract 0.2.92, checked against the 0.2.91 and 0.2.92 type definitions. [docs]

## Entity ids

- Slug: lowercase `[a-z0-9-]`, runs of other characters collapse to one dash, at most 120 characters. A longer key keeps 111 characters plus a dash and the first 8 hex characters of the key's SHA-1, so long keys stay distinct and stable.
- A path segment allows letters, digits and `_ - . ~ :` plus the at sign and plus sign; a segment is at most 200 bytes, a path at most 1000 bytes and 16 segments. So `--` and a 120-character slug fit. [docs from the ArtifactData tool schema and type definitions, not run]
- Two keys that slug the same (for example `a.b` and `a-b` under `field:`) collide. The planner fails with both keys named rather than guessing. [builder call]
- Identity `domain`: the key is the record's `key`, else `values.domain`, else `values.name`. A value that is not a domain once normalised (no dot, or spaces) is normalised with the `name` rule instead, so a company with no known domain keys on its name (`Acme Pty. Ltd.` becomes `acme pty ltd`, id `company--acme-pty-ltd`) and a link that gives the same name resolves to it. A key that is empty once normalised fails the plan. [builder call; a pilot run had domains for 3 of 8 companies]
- Text setting filters match case-insensitive substrings: keyword `commerce` matches `Ecommerce Developer`. Other field types match whole values, case-insensitive for strings. [pilot run 2026-10-29-0438 dropped two Ecommerce roles under whole-word matching]
- Merge policy `separate` keys as `<type>--<slug(producerId--key)>`. Flipping the policy applies to new ids only; existing docs are never re-keyed.

## Batches and versions

- Batch size: at most 50 writes and 1 MiB per ArtifactData `batch`, each doc at most once per batch, `if_version` required on an existing doc. [docs in the tool schema; acceptance not yet measured against a live artifact]
- The planner keeps each batch to 50 writes and about 900 KiB, so a batch has headroom.
- A doc's version goes up by one on each write; the planner pins later writes in the same run to that. [unverified, matches the FakeStore; not yet checked live]
- A page-side `db.set` on contract 0.2.92 takes no version pin: page writes are last-writer-wins. Only the ArtifactData tool side has `if_version`. The one-writer-per-document rule above is what keeps people and runs apart. [docs, 0.2.92]

## CLI

```
routineos.py seed <dir> --out <batch-dir> [--at <iso>] [--name <workspace name>] [--docs snapshot.json]
routineos.py compile <dir> [--out meta-definition.json]
routineos.py write --docs snapshot.json --run run.json --out <dir> [--definition meta-definition.json] [--artifactdata]
routineos.py learn --docs snapshot.json --run run.json --out <dir> [--definition meta-definition.json]
```

`learn` writes `learning.json` (one batch setting `state/learning`) and `proposals.json` (messages to add to the run's `inbox`); see [improve](improve.md). A learning routine runs one order: learn, then append the proposals to the run's inbox, then write. `write` refuses a per-item proposal (one with `op`, `value`, `key`, `level`, `target`, `change`, `signal` or `evidence`) that this run's learn step did not raise, and every proposal when `settings/workspace` has `learning: false`.

`write` reads the compiled definition from `meta/definition` in the snapshot unless `--definition` is given, and writes `batch-001.json` onward, each `{"phase", "writes"}`, skipping empty phases. With `--artifactdata` it also writes, per batch, `batch-NNN.artifactdata.json`: a JSON list that is the `writes` argument of one ArtifactData `batch` call as is, each entry `{op, collection, doc_id, file_path, if_version}` with the document's data in an absolute-path file under `batch-NNN-data/` and the planner's `if_version` pins carried. `seed` lints the routine, compiles `meta/definition`, writes `meta/workspace` and the default `settings/<producerId>` and `settings/workspace` docs (settings only when absent from `--docs`), as `batch-001.json` onward. Apply the batches in order after publishing the Desk. Exit codes: 0 ok, 1 lint problems (compile, seed), 2 unreadable input or a contract error.
