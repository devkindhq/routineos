# Components

The fixed vocabulary. Keep it small so every routine reads the same way.

| Part | What it is | Lives in |
|---|---|---|
| Routine type | serverless, watch, approval-gated, interactive; decides what gets provisioned | `routine.toml` `[routine] type` |
| Records and Store | Declared fields plus a key. State, Results, Run record, Pending | artifact db by default |
| Settings | Typed settings, human-owned, three layers | `[[setting]]`, db doc `settings/<producerId>` |
| Producer | The routine prompt or a stdlib script that reads settings, works, writes records | `prompt.md` |
| Gate | Pending record with a correlation key, a timeout and an outcome; the resume is a new run | `[gate]`, db doc `pending/<id>` |
| Run and health | ok, partial or failed; parsed vs claimed counts; drops with reasons; link to the Claude session | db `reports/<date>` |
| Connector | A declared integration (browser, Slack, Gmail). Check the gap before enabling | `[[connector]]` |
| Workspace | Optional mobile-first artifact page plus db | `dashboard/` |
| Adapter | Swappable store, file storage, transport or classifier | `[store] adapter` |

## Standard db layout

- `reports/<YYYY-MM-DD>`: date, headline, status (ok or partial), sections.
- `state/seen`: ids newest first, capped in the thousands, plus date.
- `settings/<producerId>`: current setting values for one routine, written by the human side only.
- `pending/<id>`: gate records. `requests/<id>`: action queue items (see live-actions).

## Honest health

Record what was parsed against what the source claimed. Any shortfall makes the run partial. A source with no item newer than 60 days is stale: list it, keep none of its items, do not count it as a failure.
