# Settings

A setting is a typed setting a person can tune without editing the prompt.

## Shape

```toml
[[setting]]
name = "max_items"
type = "number"      # toggle | number | choice | list
default = 25
min = 5
max = 100
cost_note = "more items means more page opens"
```

- toggle: default true or false.
- number: default inside optional `min` and `max` (lint enforces).
- choice: a `choices` list and a default in it.
- list: default is a list.
Every setting needs a name, a type and a default. Lint fails otherwise.

Optional keys on any setting:

- `label`: the text the Desk shows next to the control. Must be text.
- `example`: a sample value shown as a hint. Must be text.

Optional key on list settings only:

- `role = "include"` or `role = "exclude"`: the list filters records. A type in `definition.json` names it under `settingFilters` with the field it checks. Include keeps only records whose field matches an entry (an empty list keeps everything); exclude drops records that match. Dropped records stay in the Desk with status `dropped` and a reason such as "excluded by excluded_companies", so the person can see what the setting did.
- `format = "<name>"` on a list: each entry must match a named character allow-list, checked when the Desk saves the setting and when a proposal adds an entry. Names: `word` (lowercase letters, digits, `_` and `-`), `https_url`, `ga_property` (`properties/<digits>`) and `gsc_site` (`sc-domain:<domain>` or an https URL ending in a path). They keep quotes, spaces and shell characters out; they are not a claim about everything the named service accepts. Any list entry, with or without a format, is one line of text of at most 300 characters.
- Text setting values are never typed on a command line. A prompt writes them, one argument per line, to a file with the file tool and passes `@file` to a `lib/` script; `lint` fails a prompt that puts a quoted placeholder or a shell expansion in a command.

## Three layers

1. Static: the defaults in `routine.toml`, versioned with the routine.
2. Per routine: values in db doc `settings/<producerId>` (the routine name), changed by the person.
3. Per run: one-off overrides when a run is triggered by a request; the run snapshots the values it used onto its report so results stay explainable.

The prompt reads layer 2, falls back to layer 1 when the doc is missing (treat a missing doc as a first run), and states which layer each value came from.

## Source of truth

`routine.toml` is the schema: setting names, types, defaults and ranges. The live values live in the artifact db doc `settings/<producerId>` under `values`, edited by the person on the Desk Settings page. The routine prompt reads the db doc first, falls back to the toml defaults, and snapshots the values used onto each run record as `settingsUsed`, so a later edit never changes what an earlier run is shown to have used.

## Ownership

Settings are human-owned. An agent run never writes `settings/<producerId>` or `settings/workspace`; the write contract refuses those paths. If it thinks a value should change, it adds a proposal as an Inbox message (kind `proposal`, with `proposal: {"setting": "<key>", "from": <current value>, "to": <suggested value>}`, see [write-contract](write-contract.md)) or a `requests/<id>` doc for the human to accept. Settings are editable on the Desk: the person changes a value there, the page writes `settings/<producerId>`, and the change applies from the next run. `routineos.py seed` writes the defaults only when the doc is absent, so reseeding never overwrites a saved value.

## Writing good settings

Name by effect, not mechanism. State the cost in `cost_note`. Prefer a few settings with clear ranges over many. Changes apply on the next run; say so on the page.
