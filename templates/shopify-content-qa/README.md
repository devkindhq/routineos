# shopify-content-qa

Checks a Shopify store's public pages for content problems every day and reports what is new, still open or fixed since the last run. It never edits the store. Status: template, version 1, unpiloted (no real run has checked it yet).

## What it does

It reads the store's sitemap and public pages, runs a set of deterministic checks from an editable rule pack, and compares the result with what it stored on earlier runs. New problems reach the Inbox, highest severity first. Problems a person marked as needing a fix send a "Fixed" message once they are gone. Its push rule: report-only. It never edits the store. It never logs in, never changes a product, page, price or setting, and never contacts anyone.

Checks (all in `lib/rules.json`, each with a severity you can change):

| Rule | Default severity | Finds |
|---|---|---|
| `page_error` | high | a listed page or its product JSON that does not load |
| `missing_description` | high | a product with an empty description |
| `broken_image` | high | an image on the store host that fails, or an image tag with no source |
| `placeholder_text` | high | phrases such as "lorem ipsum" and tokens such as TODO or TBD |
| `missing_seo_title` | high | a page with no title |
| `zero_price` | high | a variant priced at zero |
| `missing_alt` | medium | images with no alt attribute (`alt=""` marks a decorative image and passes) |
| `broken_link` | medium | a link to another page on the store that fails |
| `missing_meta_description` | medium | a page with no meta description |
| `compare_at_not_above` | medium | a compare-at price that is not above the price |
| `unavailable_featured` | medium | a sold-out product linked from the home page |
| `thin_description` | low | a product description under `thin_description_words` words, or under `min_chars` characters in `lib/rules.json` when it is mostly in a script written without spaces (such as Chinese, Japanese or Thai) |
| `duplicate_title` | low | the same title on more than one page |
| `restricted_wording` | medium, off | phrases you list in `restricted_phrases`; the shipped list is an example only |

## Setup

1. Install the pack, then open the Desk Settings page.
2. Set `store_url` to your store's public address, for example `https://your-store.com` or `https://example-store.myshopify.com`. This is the only setting you must change. Use the address the store answers on: if `https://your-store.com` redirects to `https://www.your-store.com`, the first run stops with "store redirects to https://www.your-store.com; set store_url to that", and a store behind its password page stops as password protected.
3. Add that store host to your environment's allowed domains. The scripts fetch nothing else, and the routine needs no login or key.
4. Leave `fetch_mode` as `direct` (the default). The checks run without any Worker and without screenshots.
5. Optional screenshots, pick one:
   - Lighter: add the Cloudflare Browser MCP server as a connector and set `max_screenshots` to a small number. The routine may view a few pages with high issues and note what it sees in the Inbox. Nothing is stored.
   - Stored: deploy the Worker in `worker/` (steps below), set `fetch_mode` to `worker`, set `worker_url` to its address and set `max_screenshots`.
6. Run it once. The first run is report-only: it records pages and issues and writes nothing else.
7. Review issues on the Desk. Keep an issue that needs a fix. Drop one with a reason starting "accepted" when it is intentional. Drop with any other reason when the check is wrong.

### Deploying the Worker (optional)

The Worker is not part of the installed pack; it lives in this template's repository folder.

1. In `worker/`, run `npm install`.
2. Edit `wrangler.jsonc`: replace every `REPLACE_` value. Set `ALLOWED_HOSTS` to your store host (comma separated for more than one) and create the R2 bucket you name there.
3. Set the access token with `npx wrangler secret put ACCESS_TOKEN`. Use a long random value and keep it out of any file.
4. Run `npx wrangler deploy`.
5. In the routine's environment, add the Worker host to the allowed domains and add the token as a network secret sent in the `x-content-qa-token` header for that host.
6. Optional: to add a vision note to each screenshot, uncomment the `ai` binding and set `VISION_CHECK` to `on`. It is off by default and unverified.

## Stages

| Stage | Kind | Does |
|---|---|---|
| discover | code | Reads the home page, the sitemap, the public `products.json` feed and each page on the store host, with a pause between requests; never-read and least recently read pages go first under the page cap. |
| check | code | Applies the editable rule pack in `lib/rules.json`. |
| shots | code | Queues captures on your own Worker and reads short-lived links; off unless `max_screenshots` is above 0. |
| look | model | May view a few pages with high issues through the browser connector and add a note to the Inbox; never changes an issue. |
| track | code | Compares with stored pages and issues, honours decisions and builds records and the Inbox. |
| learn | code | Turns feedback on earlier runs into learning and proposals before the write. |
| write | code | Applies the run input under the write contract. |

## Connectors

Installing the pack connects nothing and holds no secret. Connect each one yourself. Products named as alternatives are examples; whether each offers the access listed is unverified.

| Connector | Kind | Needed | Access | Used by |
|---|---|---|---|---|
| Your store's public pages | http | required | read | discover |
| Your content QA Worker | http | optional | read | discover, shots |
| Cloudflare Browser | mcp | optional | read | look |

## Settings

People edit these on the Desk Settings page.

| Setting | Type | Default | Note |
|---|---|---|---|
| `store_url` | list | `[]` | required; the first entry is used |
| `fetch_mode` | choice | `direct` | `direct` needs no Worker; `worker` fetches through your Worker |
| `worker_url` | list | `[]` | only for `worker` mode |
| `max_pages` | number | `200` | more pages mean a longer run and more requests to the store |
| `request_delay_ms` | number | `1000` | pause between requests; a longer pause is gentler on the store |
| `max_link_checks` | number | `100` | each check is one request to the store |
| `thin_description_words` | number | `30` | a higher value means more flags |
| `restricted_phrases` | list | `[]` | empty keeps the restricted wording check off |
| `max_screenshots` | number | `0` | 0 is off |
| `max_inbox_per_run` | number | `10` | more messages ask more of your attention |

## Files

- `routine.toml`: type, schedule, store, settings and the gate.
- `prompt.md`: the routine prompt, with the untrusted-data clause and the push rule.
- `definition.json`: the page and issue record types, identity rules and views.
- `pack.json`: the pack metadata, stages and connectors.
- `lib/discover.py`: reads the sitemap, the `products.json` feed and pages from the store host only.
- `lib/qa_checks.py`: applies the rule pack.
- `lib/rules.json`: the editable rule pack.
- `lib/track.py`: compares with stored state and builds records and the Inbox.
- `lib/worker_shots.py`: queues screenshots on the Worker and reads links.
- `worker/` (repository only, not in the pack): the optional Cloudflare Worker, with tests.
- `risks.md` (repository only): the longer risk notes.

## Decisions

- Default path: `direct` fetch mode with no screenshots. It needs nothing but the store URL and an allowed domain.
- Screenshots: the Cloudflare Browser MCP connector is the lighter path (nothing to deploy, nothing stored). The Worker is the heavier path for stored screenshots with signed links. Both are off by default.
- All checks live in one Python rule pack. The Worker is a thin fetch proxy and capture queue, so a rule never has two implementations.
- `store_url` is a list setting because settings have no text type; the first entry is used.
- Decisions map onto the Desk's Keep and Drop: Keep means needs a fix, Drop with a reason starting "accepted" means intentional, any other Drop means the check was wrong.
- The Worker connector is marked read: queuing a capture changes nothing on the store.
- Locale-prefixed URLs (for example `/fr/products/...`) are skipped, so each page is checked once.
- Prices are compared only with each other on the same variant; no currency or unit is assumed.
- Images served from another host (such as a CDN) are counted but not fetched.
- No n8n inspiration; this template was written from scratch.

## Platform claims

Claims about Shopify and Cloudflare behaviour, tagged by how they were checked.

- docs: a Shopify store publishes `sitemap.xml` at the domain root, linking child sitemaps for products, collections, pages and blogs (help.shopify.com).
- docs: `/products/<handle>.js` returns the product as JSON, with variants, prices, compare-at prices and availability (Shopify Ajax API reference). The docs do not state the price unit or a rate limit.
- unverified: `/products.json?limit=250&page=N` returns the store's published products with `handle`, `body_html` and variants (`price`, `compare_at_price`, `available`), and an empty list past the last page. The routine reads at most 20 pages, joins the result with the sitemap and uses it in place of most `.js` reads; when the feed is off or fails on its first page, the sitemap is used alone.
- docs: Cloudflare Browser Run `quickAction("screenshot", ...)` returns the image, needs a compatibility date of 2026-03-24 or later, and does not run in local dev without remote mode (developers.cloudflare.com).
- unverified: an R2 conditional put with `onlyIf: { etagDoesNotMatch: "*" }` fails when the key already exists, so two first writes of the shot index cannot both succeed. The docs state that a failed condition returns null, not this wildcard form.
- unverified: the environment's network secret attaching the token header to Worker requests.
- unverified: the Workers AI vision model named in `worker/src/index.ts` and its input shape.

## Known risks

- A store may rate limit or block the crawl. The scripts pause between requests, retry a 429 or 503 once, and record the rest as errors; a large store needs a longer pause or a lower `max_pages`.
- Checks read the HTML the server sends. Content added later by scripts in the browser is not seen, so some missing alt text or empty sections can be missed or reported wrongly.
- A theme can hide a description or title in a way the checks misread. Drop the issue with a reason, or turn the rule off in `lib/rules.json`.
- An issue resolves only when its page loaded this run (status 200, plus the product JSON for a product page, and every link or image checked for the broken link and image rules). A failed or rate-limited read keeps it open.
- No page is marked removed when a child sitemap or the product feed failed this run.
- A dismissed issue stays dismissed until a person restores it on the Desk, even if the page changes.
- Screenshot links are signed and short-lived, so a link in an older record stops working.
- The Worker is one more thing to deploy and keep patched, and its token is a secret to rotate if it leaks. Rotating it voids every signed link.
- See `risks.md` in the repository for more detail.

## Inspiration

None. Written from scratch.
