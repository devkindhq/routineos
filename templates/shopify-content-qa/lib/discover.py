"""Discover and read a Shopify storefront's public pages. Standard library only. Read only.

Usage: python3 lib/discover.py --store https://your-store.com --out pages.json
       [--max-pages 200] [--delay-ms 1000] [--max-link-checks 100]
       [--docs snapshot.json --producer shopify-content-qa]
       [--via https://qa-worker.example.workers.dev] [--replay DIR]

The first request reads the home page. A store whose address redirects to another host stops
with exit 2 and names the host to use; a redirect to /password stops as password protected.

Discovery: /sitemap.xml and the child sitemaps it lists (documented by Shopify), plus the
public /products.json?limit=250&page=N feed (stops on an empty page, at most MAX_PRODUCT_PAGES
pages). The page list is the union of both. A store with the feed disabled or failing on its
first page uses the sitemap alone; that is not an error. Then each page's HTML. A product page
uses its feed data when present and otherwise reads /products/<handle>.js (the documented Ajax
product JSON). sitemap_complete is false when a child sitemap failed or the feed failed after
its first page or hit the page cap; the track step then marks no page removed.

Only the store host is fetched; every other host is refused, and a redirect to another host is
recorded as an error, not followed. Requests are sequential with --delay-ms between them; a 429
or 503 waits once (Retry-After, at most 30 s) and then records rate-limited. With --docs, the
page cap reads pages never read first, then the least recently read, so successive runs cover
every listed page. Same-host link and image targets are checked in sorted order up to
--max-link-checks; width variants of one /cdn/shop/ image are checked once. Each page records
links_complete and images_complete: whether every target on it was checked this run.

--via sends every request through the person's own worker (GET <via>/fetch?url=...); the
worker holds the same host allow-list. --replay reads files from DIR instead of the network
(tests and dry runs): / is index.html, /a/b is a/b.html, and .xml or .js paths keep their name;
a URL with a query reads "<path>?<query>" when that file exists.

Prints a compact summary; pages.json holds the facts the checks read. Exit 2 on bad arguments
or when the sitemap cannot be read; page values are never echoed on errors.
"""
import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from html.parser import HTMLParser

USER_AGENT = "RoutineOS-content-qa/1 (read-only monitor)"
MAX_BYTES = 3 * 1024 * 1024
MAX_TEXT = 20000
MAX_IMAGES = 60
MAX_LINKS = 200
MAX_LISTED = 50000
MAX_PRODUCT_PAGES = 20
MAX_FEED_BYTES = 8 * 1024 * 1024
URL_SAFE = "/%:@!$&'()*+,;=-._~"
KINDS = ("home", "product", "collection", "page", "article")
PATH_KIND = [
    (re.compile(r"^/products/[^/]+$"), "product"),
    (re.compile(r"^/collections/[^/]+$"), "collection"),
    (re.compile(r"^/pages/[^/]+$"), "page"),
    (re.compile(r"^/blogs/[^/]+/[^/]+$"), "article"),
]
SKIP_TAGS = {"script", "style", "noscript", "template", "svg"}


# A URL argument is matched against a character allow-list, so only a plain https address is accepted.
URL_RE = re.compile(r"https://[A-Za-z0-9.-]{1,253}(?::[0-9]{1,5})?(?:/[A-Za-z0-9._~%+/-]{0,300})?(?:\?[A-Za-z0-9._~%+/=-]{0,300})?")


def fail(msg):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(2)


def store_origin(raw):
    parts = urllib.parse.urlsplit(raw.strip())
    if not URL_RE.fullmatch(raw.strip()) or parts.scheme != "https" or not parts.hostname:
        fail("--store must be a plain https URL such as https://your-store.com")
    return f"https://{parts.hostname.lower()}"


def same_host(url, host):
    try:
        parts = urllib.parse.urlsplit(url)
        return parts.scheme == "https" and (parts.hostname or "").lower() == host
    except ValueError:
        return False


def ascii_url(url):
    """The URL with path and query percent-encoded, so a non-ASCII URL never raises on the wire."""
    parts = urllib.parse.urlsplit(url)
    return urllib.parse.urlunsplit((parts.scheme, parts.netloc, urllib.parse.quote(parts.path, safe=URL_SAFE),
                                    urllib.parse.quote(parts.query, safe=URL_SAFE + "?"), ""))


def canonical(url, host):
    """The https URL on the store host without query or fragment, path percent-encoded, or None."""
    try:
        parts = urllib.parse.urlsplit(url)
        if (parts.hostname or "").lower() != host or parts.scheme not in ("https", "http"):
            return None
    except ValueError:
        return None
    path = urllib.parse.quote(parts.path or "/", safe="/%")
    if len(path) > 1:
        path = path.rstrip("/")
    return f"https://{host}{path}"


def check_target(url, host):
    """The URL a link check requests: /cdn/shop/ images lose their query (width variants are one file)."""
    parts = urllib.parse.urlsplit(url)
    if parts.path.startswith("/cdn/shop/"):
        return urllib.parse.urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))
    return url


def kind_of(url):
    path = urllib.parse.urlsplit(url).path or "/"
    if path == "/":
        return "home"
    for rx, kind in PATH_KIND:
        if rx.match(path):
            return kind
    return None


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Fetcher:
    def __init__(self, host, delay_ms, via=None, replay=None):
        self.host, self.delay, self.via, self.replay = host, delay_ms / 1000.0, via, replay
        self.opener = urllib.request.build_opener(_NoRedirect)
        self.requests = 0
        self._last = 0.0
        self.final_url, self.redirect_location = None, None

    def _replay_path(self, url):
        parts = urllib.parse.urlsplit(url)
        path = urllib.parse.unquote(parts.path).lstrip("/")
        if not path:
            return os.path.join(self.replay, "index.html")
        if not os.path.splitext(path)[1]:
            path += ".html"
        full = os.path.normpath(os.path.join(self.replay, path))
        if not full.startswith(os.path.normpath(self.replay) + os.sep):
            return None
        if parts.query and os.path.isfile(f"{full}?{parts.query}"):
            return f"{full}?{parts.query}"
        return full

    def get(self, url, limit=MAX_BYTES, redirects=3):
        """(status, body text or None, error reason or None). Never fetches another host.

        Sets final_url to the URL that answered and redirect_location to an off-host Location.
        """
        self.final_url, self.redirect_location = url, None
        if not same_host(url, self.host):
            return 0, None, "off-host"
        try:
            url = ascii_url(url)
        except ValueError:
            return 0, None, "bad-url"
        self.final_url = url
        if self.replay:
            path = self._replay_path(url)
            if not path or not os.path.isfile(path):
                return 404, None, None
            with open(path, encoding="utf-8", errors="replace") as fh:
                return 200, fh.read(limit), None
        wait = self.delay - (time.monotonic() - self._last)
        if wait > 0:
            time.sleep(wait)
        target = url
        if self.via:
            target = f"{self.via}/fetch?url={urllib.parse.quote(url, safe='')}"
        for attempt in (0, 1):
            self._last = time.monotonic()
            self.requests += 1
            req = urllib.request.Request(target, headers={"User-Agent": USER_AGENT})
            try:
                with self.opener.open(req, timeout=20) as resp:
                    body = resp.read(limit + 1)
                    if len(body) > limit:
                        return resp.status, None, "too-large"
                    return resp.status, body.decode("utf-8", errors="replace"), None
            except urllib.error.HTTPError as exc:
                if exc.code in (301, 302, 303, 307, 308):
                    loc = exc.headers.get("Location", "")
                    nxt = urllib.parse.urljoin(url, loc)
                    if same_host(nxt, self.host):
                        if redirects > 0:
                            return self.get(nxt, limit, redirects - 1)
                        return exc.code, None, "too-many-redirects"
                    self.redirect_location = nxt
                    return exc.code, None, "redirect-off-host"
                if exc.code in (429, 503) and attempt == 0:
                    try:
                        pause = min(30.0, float(exc.headers.get("Retry-After", "5")))
                    except ValueError:
                        pause = 5.0
                    time.sleep(max(pause, self.delay))
                    continue
                return exc.code, None, "rate-limited" if exc.code in (429, 503) else None
            except (urllib.error.URLError, TimeoutError, OSError, ValueError, UnicodeError):
                return 0, None, "unreachable"
        return 0, None, "rate-limited"


def sitemap_locs(text):
    """(child sitemap locs, page locs) from a sitemap or sitemap index document."""
    if "<!DOCTYPE" in text.upper() or "<!ENTITY" in text.upper():
        return None  # sitemaps need neither; refusing them avoids entity expansion attacks
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        return None
    children, pages = [], []
    for el in root.iter():
        tag = el.tag.rsplit("}", 1)[-1]
        if tag not in ("sitemap", "url"):
            continue
        loc = next((c.text or "" for c in el if c.tag.rsplit("}", 1)[-1] == "loc"), "").strip()
        if loc:
            (children if tag == "sitemap" else pages).append(loc)
    return children, pages


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title, self.meta_description, self.h1 = None, None, 0
        self.images, self.links, self.text = [], [], []
        self._skip, self._in_title, self._title_done = 0, False, False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in SKIP_TAGS:
            self._skip += 1
        elif self._skip:
            return  # svg titles, noscript images and template content are not the page's own
        elif tag == "title":
            if not self._title_done:
                self._in_title, self.title = True, self.title or ""
        elif tag == "meta" and (a.get("name") or "").lower() == "description":
            self.meta_description = (a.get("content") or "").strip()
        elif tag == "h1":
            self.h1 += 1
        elif tag == "img":
            self.images.append({"src": (a.get("src") or a.get("data-src") or "").strip(),
                                "alt": None if a.get("alt") is None else a.get("alt").strip()})
        elif tag == "a" and a.get("href"):
            self.links.append(a["href"].strip())

    def handle_endtag(self, tag):
        if tag in SKIP_TAGS and self._skip:
            self._skip -= 1
        elif tag == "title" and self._in_title:
            self._in_title, self._title_done = False, True

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        elif not self._skip:
            self.text.append(data)


def html_text(fragment):
    p = PageParser()
    p.feed(fragment or "")
    return " ".join(" ".join(p.text).split())


def product_facts(description_html, available, raw_variants, source):
    desc = html_text(description_html or "")
    variants = []
    for v in raw_variants or []:
        if isinstance(v, dict):
            variants.append({"price": v.get("price"), "compare_at_price": v.get("compare_at_price"),
                             "available": v.get("available")})
    return {"status": 200, "source": source, "available": available, "description_words": len(desc.split()),
            "description_text": desc[:MAX_TEXT], "variants": variants[:250]}


def read_product(fetcher, url):
    status, body, err = fetcher.get(url + ".js")
    if status != 200 or body is None:
        return {"status": status, **({"error": err} if err else {})}
    try:
        data = json.loads(body)
    except ValueError:
        return {"status": status, "error": "not-json"}
    if not isinstance(data, dict):
        return {"status": status, "error": "not-json"}
    return product_facts(data.get("description"), data.get("available"), data.get("variants"), "js")


def product_feed(fetcher, host):
    """({product url: facts}, {status, pages, products}) from /products.json, paged until empty.

    status: ok, unavailable (first page failed or is not a product list; the sitemap is used
    alone), partial (a later page failed) or capped (MAX_PRODUCT_PAGES pages and still going).
    """
    products, pages, status = {}, 0, "ok"
    for n in range(1, MAX_PRODUCT_PAGES + 1):
        s, body, _ = fetcher.get(f"https://{host}/products.json?limit=250&page={n}", limit=MAX_FEED_BYTES)
        try:
            items = json.loads(body).get("products") if s == 200 and body else None
        except (ValueError, AttributeError):
            items = None
        if not isinstance(items, list):
            status = "unavailable" if n == 1 else "partial"
            break
        pages += 1
        if not items:
            break
        for item in items:
            handle = item.get("handle") if isinstance(item, dict) else None
            if not isinstance(handle, str) or not handle.strip():
                continue
            url = canonical(f"https://{host}/products/{handle.strip()}", host)
            if not url or kind_of(url) != "product":
                continue
            variants = [v for v in item.get("variants") or [] if isinstance(v, dict)]
            available = any(v.get("available") is True for v in variants)
            products[url] = product_facts(item.get("body_html"), available, variants, "products.json")
    else:
        status = "capped"
    if status == "unavailable":
        products = {}
    return products, {"status": status, "pages": pages, "products": len(products)}


def content_hash(page):
    """A hash of only what the rules read; digits in body text (stock and review counts) are ignored."""
    product = page.get("product") or {}
    facts = {
        "title": page.get("title"), "meta_description": page.get("meta_description"), "h1": page.get("h1_count"),
        "text": re.sub(r"\d+", "#", page.get("text") or ""), "images": page.get("images"),
        "product": {"available": product.get("available"), "description": product.get("description_text"),
                    "variants": [[v.get("price"), v.get("compare_at_price")] for v in product.get("variants") or []]}
        if product else None,
    }
    return hashlib.sha256(json.dumps(facts, sort_keys=True).encode("utf-8")).hexdigest()[:16]


def page_id(url):
    return "page--" + hashlib.sha256(url.encode("utf-8")).hexdigest()[:12]


def read_page(fetcher, url, kind, host, feed=None):
    status, body, err = fetcher.get(url)
    page = {"url": url, "id": page_id(url), "kind": kind, "status": status}
    if err:
        page["error"] = err
    if status != 200 or body is None:
        return page
    p = PageParser()
    try:
        p.feed(body)
    except Exception:  # html.parser is lenient; anything else is recorded, never raised
        page["error"] = "unparsed"
        return page
    text = " ".join(" ".join(p.text).split())
    links = []
    for href in p.links:
        c = canonical(urllib.parse.urljoin(url, href), host)
        if c and c not in links:
            links.append(c)
    images = []
    for img in p.images[:MAX_IMAGES]:
        src = img["src"]
        try:
            full = urllib.parse.urljoin(url, src) if src else ""
        except ValueError:
            full = src
        images.append({"src": check_target(full, host) if full and same_host(full, host) else full, "alt": img["alt"]})
    page.update({"title": " ".join((p.title or "").split()), "meta_description": p.meta_description or "",
                 "h1_count": p.h1, "words": len(text.split()), "text": text[:MAX_TEXT],
                 "images": images, "links": links[:MAX_LINKS]})
    if kind == "product":
        page["product"] = (feed or {}).get(url) or read_product(fetcher, url)
    page["hash"] = content_hash(page)
    return page


def check_address(fetcher, origin):
    """Stops with exit 2 when the store address redirects to another host or to the password page."""
    fetcher.get(origin + "/")
    if fetcher.redirect_location:
        parts = urllib.parse.urlsplit(fetcher.redirect_location)
        target = f"{parts.scheme}://{parts.hostname}" if parts.hostname else "another address"
        fail(f"store redirects to {target}; set store_url to that")
    if urllib.parse.urlsplit(fetcher.final_url or "").path.rstrip("/") == "/password":
        fail("store is password protected (it redirects to /password); the checks need a public store")


def cap_order(listed, seen):
    """Home first, then pages never read, then the least recently read; kind and URL break ties."""
    order = {k: i for i, k in enumerate(KINDS)}
    return sorted(listed, key=lambda u: (kind_of(u) != "home", seen.get(u, ""), order[kind_of(u)], u))


def last_read(docs, producer):
    """{page url: lastSeen} for this producer's stored page records."""
    seen = {}
    for path, doc in (docs or {}).items():
        data = (doc or {}).get("data") if isinstance(doc, dict) else None
        if not path.startswith("entities/") or not isinstance(data, dict) or data.get("type") != "page":
            continue
        values = (data.get("bySource") or {}).get(producer)
        if isinstance(values, dict) and isinstance(values.get("url"), str) and isinstance(data.get("lastSeen"), str):
            seen[values["url"]] = data["lastSeen"]
    return seen


def discover(fetcher, origin, max_pages, max_link_checks, seen=None):
    host = urllib.parse.urlsplit(origin).hostname
    errors = []
    check_address(fetcher, origin)
    status, body, err = fetcher.get(origin + "/sitemap.xml")
    found = sitemap_locs(body) if status == 200 and body else None
    if found is None:
        fail("cannot read the store sitemap (check the store URL and the allowed domains)")
    children, locs = found
    for child in children:
        if not same_host(child, host):
            errors.append({"url": "sitemap child", "reason": "off-host"})
            continue
        s, b, _ = fetcher.get(child)
        got = sitemap_locs(b) if s == 200 and b else None
        if got is None:
            errors.append({"url": child, "reason": f"sitemap {s}"})
            continue
        locs.extend(got[1])
    sitemap_failed = any(e["reason"] != "off-host" for e in errors)
    feed, feed_status = product_feed(fetcher, host)
    listed = []
    for loc in locs + sorted(feed):
        c = canonical(loc, host)
        if c and kind_of(c) and c not in listed:
            listed.append(c)
    home = f"https://{host}/"
    listed = [home] + [u for u in listed if u != home]
    queue = cap_order(listed, seen or {})[:max_pages]
    pages = [read_page(fetcher, u, kind_of(u), host, feed) for u in queue]
    crawled = {p["url"] for p in pages}
    targets, offhost = set(), 0
    for p in pages:
        for link in p.get("links", []):
            if link not in crawled and kind_of(link):
                targets.add(link)
        for img in p.get("images", []):
            src = img["src"]
            if not src:
                continue
            if same_host(src, host):
                targets.add(src)
            else:
                offhost += 1
    targets = sorted(targets)
    link_status = {}
    for t in targets[:max_link_checks]:
        s, _, _ = fetcher.get(t, limit=1)
        link_status[t] = s
    for p in pages:
        link_status.setdefault(p["url"], p["status"])
    for p in pages:
        if p["status"] == 200 and "links" in p:
            p["links_complete"] = all(l in link_status for l in p["links"] if kind_of(l))
            p["images_complete"] = all(i["src"] in link_status for i in p["images"]
                                       if i["src"] and same_host(i["src"], host))
    return {
        "store": origin,
        "listed": listed[:MAX_LISTED],
        "sitemap_complete": not sitemap_failed and feed_status["status"] in ("ok", "unavailable")
        and len(listed) <= MAX_LISTED,
        "products_json": feed_status,
        "pages": pages,
        "link_status": link_status,
        "links_unchecked": max(0, len(targets) - max_link_checks),
        "offhost_images_unchecked": offhost,
        "errors": errors,
        "requests": fetcher.requests,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0], fromfile_prefix_chars="@")
    ap.add_argument("--store", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--max-pages", type=int, default=200)
    ap.add_argument("--delay-ms", type=int, default=1000)
    ap.add_argument("--max-link-checks", type=int, default=100)
    ap.add_argument("--docs")
    ap.add_argument("--producer", default="shopify-content-qa")
    ap.add_argument("--via")
    ap.add_argument("--replay")
    args = ap.parse_args()
    origin = store_origin(args.store)
    if not 1 <= args.max_pages <= 2000:
        fail("--max-pages must be between 1 and 2000")
    if not 250 <= args.delay_ms <= 10000 and not args.replay:
        fail("--delay-ms must be between 250 and 10000")
    if not 0 <= args.max_link_checks <= 1000:
        fail("--max-link-checks must be between 0 and 1000")
    via = None
    if args.via:
        parts = urllib.parse.urlsplit(args.via)
        if not URL_RE.fullmatch(args.via) or parts.scheme != "https" or not parts.hostname:
            fail("--via must be a plain https URL")
        via = f"https://{parts.hostname.lower()}"
    if args.replay and not os.path.isdir(args.replay):
        fail("--replay must be a folder")
    seen = {}
    if args.docs:
        try:
            with open(args.docs, encoding="utf-8") as fh:
                docs = json.load(fh)
        except (OSError, ValueError):
            fail("cannot read --docs as JSON")
        if not isinstance(docs, dict):
            fail("--docs must be a JSON object")
        seen = last_read(docs, args.producer)
    fetcher = Fetcher(urllib.parse.urlsplit(origin).hostname, args.delay_ms, via, args.replay)
    result = discover(fetcher, origin, args.max_pages, args.max_link_checks, seen)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2)
    kinds = {}
    for p in result["pages"]:
        kinds[p["kind"]] = kinds.get(p["kind"], 0) + 1
    print(json.dumps({"listed": len(result["listed"]), "read": len(result["pages"]), "by_kind": kinds,
                      "not_ok": sum(1 for p in result["pages"] if p["status"] != 200),
                      "links_checked": len(result["link_status"]), "links_unchecked": result["links_unchecked"],
                      "sitemap_complete": result["sitemap_complete"], "products_json": result["products_json"]["status"],
                      "errors": len(result["errors"]), "requests": result["requests"]}, indent=2))


if __name__ == "__main__":
    main()
