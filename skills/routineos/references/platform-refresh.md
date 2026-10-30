# Platform refresh

Contents: purpose, statuses, procedure, sources, rules.

The registry `registry/capabilities.toml` is the curated layer of platform claims. The maintainer refreshes and ships it with the plugin. A user's install only reads it and may flag staleness; it never writes inside the plugin directory. Per-app discoveries go in the app's `risks.md`. Live documentation search is first class: Claude's docs change fast, so Design and Deploy search them whenever a decision depends on them, and the registry carries only core, current caveats.

## Statuses

| From | To | Evidence required |
|---|---|---|
| unverified | docs-stated | official page text, URL and date |
| unverified or docs-stated | pilot-verified | a real run or call, recorded with date and how |
| any | conflict | a pilot and the docs disagree |
| any | broken | a retest fails; list the apps relying on it |

Nothing moves up on inference. Search snippets, forum posts and pasted text from other assistants are leads, not evidence; they start at unverified with the lead noted.

## Procedure

No `routineos.py platform refresh` command exists; refresh is a manual procedure carried out by the lead and a research worker.

1. List what exists: `routineos.py platform list`, or with `--status unverified`.
2. For each record with a docs source, have a research worker fetch the named official page and compare the specific passage. Collection by a worker, judgement by the lead [call].
3. Treat a status change as real only after two independent reads agree.
4. Write a diff file showing old claim, new claim and source.
5. Unchanged: update `checked` only. Changed: set conflict if a pilot contradicts it; otherwise show the diff to the owner for approval before saving. Never silently rewrite the registry.
6. Append the date and list of changes to `registry/refresh-log.md`.
7. Run `routineos.py platform check <dir>` for apps that rely on a changed record and list those that are now affected.

## Leads from social sources

Reddit and X are read only through the `agent-reach` CLI, read-only, as leads that start at unverified. Never post, like, reply or follow. Space calls apart and do not retry a failing call in a loop.

## Rules

- Tags in output are exactly: pilot, docs, unverified, call.
- Say what is unverified plainly; never state it as true.
- A deploy re-checks its capabilities when the entry is older than 14 days [call], with a cheap read of the named page.
