# Storage adapters

`[store] adapter` selects where records live.

| Adapter | Status | Notes |
|---|---|---|
| artifact-db | verified | Default. 25,000 docs per artifact, 256 KiB per doc, no joins. Page must declare the `db` capability |
| artifact assets | verified | A run can upload a file to an artifact that declares `assets` (returns a blob path). Store the id in a db doc. Cap documented at 20 MiB (assumed from the spec, recheck) |
| sheet or Drive write | unverified | Not piloted |
| connector | assumed | A connector the run can write to (for example a CRM) can hold state; test it from a run first |
| object storage (R2 or similar) | unverified | Needs a Worker you own or a connector; direct hosts were blocked in the pilot |
| classifier (Workers AI decision models) | unverified | Direct host blocked from a run; see platform-facts |

## Write rules for artifact-db

- Build JSON with a script into a file and pass the file path to the write, to avoid escaping errors.
- `set` on an existing doc fails unless it carries the current version. Read first, then set with the version, otherwise set plainly. Decide "first run" from whether `state/seen` existed.
- `get` on a missing doc returns text, not an error. Treat it as absent.
- Write the report, then state. A crash between them repeats work rather than losing items.
- Cap id lists in the thousands (3000 worked), or old items return as new.
- A run can write to several artifacts if each declares `db`. Never point a probe at a real routine artifact.

## Adapter contract

An adapter must provide: get, set with version, list by collection, and a size-limit statement. A fuller contract fragment ships with the assets task.
