# Deploy

Contents: before you start, scaffold and verify, permission screen, create the routine, first run, promotion.

Deploy takes an approved design to a routine that exists on the account and has run once, report-only. "Done" on scaffolding is never reported. A deploy with no routine id is not a deploy.

## Scaffold and dry verify

1. `routineos.py new <name> --app` (or `app-init <dir>` for a v0 folder). Add `--from-template` for a template.
2. Write scripts only where Design chose code. Each gets a small test with a fixture.
3. Build the Desk from the shell and publish it as a private artifact; seed data shows the shape.
4. Write the prompt: fixed header (`routineos.py prompt app-header`), the steps, the output contract.
5. `routineos.py lint <dir>` must pass. Run `routineos.py platform check <dir>` and `routineos.py doctor <dir>`; a conflict or broken capability is shown on the permission screen and the person decides whether to go ahead.
6. Local dry run on fixtures only; no network beyond what the person approved.

## Permission screen

Run `routineos.py permissions <dir>` and show it in plain words before anything is created. It lists every app and host contacted and why, every connector, schedule in the person's time zone and UTC cron with runs per day, the tools each run may use, the environment as the person reported it (shared or not, network level, allowed domains, network secret names, setup script yes or no, variable names, never values) with each host marked reachable, not reachable or read through a connector, the store, the budget ceiling, what the first run will and will not do, and anything unverified the app relies on. Nothing is created until the person says yes. A change makes a new permission screen.

## Create the routine

Mechanism: `/schedule` and `RemoteTrigger` (actions list, get, create, update, run, list_runs, get_run_log) work in the person's interactive session and need a claude.ai login [docs]. The tool is absent inside a run, so this never happens from a run [pilot].

1. Call list first. If a task with the app's name exists, show it and ask whether to update it or create another. Never create a duplicate silently.
2. Create the schedule trigger with the approved cron, repo, saved prompt, environment and connector subset.
3. Other triggers (API token, GitHub events) are added in the web UI only [docs]. Say exactly where to click. Record that the trigger exists, never the token.
4. Read back: list again and confirm the id, schedule, repo, environment and connectors match the permission screen. Store the id in `app.toml [deployed]`.

Request body [pilot, registry `remotetrigger-body-shape`]: give repos as `session_context.sources: [{"git_repository": {"url": ...}}]`. The shape `{"type": "git_repository", "url": ...}` at create is dropped without an error. An `update` replaces `job_config.ccr` whole, so resend `events` and `sources` with every update or the prompt is wiped. Read back after every create and every update, never only the first.

Logic delivery, per routine, follows `delivery` in `app.toml` (see `design.md`, Where the logic lives). Local files are built and linted first in every mode.

- `repo`: push or confirm the repo holds the prompt, scripts and any `.claude/skills/<name>/`; create the routine with that repo. Say the person must do the push if you cannot.
- `account-skill`: the person uploads the skill on claude.ai, never RoutineOS. Give exact steps: zip the `skills/<name>/` folder with `SKILL.md` at its top, open claude.ai, find its skills area (menu names change, so look them up in the current help pages rather than trusting this line) [unverified], upload the zip, switch the skill on, then say "uploaded". Check the frontmatter first with `lint` (allowed keys: name, description, license, compatibility, metadata, allowed-tools). Never claim it was uploaded; only the person's word, or a transcript of the first run showing the skill ran, counts. Then create the routine with a prompt that names the skill.
- `inline`: create the routine with the prompt text and no repo.

Repo-less creation (`account-skill` and `inline`) was created and ran in a pilot [pilot, registry `repo-less-routine`]. Still create it report-only and read it back with list and get. If the platform refuses or changes it, report that plainly, keep status not live, and offer the `repo` mode. Switch only on the person's yes.

Assumption: the create and update fields (inline versus repo prompt, environment, connector subset, enabled flag) are owner-reported, not re-tested in this project [unverified]. Proceed on it. Fallback: if creation is refused, fields are unsupported or the tool is missing, say so plainly, give the exact fields to enter on claude.ai, and keep status not live. Never report partial success as success. After the first run, record the real result in the app's `risks.md` and leave a note for the maintainer to update the registry; a user install never writes the registry.

Compare `[deployed]` in `app.toml` with the account listing as a doctor-style check: id, schedule, connectors. Report every mismatch.

## First run, report-only

Every run before `state/verified` exists is report-only; the prompt header reads that flag so a scheduled fire cannot act early.

1. Run immediately with `RemoteTrigger` run, then fetch the run log and the Desk [call]. Set the first schedule time after this immediate report-only run, where the platform allows it.
2. Report exactly what happened: items found, written, skipped and why, tokens or time if exposed, any error. Surface every failure and every skipped record.
3. Check secrets by a call through the environment; never print the key.
4. The person looks at the output and says whether it is what they wanted. Write `state/verified` only on their words. Status becomes live and tested.

Evidence kept: routine id and listing, schedule match, run id and status, log reviewed, Desk shows the run, the person's confirmation with date. If any is missing, say which.

## Environment and secrets

RoutineOS cannot read the environment's settings [pilot, registry `environment-settings-not-readable-via-api`]; treat any API read of them as unverified. Before the permission screen, ask the person to open the environment the routine will use on claude.ai and confirm its four controls: network access and allowed domains, network secrets, setup script, environment variables. Record the answers in `[environment]` (names only) and run `permissions` again. If a needed host is not reachable, offer a connector or ask them to add the domain themselves; on a shared environment, such as the Default, say first that every routine on it is affected.

If the app needs a network secret:
1. Explain in two sentences what it does and what the person pastes where.
2. Guide them to create an environment named for the app in the web UI, add the secret and its host, and attach it to the task. Never ask for the key in chat. If a key is pasted, warn at once to rotate it and do not use or echo it.
3. Verify in the report-only run with a call through the environment and check the response, never printing the key.

## Promotion

Moving from report-only to acting (send, post, delete) is a separate step with its own permission screen. The first run is never approval of a critical flow.
