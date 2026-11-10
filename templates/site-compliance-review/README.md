# site-compliance-review

Reviews a website's pages against a rule pack you supply and records wording that may breach a rule, with severity, a screenshot and a boxed note where the wording sits. It tracks each flag across runs and honours a person's decisions. It never changes the site. Status: template, version 1, unpiloted (no real run has checked it yet).

## What it does

Your own Cloudflare Worker reads the site's sitemap once a day and captures new or stale pages on a cron: a full-page screenshot plus the text and position of visible text elements. On each capture the Worker asks a Clef model on Workers AI (default `@cf/cloudflare/clef-flash`) one question per enabled rule and stores a score from 0 to 1 for each. Clef is the main verdict engine. Each run of the routine reads the captures made since its last run, applies every enabled rule in `lib/rules.json`, merges the Clef scores with the rule hits, and compares the result with what it stored before. New flags reach the Inbox, highest severity first. Flags a person kept send a "Fixed" message once the wording is gone. Its push rule: report-only. It never edits a page, never logs in to the site, never changes a rule and never contacts anyone.

A flag is a possible issue for a person to check, never a finding that the site breaks a rule or a law.

How a rule hit and a Clef score combine, per rule per page (`CLEF_FLAG_AT`, default 0.7, is the flag line):

| Rule fired | Clef score | Result |
|---|---|---|
| yes | at or above the line | flag, origin `both` |
| yes | below the line | flag, origin `regex`, marked needs review |
| no | at or above the line | flag, origin `clef`: page-level, no quote and no box |
| no | below the line | clear |

When Clef is off, or failed on a page, that page keeps its rule flags unchanged (origin `regex`, no score) and the Desk shows its Clef state as `off` or `error`, never clear.

The shipped rule pack is a small neutral sample. Replace it with your own:

| Rule | Kind | Default severity | Status | Finds |
|---|---|---|---|---|
| `unsubstantiated_superlative` | phrases | medium | confirmed | "best in the world", "number one", "the only" and similar |
| `unverifiable_numeric_claim` | pattern | high | confirmed | a percentage improvement such as "40% faster" |
| `missing_disclosure` | needs_disclosure | high | confirmed | a promised result with no "results may vary" or "terms apply" anywhere on the page |
| `absolute_claim` | phrases | low | draft | "always works", "risk free" and similar; runs only when `include_draft_rules` is on |

A rule has an `id`, `label`, `severity` (high, medium or low), `status` (confirmed or draft), `enabled`, a `kind` and its matcher (`phrases`, a `pattern` of at most 200 characters, or `phrases` plus `disclosures`), and a `question`: what Clef is asked about the page for that rule. The Worker bundles the questions at deploy time, so redeploy it after a rule change; the run raises a Worker health alert when the Worker asks different rules from the pack. An unknown kind or a bad pattern stops the rules stage with exit 2, so a broken pack never passes silently.

## Which part does what

| Piece | Runs where | Job |
|---|---|---|
| Worker (`worker/`, repository only) | your Cloudflare account, on its own cron | reads the sitemap daily, keeps the capture queue, captures pages with Browser Run, asks Clef to score every rule on each capture, stores captures, scores and screenshots in R2, serves `/summary`, `/results` and signed `/shot/` links |
| Routine (`lib/` and `prompt.md`, in the pack) | each scheduled run | budget check, reads captures and Clef scores, applies the rule pack and merges the Clef verdict, attaches screenshots, tracks flags and decisions, writes records and the Inbox |
| Desk (`definition.json`, in the pack) | the Desk artifact | views, capture image notes and Worker health |
| Clef card (`desk/components/clef-card/`, repository only) | the Desk artifact | an optional page section listing each rule's Clef score and outcome |

The phrase and pattern matchers live only in the routine's Python. The Worker reads only each rule's `id`, `label` and `question` from the same `lib/rules.json`, bundled at deploy time, to ask Clef.

## Setup

1. Deploy the Worker (below). The routine reads nothing without it.
2. Install the pack, then open the Desk Settings page.
3. Set `site_url` to the site's public address, for example `https://www.example.com`, and `worker_url` to the Worker's address. Set `sitemap_url` if your sitemap is not at `<site>/sitemap.xml`; the run checks that the Worker reads the same one.
4. In the routine's environment, add the Worker host to the allowed domains and add the Worker's token as a network secret sent in the `x-review-token` header for that host.
5. Replace `lib/rules.json` with your own rule pack, or edit the sample.
6. Run it once. The first run is report-only: it records pages, flags and Worker health and writes nothing else. Screenshots are attached from the second run.
7. Review flags on the Desk. Keep a flag that needs a fix. Drop one with a reason starting "accepted" when the wording is intentional. Drop with any other reason when the rule misfired.

### Deploying the Worker

The Worker is not part of the installed pack; it lives in this template's repository folder.

1. In `worker/`, run `npm install`.
2. Edit `wrangler.jsonc`: replace every `REPLACE_` value. Set `ALLOWED_HOSTS` to the site host (comma separated for more than one), `SITEMAP_URL` to the sitemap on that host, and create the R2 bucket you name there.
3. Set the access token with `npx wrangler secret put ACCESS_TOKEN`. Use a long random value and keep it out of any file.
4. Run `npx wrangler deploy`. Redeploy whenever `lib/rules.json` changes, so Clef is asked the current rules.
5. Clef: the `ai` binding is set, and `USE_CLEF` is `"true"` in the shipped `wrangler.jsonc` (unset means off). Each capture is one model call on your Cloudflare account. Set `USE_CLEF` to `"false"` to run on rules only. `CLEF_MODEL` picks the model (default `@cf/cloudflare/clef-flash`), `CLEF_FLAG_AT` the flag line (a number above 0 and at most 1, default 0.7). `CLEF_IMAGE` `"true"` also sends the screenshot; leave it `"false"` until you have checked image input on your account.
6. Start with a small fresh start. `MAX_NEW_PER_SYNC` ships at 5 so the first sitemap read queues only five pages: check their captures, screenshots and flags on the Desk, then raise it in `wrangler.jsonc` and redeploy to cover more of the site.
7. `npm test` runs the Worker's tests with in-memory stand-ins; `npm run typecheck` checks the types.

Worker settings in `wrangler.jsonc`: `BATCH_SIZE` pages per cron tick (default 5), `MAX_ATTEMPTS` before a page is marked failed (3), `MAX_NEW_PER_SYNC` pages queued per sitemap read (5, a first-deploy test), `RECAPTURE_DAYS` before a page is captured again (30), `LINK_TTL_SECONDS` for signed screenshot links (86400).

## Stages

| Stage | Kind | Does |
|---|---|---|
| budget | code | Counts this routine's runs today and stops the run at `max_runs_per_day`. |
| fetch | code | Reads the Worker's summary and the captures made since the last run, on the site host only. |
| rules | code | Applies the rule pack, merges the Clef scores (the verdict table above) and places a box for each rule hit on the screenshot. |
| shots | code | Downloads screenshots of flagged pages through signed links. Skipped on the first run. |
| upload | model | Uploads each screenshot to the Desk's own asset store so the boxes can be drawn on it. Skipped on the first run. |
| track | code | Compares with stored pages and flags, honours decisions, records each flag's origin, Clef score and needs-review mark, adds Worker health with Clef calls, errors and tokens, and builds records and the Inbox. |
| learn | code | Turns feedback on earlier runs into learning and proposals before the write. |
| write | code | Applies the run input under the write contract. |

## Connectors

Installing the pack connects nothing and holds no secret. Connect it yourself.

| Connector | Kind | Needed | Access | Used by |
|---|---|---|---|---|
| Your review Worker | http | required | read | fetch, shots |

## Settings

People edit these on the Desk Settings page.

| Setting | Type | Default | Note |
|---|---|---|---|
| `site_url` | list | `[]` | required; the first entry is used |
| `sitemap_url` | list | `[]` | empty means `<site>/sitemap.xml`; checked against what the Worker reads |
| `worker_url` | list | `[]` | required; the first entry is used |
| `include_draft_rules` | toggle | `false` | also run rules with status draft |
| `max_pages_per_run` | number | `200` | captures read per run; the rest wait for the next run |
| `max_screenshots` | number | `10` | screenshots attached per run; 0 is off |
| `max_runs_per_day` | number | `2` | budget cap; a run over it stops before reading anything |
| `max_inbox_per_run` | number | `10` | more messages ask more of your attention |
| `clef_flag_at` | number | `70` | Clef flag line in percent (1 to 100); sent to the Worker on each run and used for captures made after that |

Clef's `USE_CLEF`, `CLEF_MODEL` and `CLEF_IMAGE` are Worker vars in `wrangler.jsonc`, not Desk settings: they sit with the account that pays for the calls. The flag line is both: the `clef_flag_at` setting is pushed to the Worker's `POST /config` and stored in R2, and it wins over the `CLEF_FLAG_AT` var, which wins over the default 0.7. `GET /summary` shows the line in force (`flagAt`) and where it came from (`flagAtSource`: `config`, `env` or `default`).

## Desk

- Pages to review: pages with the most flags first, with the worst severity.
- Issues by rule: open flags grouped by rule.
- High severity: high flags, newest first.
- Clef verdicts: flags grouped by origin (both, regex, clef), highest Clef score first.
- Needs review: rule hits that Clef scored below the flag line.
- Accepted or dismissed: the decisions log, with each drop reason.
- Fixed: flags that resolved.
- Worker health: reachable, queue, failed pages, sitemap read, errors, and whether Clef is on with its error count.

Each page record carries its screenshot (from the second run) with one note per flag, boxed where the matched wording sits when it could be placed. A Clef-only flag has a page-level note with no box.

The optional Clef card adds a section after the page's fields: each asked rule with its Clef score and outcome (flag, needs review, Clef only, clear), draft rules shown as hidden, and a count of rows left out over 20. It is a custom component, so it is not in the pack. To add it to an installed routine, run `routineos desk component copy clef-card --from templates/site-compliance-review --to <routine>`; the owner then reviews and approves it with `routineos permissions <routine> --approve`, which an agent never runs for them. Without it, the same data sits in the page record's `clef_card` value.

## Files

- `routine.toml`: type, schedule, store, settings and the gate (off).
- `prompt.md`: the routine prompt, with the untrusted-data clause and the push rule.
- `definition.json`: the page, flag and health record types, views and Desk health.
- `pack.json`: the pack metadata, stages and connectors.
- `lib/budget_check.py`: the daily run cap.
- `lib/fetch_results.py`: reads the Worker's summary and captures since the last run, keeping a cleaned Clef result per capture.
- `lib/apply_rules.py`: applies the rule pack, merges the Clef scores and places boxes.
- `lib/rules.json`: the swappable rule pack.
- `lib/fetch_shots.py`: downloads screenshots through signed links.
- `lib/track.py`: compares with stored state and builds records, health and the Inbox.
- `worker/` (repository only, not in the pack): the Cloudflare Worker, with tests.
- `desk/components/clef-card/` (repository only, not in the pack): the optional Clef card.
- `risks.md` (repository only): the longer risk notes.

## Decisions

- The pack format carries no Worker code and no custom Desk components, so the Worker lives in `worker/` and the Clef card in `desk/components/clef-card/` in the repository, as in `shopify-content-qa`; the pack's Desk uses core views and capture notes only. The definition sets no `desk` block (health chips or record strip): the pack schema in `catalog/schema/pack.v1.schema.json` allows only `desk.modules` there, so health chips fall back to each type's first choice field.
- The pack format has no run budget block, so the budget is a setting (`max_runs_per_day`) checked by `lib/budget_check.py` against the Desk's run documents.
- Clef is the main verdict engine and the phrase and pattern rules are its evidence: a rule hit gives the quote and the box, a Clef score says whether the page makes the claim. A rule hit Clef scores low stays a flag, marked needs review, so nothing the rules catch is hidden by the model.
- Clef scores in the Worker, at capture time, so each page is one model call no matter how many runs read it. The matchers stay in the routine, so a matcher change needs no redeploy; a rule added or a `question` changed does.
- One scoring path: Clef off, a missing binding, an error or an empty answer all leave the page's rule flags unchanged and mark the page's Clef state, so the routine never mistakes a failure for a clear page.
- One flag per rule per page. Its id is the rule plus a hash of the page URL, so a decision sticks to that rule on that page.
- Decisions map onto the Desk's Keep and Drop: Keep means it needs a fix, Drop with a reason starting "accepted" means intentional, any other Drop dismisses it.
- A Clef-backed flag (origin `clef` or `both`) resolves only on a run where Clef scored that page, so an outage never closes it.
- Draft rules are asked of Clef too, but their scores stay off the Inbox and records unless `include_draft_rules` is on; the Clef card shows them as hidden.
- Screenshot uploads are a model stage with no connector: the Desk's asset store belongs to the Desk the routine already writes to, and a write connector would need a gate this watch routine does not have.
- `site_url`, `sitemap_url` and `worker_url` are list settings because settings have no text type; the first entry is used.
- The Worker connector is marked read: the routine only reads from it. The Worker reads the site, never writes to it.
- No n8n inspiration; this template was written from scratch.

## Platform claims

Claims about Cloudflare and Desk behaviour, tagged by how they were checked.

- docs: Cloudflare Browser Run `quickAction("screenshot", ...)` returns the image and needs a compatibility date of 2026-03-24 or later (developers.cloudflare.com, as cited in `shopify-content-qa`).
- unverified: `quickAction("scrape", { elements })` returns `{ result: [{ selector, results: [{ text, left, top, width, height }] }] }` with positions in CSS pixels. The Worker skips anything that does not match.
- unverified: a full-page screenshot at device scale 1 has the same pixel size as the CSS page, so the scrape rects map onto it. If not, boxes land in the wrong place; notes without boxes still work.
- unverified: an R2 conditional put with `onlyIf: { etagDoesNotMatch: "*" }` fails when the key already exists.
- unverified: the environment's network secret attaching the `x-review-token` header to Worker requests.
- unverified: the Clef model's id, input and output shape on Workers AI. The Worker sends `{ model, state, questions: { <id>: { type: "noul", instructions } } }` and reads `answers.<id>.noul` (0 to 1) and `usage`, taken from the model's published schema. Anything else gives an error and no scores.
- untested: Clef image input (`images: [{ content_type, base64 }]`). Off by default behind `CLEF_IMAGE`.
- unverified: the routine's cloud environment can upload a file to the Desk's asset store. If it cannot, flags keep their notes without an image.

## Known risks

- Unpiloted. No real run has checked any of this end to end.
- Phrase and pattern rules miss rewording and flag harmless uses. Every flag needs a person's judgement; the sample rule pack is an example, not advice.
- The Worker reads only what renders on the page it loads. Content behind a login, a cookie wall or a click is not seen.
- A page that redirects is recorded as a failed capture; list final URLs in the sitemap.
- A flag resolves only when its page loaded this run and its rule ran. A failed capture, a capped run or a rule turned off keeps it open.
- A dismissed flag stays dismissed until a person restores it, even if the page changes.
- Screenshot links are signed and short-lived; the Desk keeps its own uploaded copy.
- The Worker is one more thing to deploy and keep patched. Its token is a secret to rotate if it leaks; rotating it voids every signed link.
- Clef's flag line (0.7) is a starting value, not calibrated against real pages. Check Clef-only and needs-review flags by hand before you trust or move it.
- Clef's endpoint behaviour is unverified and its image input untested; the tests use stand-ins only.
- A Clef-backed flag stays open while Clef is off or failing; drop it by hand if Clef stays off.
- Each capture is one Clef call on your Cloudflare account while `USE_CLEF` is on.
- See `risks.md` in the repository for more detail.

## Assumptions

- A1: the Clef model id `@cf/cloudflare/clef-flash` exists on Workers AI for your account. Unverified.
- A2: Clef takes `{ model, state, questions }` with `noul` questions and returns `answers.<id>.noul` from 0 to 1. Unverified.
- A3: Clef returns token usage as `usage.input_tokens` and `usage.output_tokens`. Unverified; missing usage is recorded as unknown.
- A4: Clef accepts a PNG screenshot as `images: [{ content_type, base64 }]` up to 4 MiB. Untested; off by default.
- A5: 0.7 is a sensible flag line. Not calibrated.
- A6: one Clef call with up to 64 rule questions and 60,000 characters of page text fits the model's limits. Unverified.
- A7: the Worker's bundled rules match `lib/rules.json` in the pack. Checked each run; a mismatch raises a Worker health alert.
- A8: a page record with the Clef card stays under the Desk's 256 KiB document limit. The card holds at most 20 rows.
- A9: Browser Run's screenshot and scrape shapes are as documented (see Platform claims). Unverified against a live account.


## Inspiration

None. Written from scratch.
