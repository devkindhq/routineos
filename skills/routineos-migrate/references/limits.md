# Migrate: limits

What the converter does not do, and facts about other tools with their sources. Anything without a URL is our own design, not a claim about a third party.

## Behaviour that changes

- **Latency of event triggers.** A webhook, chat, form or app trigger fires in seconds in the source. The converted routine runs on a schedule (default `0 22 * * 1-5`, or hourly for app triggers) and reads the Desk action queue. A workflow that must react within seconds becomes a daily or hourly one. RoutineOS documents inbound webhooks as unverified on the platform, which is why the Desk queue is used. This latency is the first item in each report.
- **UTC schedules, at most hourly.** RoutineOS schedules are UTC with a minimum interval of one hour. Source timezones are reported and hours are not shifted. Second and minute schedules become hourly.
- **Gated writes.** Any step that writes makes the routine approval-gated, and the write waits for a person on a later run. The converted routine is slower than the original until a person removes the gate on purpose.
- **Code translation.** Code nodes are not run and not auto-translated. A stub exits 2 until a person and the skill translate it, so a converted routine with code stubs fails visibly rather than doing nothing.
- **Expressions.** Common references are rewritten as plain words. Anything else is kept verbatim and flagged.
- **Vector stores and embeddings.** Reported only. RoutineOS has no vector store.
- **Sub-workflows.** The child workflow is not followed. A stage names it and a person converts it as its own routine or folds it in by hand.
- **Webhook responses and chat replies.** Output goes to the Desk Inbox, not to a caller.
- **Wait nodes.** A time delay becomes "on the next run". The run boundary is the delay.
- **Pack limits.** At most 20 stages, 20 connectors, 40 files and 512 KiB. Above 20 stages, neighbouring model-only stages are merged. If it is still over a limit, the converter stops and names the limit. It never truncates silently.
- **Size cap.** Sources are read up to 2 MiB.
- **App coverage.** The app catalog holds about 50 common apps. A node for an app that is not in it becomes a "Needs a person" stage with an `unmapped` issue. Apps in it that were not listed as claude.ai connectors on 2026-10-30 are `unverified` and are offered through a Zapier MCP server as a fallback.

## Planned and unbuilt

Make, Activepieces and Pipedream have no converter. Design the routine fresh from the person's description with the core skill.

- **Make.** Scenarios export as a blueprint (.json) from the editor, with a 2 MB import limit, and connections are not included (https://help.make.com/blueprints). The blueprint structure is not documented on that page. Community descriptions (a `flow` array of modules, routers) are unverified against Make.
- **Activepieces.** A single flow exports as JSON and several as a zip (snippet only, https://community.activepieces.com/t/flow-import-export-support-files-and-zip-format/6826). The schema was not fetched. The GitHub API reported its licence as NOASSERTION (https://api.github.com/repos/activepieces/activepieces), so the licence is unclear.
- **Pipedream.** Its docs state that Workflows and String shut down on 2027-03-31 (no new signups), with workflow data deleted by 2027-04-30. Connect (API, MCP servers, API Proxy) is unaffected, and an export tool downloads each project's workflow structure as JSON, one project at a time (https://pipedream.com/docs/workflows/building-workflows/, read 2026-10-30). That makes Pipedream a time-limited migration-out source. The workflow file format was not found.
- **Zapier.** Guided path only, because the export schema is undocumented. See [zapier](zapier.md).

## Template licence

`migrate search` and `migrate fetch` read the public n8n gallery API at a person's request, convert in memory and store nothing. Whether the licence in the n8n Self-Serve Terms covers redistributing templates in a derived library is unclear. Section 4.3 gives other users "a non-exclusive licence to use and adapt it in their own projects" and gives n8n a right to distribute, and Section 3.3 says published templates are publicly accessible (https://n8n.io/legal/self-serve-terms/). We treat redistribution as not cleared, so no template is bundled. n8n's legal index lists no separate template or API terms (https://n8n.io/legal/), and a robots or API terms page was not read: unknown. The API is undocumented as far as we found, with no stated rate limit.

The n8n-mcp project indexes the same gallery, keeps author and original id, and requires attribution (https://github.com/czlonkowski/n8n-mcp/blob/main/docs/ACKNOWLEDGMENTS.md); it names no template licence. A converted pack carries the template id and API URL under `inspiration`, and its licence reads "unknown, check the source workflow".

## Security

- Every imported workflow is untrusted by default, local files included. Generated skills carry a banner, the report says to read them before installing, and the first run is report-only. `--trusted` drops the banner for your own workflow, and is refused for a URL. The `fetch` command is always untrusted.
- An https URL is fetched through the shared opener, which honours `HTTP_PROXY` and `HTTPS_PROXY` from the environment. A proxy bypasses the public-address check, so do not set one when fetching untrusted URLs. The converter does not change this.
- `source.url` in a plan keeps only `scheme://host` and a cleaned path. The path is dropped when any run of 20 or more letters, digits, hyphens or underscores could be a token.
- Exit 0 does not mean nothing is left to do. Issues at level `setup` (credentials to re-create) and `unverified` do not change the exit code, so read `MIGRATION.md` after every conversion. Exit 1 means a `needs-person` or `unmapped` issue exists.
- Secret-shaped values, emails and Slack-style ids in a source are replaced with `[removed]`, and the report names the field only.
- Credentials are listed by type and name. The converter never reads or writes a value. If you paste a secret into a chat while migrating, rotate it.
