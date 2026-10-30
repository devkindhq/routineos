# Migrate to RoutineOS

`routineos migrate` turns an existing automation into a RoutineOS routine pack: the routine, its Desk and the connectors to set up. Anything the converter cannot map lands in a migration report. It never guesses silently.

| Source | Support |
|---|---|
| n8n workflow JSON (file, https URL or gallery template id) | built, see [n8n](n8n.md) |
| Windmill flow (OpenFlow JSON) | built, see [windmill](windmill.md) |
| Zapier | guided path only, see [zapier](zapier.md) |
| Make, Activepieces, Pipedream | planned and unbuilt, see [limits](limits.md) |

## The shape

```
source file or template id
  -> parser (migrate_n8n.py | migrate_windmill.py | the routineos-migrate skill, for Zapier)
  -> migration plan   (routineos.migration.v1, JSON, deterministic)
  -> emitter (migrate.py)
  -> pack.json (routineos.pack.v1) + MIGRATION.md
```

Parsers only read and classify. The emitter is the only code that writes pack shapes. Both are Python 3.11 standard library, with no new dependencies. The plan is our own documented format and the seam for the guided Zapier path: the skill writes a plan from what the person describes and `migrate steps` emits it. The data behind the classification is the [concept map](concepts.md).

## Commands

Run as `python3 skills/routineos/scripts/routineos.py migrate <cmd>`.

| Command | What it does |
|---|---|
| `n8n <file-or-https-url> --out DIR [--id ID] [--trusted]` | Convert an n8n workflow |
| `windmill <file.json> --out DIR [--id ID] [--trusted]` | Convert a Windmill flow (JSON only) |
| `steps <plan.json> --out DIR [--trusted]` | Emit a pack from a migration plan |
| `plan n8n\|windmill <file> [--out FILE] [--trusted]` | Print the plan, write no pack |
| `search <query> [--rows N]` | Search the n8n template gallery (live, 1 to 20 rows) |
| `fetch <template-id> --out DIR [--id ID]` | Convert one gallery template |
| `concepts [--json]` | List the concept map |

- Output is `DIR/pack.json` and `DIR/MIGRATION.md`. `DIR` must not exist or must be empty; the command refuses to overwrite anything else.
- Sources are read with a 2 MiB cap. An https URL (n8n only) is fetched without redirects and only from public addresses.
- Every source is untrusted by default, local files included: generated skills carry the third-party banner and the report has a "Read before you install" section. `--trusted` removes both, for your own workflow. It applies to `n8n`, `windmill`, `steps` and `plan` on a local file. A URL and `fetch` are always untrusted, and `--trusted` with a URL is refused. In `steps`, `--trusted` also clears an `untrusted` flag already in the plan, and without it the plan is treated as untrusted whatever it says.
- Exit codes are decided from the issue levels, not from the report text. 0 means the pack was written and no issue is `needs-person` or `unmapped`. 1 means the pack was written and at least one issue is `needs-person` or `unmapped` (a line on stderr says so). 2 means usage, IO or conversion failure and nothing was written. Issues at level `setup` (a credential to re-create, a variable to set) are listed under "Set up first" and do not make the exit 1. `unverified` and `info` issues do not either.
- Issue levels, most serious first: `unmapped`, `needs-person`, `setup`, `unverified`, `info`.
- `plan --out FILE` refuses a file that already exists and exits 2. There is no overwrite flag: remove the file yourself if you want a new plan.
- If a parser fails on a malformed file in a way it did not expect, the command prints "error: this workflow could not be converted (internal error: <type>)" and exits 2, with no traceback.
- `--id` sets the routine id (lowercase letters, digits, hyphens, at most 64 characters).

After converting: `pack validate DIR/pack.json`, then `pack install DIR/pack.json --dir <routine-folder>`, then the normal `lint`, permission screen and a report-only first run.

## What the converter decides

- Any step that writes to an app makes the routine approval-gated, and write steps move after the gate. A step counts as a read only when its operation is a known read (get, list, search and similar). An unknown operation counts as a write.
- Event triggers (webhook, chat, form, app) become a schedule plus the Desk action queue. Schedules are UTC and at most hourly.
- Unknown node types become a model stage titled "Needs a person" and an `unmapped` issue, so the hole is visible in the stage list.
- Code is never run and never translated by the converter. A stub `lib/<id>.py` is written, with the original kept in `lib/source/`. The skill translates it with a person reviewing.
- Every string from the source passes a sanitiser: control characters, secret-shaped values, email addresses and Slack-style ids are replaced with `[removed]`, and the report names the field, never the value.
- Credentials are listed by type and name only. They are re-created by the person.
- The first run is always report-only. The converted pack is marked `unpiloted`, with the licence "unknown, check the source workflow".

## What is stored

Nothing from n8n.io is stored. A fetched template is converted in memory, and only the converted pack and the report are written to `DIR`. The pack credits the template id and its API URL. The reuse licence for gallery templates is unclear (see [limits](limits.md)), so converting at a person's request for their own use is the narrow path, and no template corpus is bundled.

## Files

| Path | What |
|---|---|
| `skills/routineos/registry/migrate-concepts.json` | Concept map and app catalog |
| `skills/routineos/scripts/migrate.py` | Plan validation, sanitiser, emitter, report |
| `skills/routineos/scripts/migrate_n8n.py` | n8n parser, expression rewriter, template search and fetch |
| `skills/routineos/scripts/migrate_windmill.py` | Windmill parser |
| `skills/routineos-migrate/SKILL.md` | The judgement half: code, expressions, kind, review |

## The migration report

`MIGRATION.md` has these sections in order: Summary, Read before you install (untrusted sources only), What mapped, Set up first, Needs a person, Connectors to set up, Credentials to re-create, Unverified, Removed values, Notes and Next steps.
