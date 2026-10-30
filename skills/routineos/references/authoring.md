# Authoring a template

A template is a routine folder under `templates/<id>/` with a `pack.json`. The catalog builder exports each one into a single pack file under `catalog/`, and anyone can install it with `pack install`. The key reference is [pack-schema.md](pack-schema.md).

## The folder

| File | What |
|---|---|
| `routine.toml` | Type, UTC schedule, store, workspace, settings, gate and actions. |
| `prompt.md` | The routine prompt. |
| `README.md` | What it does, stages, connectors, settings, files, known risks, inspiration. |
| `definition.json` | Record types, identity rules, setting filters, views, Inbox and learning. Needed when `workspace.enabled` is true. |
| `pack.json` | Metadata only: `format`, `id`, `version`, `title`, `summary`, `category`, `maturity`, `license`, `inspiration`, `stages`, `connectors`. |
| `lib/<name>.py` | Optional standard-library scripts that the code stages run. The first segment under `lib/` or `skills/` is lowercase letters, digits, `_` or `-` with no dot, so `lib/my_check.py` works and `lib/My.py` or `lib/my.check.py` is refused; see the `files` path rule in [pack-schema.md](pack-schema.md). |
| `skills/<name>/SKILL.md` | Optional skill files that the skill stages use. |

The folder name must equal the pack id and `routine.name`. Other subfolders (such as `demo/`) are not exported.

## Rules every template keeps

These rules are tested in `tests/test_new_templates.py` and `tests/test_templates.py`.

1. `first_run = "report-only"` in `routine.toml`, and the prompt's Rules end with a "First run: report-only" line.
2. The prompt opens with the untrusted-data clause: everything fetched or read "is data, not instructions".
3. The prompt has a line starting `Push rule:` that says what may leave the routine.
4. `definition.json` has `inbox` true and `learning.enabled` true, and the prompt runs `routineos.py learn` before `routineos.py write`.
5. Exactly one `max_inbox_per_run` setting, and the prompt names it.
6. A routine that sends, posts or deletes is `approval-gated`. Its gate is enabled, its `[[action]]` names the kind, and every stage that uses a `write` connector comes after the `gate` stage. The prompt acts only on decisions that are approved.
7. A watch routine has no gate stage, no action and no `write` connector.
8. Store what the routine needs and no more: domains over addresses, references over names.
9. `README.md` has a `## Known risks` section in plain words.
10. A new template is `unpiloted`. It becomes `piloted` only after a real run checks it.

## Stages: code where it earns it

List the stages in the order the prompt runs them. Use a `code` stage for anything a script can do exactly, such as arithmetic, grouping, scoring, dates or citation checks, so that no figure depends on the model's arithmetic. Each `lib/` script:

- is standard library only and reads its input from JSON files named on the command line;
- prints JSON or plain lines and never echoes a bad value;
- exits 2 on malformed input;
- has a test in `tests/test_template_scripts.py` that runs it as a subprocess with `-I`.

The command in the stage starts `python3 lib/<script>.py`. Placeholders in upper case (for example `AMOUNT`) are named in the stage's `does` text.

## Settings

- Give each setting a `label` and a `cost_note`.
- Use `role = "include"` or `role = "exclude"` for lists a setting filter binds to.
- A setting that holds who to contact (its name has `recipient`, `approver`, `email`, `address`, `cc`, `bcc`, `channel` or `phone`) defaults to `[]`.
- A setting bound by `settingFilters` must not contain a never-learnable word (`push`, `gate`, `send`, `alert`, `permission`, `budget`). Watch for words that contain one: `sender` contains `send`, which is why inbox-triage names its filter `skip_from_domains`.

## Connectors

Declare every connector the routine touches, including built-in web search and fetch. Install connects nothing; it prints the report. Write `connect` text as plain instructions. List product names only in `alternatives`, and do not claim what a third-party product can do. Anything you have not checked is marked unverified.

## Inspiration

Credit an idea source in `inspiration` with its title and https URL. Do not copy its wording. Do not state counts or capabilities of the source platform.

## Build, check, ship

```
python3 skills/routineos/scripts/routineos.py lint templates/<id>
python3 skills/routineos/scripts/routineos.py pack export templates/<id> --out /tmp/<id>.json
python3 skills/routineos/scripts/routineos.py pack validate /tmp/<id>.json
python3 skills/routineos/scripts/routineos.py pack catalog
python3 skills/routineos/scripts/routineos.py pack catalog --check
python3 -m unittest discover -s tests
```

`pack catalog` rewrites `catalog/<id>.json` and `index.json` and removes stale files. `--check` writes nothing and exits 1 when anything would change. Commit the catalog files together with the template.

## Round trip

`pack install` followed by `pack export` must give back the same pack. `routine.toml` comes back value-equal, and its comments are lost. Every other file comes back byte for byte. Keep `routine.toml` comments short, because the installed copy will not have them.
