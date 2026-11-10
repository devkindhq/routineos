# site-compliance-review: risks

Longer notes behind the README's Known risks. This file stays in the repository and is not part of the installed pack.

## Not piloted

- No real run has used this template. The Worker's tests use in-memory stand-ins for R2, Browser Run and Workers AI (Clef); the routine's tests use replayed Worker answers. Neither proves the live Browser Run or Clef shapes.

## Rules

- Rules are phrase and pattern matches on the captured text. They catch the wording they list and nothing else, and they flag harmless uses of that wording. A rule pack is a starting point for a person's review, not a compliance decision.
- `needs_disclosure` looks for a disclosure anywhere on the page, not next to the claim. A disclosure in a footer counts.
- A pattern is limited to 200 characters and compiled once per run; a bad pattern stops the rules stage with exit 2 so a broken pack is noticed.
- Draft rules run only when `include_draft_rules` is on, so a new rule can be tried without filling the Inbox.

## Captures

- The Worker captures the page with Browser Run, which loads it in a browser, so content added by page scripts is seen. Content behind a login, a cookie wall, a consent banner or a click is not.
- The Worker first requests the page without following redirects. A redirect, or any status other than 2xx, is recorded as a failed capture without opening a browser.
- A Browser Run failure puts the page back in the queue, up to `MAX_ATTEMPTS`, then into the failed list shown under Worker health. The sitemap read never re-queues a failed page; `POST /enqueue` does.
- Boxes come from the scrape rects. The smallest element containing the matched wording is used. Wording split across elements gets a note without a box.
- A screenshot whose width is not a whole multiple of the 1280 viewport was widened by sideways overflow, so the rects no longer line up with it. No boxes are drawn on it (notes stay). A whole multiple scales the rects to pixels.
- Screenshots and captures stay in your R2 bucket with no automatic expiry. Add an R2 lifecycle rule if you want them removed.

## Sitemap

- The Worker reads `SITEMAP_URL` and up to 20 child sitemaps of an index, at most 5000 URLs, without following redirects, and keeps only https URLs on `ALLOWED_HOSTS`. It queues at most `MAX_NEW_PER_SYNC` new or stale pages per daily read, so a large site is covered over several days.
- Before a capture the Worker checks the page's status without following redirects, but the browser opens the page in a separate request, so the check cannot vouch for where the browser ends up. Both Browser Run calls therefore pass `allowRequestPattern`, which lets the browser load only https requests to `ALLOWED_HOSTS` (and data: URLs). A page that redirects or scripts the browser to another host is blocked, and images, scripts or fonts served from other hosts do not load in the capture, so add a CDN host to `ALLOWED_HOSTS` if the page needs it. Browser Run documents `allowRequestPattern` for several endpoints; that `screenshot` and `scrape` accept it, and that a blocked main-frame navigation yields a blank capture rather than an error, are unverified against a live account.
- A sitemap answered with HTTP 429 (rate limited) is retried on later cron ticks until it succeeds; the Worker health shows the error until then, and no pages are queued in the meantime.
- The run compares the sitemap the Worker reads with `sitemap_url` (or `<site>/sitemap.xml`) and raises a Worker health alert when they differ.

## Decisions and state

- A person's Drop is permanent for that flag id until restored. The id is the rule plus a hash of the page URL, so the same rule on the same page stays dropped even if the wording changes.
- The run's cursor is the highest capture number stored on its page records, so a run that fails before the write reads the same captures again next time.
- The budget check counts the Desk's run documents for this producer started today (UTC). A run that stopped before writing is not counted. Observed in a live use: some runs were never recorded, so the cap read 0 of N used and did not hold. The cause was not found; do not rely on the cap as a hard limit, and check the run list after a burst of manual runs.
- The routine's cursor falls back to 0 when no stored page record carries a capture number (an emptied Desk, or records written by another producer). The next run then reads every capture the Worker still holds. After wiping the Desk, set the cursor on purpose (a `since` value) or purge the old captures first.
- A Desk wipe does not clear the Worker: old capture results stay in R2 and cannot be purged from the Desk. Use a `since` cursor to skip them, or delete the objects in R2 yourself.

## Clef

- Clef is the main verdict engine. With `USE_CLEF` on, each capture is one Workers AI call on your Cloudflare account, asking every enabled rule's `question` (drafts included, at most 64) about the page's text (at most 60,000 characters).
- Unverified endpoint behaviour: the model id `@cf/cloudflare/clef-flash`, the input shape (`model`, `state`, `questions` with `noul` questions) and the output shape (`answers.<id>.noul`, `usage`) come from the model's published schema and have not been checked against a live account. A call that throws, or returns no usable score, is recorded as an error: the page keeps its rule flags unchanged and its Clef state shows `error`.
- Untested image input: sending the screenshot as `images: [{ content_type, base64 }]` is documented but untested. It is behind `CLEF_IMAGE`, off by default; a screenshot over 4 MiB is skipped and noted.
- The flag line has three sources, in order: the stored config (`POST /config`, fed by the `clef_flag_at` setting), the `CLEF_FLAG_AT` var, then 0.7. A value stored in R2 keeps winning over the var until it is changed, so editing `wrangler.jsonc` alone does nothing once a setting has been pushed. A new line applies to captures made after it; earlier captures keep the line they were scored with.
- Calibration pending: the flag line (default 0.7) has not been checked against real pages. Expect Clef-only flags that are wrong and rule hits marked needs review that are right. Review both by hand and move the line only after a pilot.
- The page text is sent to Clef with an instruction that it is data, not instructions. A page could still try to steer a score. A Clef-only flag carries no quote, so a person must read the page to confirm it.
- The questions are bundled into the Worker at deploy time. After a rule is added or a `question` changes, redeploy the Worker; until then the run raises "Worker asks Clef different rules" under Worker health.
- A flag that Clef backs (origin `clef` or `both`) resolves only on a run where Clef scored the page. While Clef is off or failing it stays open; drop it by hand if Clef stays off.
- Each page record carries a Clef card of at most 20 rows (flags and needs-review rows first) to stay inside the Desk's document size limit; the rest are counted as left out.

## Worker security

- Every route except `/health` and signed `/shot/` links needs the token header. With no token set, the Worker answers 503 rather than running open.
- The review token is a long-lived shared secret that sits in three places: the Worker secret (`ACCESS_TOKEN`), the routine's network secret and your own machine for local checks. Pasting it into a chat or a ticket exposes it. Rotate it in all three together (`npx wrangler secret put ACCESS_TOKEN`, the routine's secret, your local copy) whenever it has been shown anywhere it should not be; until the routine's copy matches, runs record the Worker as unreachable.
- Signed links use an HMAC key derived from the token. Anyone holding a link can view that screenshot until it expires (default 24 hours).
- The routine keeps only captures on the site host and https; anything else is counted as refused and raised under Worker health.
- How the routine's environment attaches the token as a network secret is unverified. If it cannot, the fetch stage records the Worker as unreachable and the run is partial.
