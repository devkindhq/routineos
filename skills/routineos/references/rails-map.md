# Rails map

For people who know a web framework. Sources are public docs, fetched 2026-10-28; analogies are mine, not the frameworks' claims.

| Web framework idea | RoutineOS part | Note |
|---|---|---|
| Model (Rails Active Record, Django models) | Records in the Store | Fields plus a key; no joins, no schema enforcement by the db, so the prompt and lint carry the schema |
| Migration | Versioned change to a record shape | No tool; add a `schema` field to docs and have the prompt tolerate older shapes |
| Controller or Job (Active Job, Laravel queued jobs) | Producer: the routine prompt or a script | Unattended, one run per trigger, fresh sandbox |
| Scheduler (Laravel Task Scheduling) | `[routine] schedule`, a cron in UTC | One-hour minimum here; Laravel allows far finer. No overlap guard documented here, so design for idempotent reruns |
| Views | Workspace artifact page | Optional, mobile first, reads db collections |
| Credentials, config | Settings plus connectors | No secrets in db or prompt; connectors hold auth |
| Generators (`rails g`) | `routineos.py new` | Scaffolds toml, prompt, README |
| Console | `routineos.py lint`, `doctor` | A dry-run mode is planned |
| Mailer | Gate transport and send actions | Email or Slack through a connector, always behind a gate |
| Active Storage | Storage adapter | Artifact assets (capability `assets`) are the working default; object storage is an adapter idea |
| before_action | Gate | Pending record, then a later run resumes |

## Doc URLs

- Rails Active Job: https://guides.rubyonrails.org/active_job_basics.html
- Django models: https://docs.djangoproject.com/en/stable/topics/db/models/
- Laravel scheduling: https://laravel.com/docs/scheduling
- Claude Code skills: https://code.claude.com/docs/en/skills
- Claude scheduled tasks (formerly routines): https://code.claude.com/docs/en/routines (fetched; docs list schedule, API and GitHub triggers)

The Rails, Django and Laravel pages were checked for topic only; the mapping of Migration, Mailer, Active Storage and generators to RoutineOS is analogy and was not checked against those guides page by page (assumed).
