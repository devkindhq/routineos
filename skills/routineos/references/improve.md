# Self-improving routines

A routine learns only from the gap between what it did and what people did. Code counts that gap run by run and decides what is worth raising; the model only phrases it; a person decides each item on the Desk. A routine never applies its own suggestion.

Tags as in [platform-facts](platform-facts.md): **pilot**, **docs**, **unverified**, **call**. Everything below is the builder's call, held by tests in `tests/test_learn.py` and `tests/test_learning_contract.py`, and not yet run against a live routine [call].

## The build question

Ask once at build time: **Self-improving? (default on)**. Yes keeps `"learning": {"enabled": true}` in `definition.json` (the template writes it); no sets `enabled` to false. The binding is declared in the definition: a type's `settingFilters` names which setting filters which field, and that is the only thing learning may change at level L1 [call].

```json
"learning": {"enabled": true, "signals": {"dead_item": false}, "limits": ["max_inbox_per_run"],
             "minSample": 5, "minEffect": 0.6, "cooldownDays": 14, "maxPerRun": 3, "deadAfterRuns": 10}
```

Every key but `enabled` is optional; the values shown are the defaults. `lint` refuses unknown keys, unknown signals and out-of-range numbers.

## Signals

| Signal | The gap it counts | Status |
|---|---|---|
| `override` | A person kept a record a setting dropped (exclude: the value that dropped it; include: the value it lacked) | counted |
| `uncaptured_term` | Kept records an include text filter missed share a plain word | counted |
| `dead_item` | An item of a list setting matched nothing for `deadAfterRuns` runs of its type | counted |
| `limit_pressure` | Runs offered more Inbox messages than a declared limit allowed | counted |
| `people_drop` | Records the settings kept but people dropped share a plain word in a text field bound to an exclude list (proposes adding it; never a word already in an exclude or include list on that field) | counted |
| `source_health` | A source keeps failing or returning nothing | named, not yet counted |
| `connections` | People link records the routine did not | named, not yet counted |
| `edit_drift` | People keep editing the same field the same way | named, not yet counted |
| `manual_repetition` | People repeat the same action by hand after runs | named, not yet counted |

A signal is on unless the definition turns it off. `settings/workspace` value `learning: false` is the global off switch: tallies still count, nothing is proposed, and `write` refuses every proposal message, model-written ones included.

## Deciding

Each run has one order: learn, then append the proposals to the run's inbox, then write. `routineos.py learn --docs snapshot.json --run run.json --out <dir>` updates `state/learning` (the tallies, written by producers only; apply `learning.json` before `write`) and writes `proposals.json`. Appending after `write` loses the proposals: a run already marked done writes nothing more. A candidate is raised only when all hold:

- at least `minSample` distinct kept records (a record seen again in later runs counts once), or pressured runs under the current value of the limit, and their share at least `minEffect`;
- its key was not rejected or dismissed within `cooldownDays`, is not snoozed, and is not waiting undecided on an earlier run's card, however old (a decision on this run's own card never blocks, so a retried `write` is idempotent);
- it passes `desk_contract.check_proposal`.

At most `maxPerRun` are raised, strongest first. Rerunning `learn` for the same run id does not count twice. An include list is never proposed empty.

## Levels

- **L1** setting item: add, remove or set one value. Accept on the Desk applies the item to the setting as it is now and records the decision.
- **L2** definition change (a field, a type, a binding): the card says it opens a PR. Reject and Snooze only; no setting is written.
- **L3** workflow or prompt change: as L2.

Opening the PR for L2 and L3 is a follow-up; today the card records the decision only [call].

## Guardrails

- Never self-apply. Only a person's Accept changes a setting.
- Rejection memory: Reject (and Inbox Dismiss) blocks the same key for `cooldownDays`; Snooze blocks it until its `until` (7 days on the Desk), and a snooze without `until` blocks for good. A `set` is keyed by setting alone, so rejecting "set to 8" also blocks "set to 9".
- The push rule, gates, cap overrides, budgets and send permissions are never learnable: any setting whose name, with case and separators removed, contains push, gate, send, alert, permission, budget, maxruns or capoverride (so `PushRule`, `SendTo` and `maxRuns` too) is refused in every proposal shape.
- Fetched text only ever becomes a value: words must match `^[A-Za-z0-9][A-Za-z0-9 .&+#/'_-]{0,59}$`, so instruction-like text cannot travel through a proposal.
- Every proposal is schema checked; unknown fields are refused. See [write-contract](write-contract.md).

## In the prompt

Append the `proposals.json` messages to the run's `inbox` before `write`, ahead of match messages, so `max_inbox_per_run` never drops a proposal. The model may reword `title` and `why`; it never changes `proposal`. `write` recomputes this run's learn output and refuses any per-item proposal (one with `op`, `value`, `key`, `level`, `target`, `change`, `signal` or `evidence`) that is not in it, so the model can never write a per-item proposal itself and none skips thresholds or rejection memory. A model-written `{setting, from, to}` proposal is still allowed; it must pass the never-learnable check and the workspace off switch. `limit_pressure` counts only `match` and `alert` messages the contract would keep, not proposals, approvals or filtered matches.

## On the Desk

Suggestions (`#/suggestions`, after Inbox) shows one card per proposal: the item line, the level label, the evidence, the why and the run, then Accept, Reject and Snooze. Decided and snoozed cards move to History, newest decision first; a snooze that has passed returns the card to the open list, and a snooze without `until` stays in History. Accept refuses a change that would leave an include list empty.
