# shopify-content-qa: risks

Longer notes behind the README's Known risks. This file stays in the repository and is not part of the installed pack.

## Load on the store

- The crawl is polite by design: one request at a time, a pause of `request_delay_ms` (at least 250 ms), one retry after a 429 or 503 that honours Retry-After up to 30 seconds, and a page cap. A store with thousands of products is only partly read each run; pages left out by the cap are neither read nor marked removed.
- Shopify's storefront rate limits are not documented for these endpoints. Treat the defaults as a starting point and lengthen the pause if errors appear.

## What the checks can and cannot see

- The scripts read server HTML and the documented product `.js` JSON. They do not run page scripts, so content injected in the browser is invisible to them.
- Off-host images (most store images are served from a CDN host) are counted but not fetched, so a broken CDN image is not caught unless a screenshot shows it.
- Placeholder tokens match whole words in visible text. A product that legitimately uses a token such as "TBC" in its name will be flagged; drop it with a reason starting "accepted".
- Restricted wording is an example list and off by default. It is a phrase match, not legal or policy advice.

## Decisions and state

- A person's Drop is permanent for that issue id until restored. The id is the rule plus a hash of the page URL, so the same rule on the same page stays dropped even if its detail changes.
- A page that leaves the sitemap is marked removed and its open issues resolve. A page that only fell outside the page cap is left as it was. When a child sitemap fails, or the products.json feed fails after its first page or reaches its 20-page cap, `sitemap_complete` is false and no page is marked removed that run.
- The page cap rotates: discovery reads the home page, then pages never read, then the least recently read (by the stored `lastSeen`). Successive runs cover every listed page.
- An issue resolves only from a good read: the page loaded with status 200, a product page's JSON loaded, and for broken links or images every target on that page was checked. Link targets are checked in sorted order, so the same targets are checked each run while the page is unchanged.
- The page id is a hash of the page URL. A store that moves a page to a new URL gets a new page record; the old one is marked removed once it leaves the sitemap.
- Learning runs before every write; its proposals can suggest a setting change, which a person must accept on the Desk.

## Worker

- The Worker fetches only hosts in `ALLOWED_HOSTS`, over https on the default port, and returns redirects instead of following them, so the Python side applies its own host check to every hop.
- Every route except `/health` and signed `/shot/` links needs the token header. With no token set, the Worker answers 503 rather than running open.
- Signed links use an HMAC key derived from the token. Anyone holding a link can view that screenshot until it expires (default 24 hours).
- Screenshots are stored in your R2 bucket with no automatic expiry. Add an R2 lifecycle rule if you want them removed.
- The optional vision note uses a Workers AI model whose name and input shape are unverified; a failure leaves the note empty and never stops a capture.
- How the routine's environment attaches the token as a network secret is unverified. If it cannot, `lib/worker_shots.py` records the 401 and the content checks still run.
