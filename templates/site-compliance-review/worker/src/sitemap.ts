// Sitemap sync: reads SITEMAP_URL (and up to 20 child sitemaps of an index), then queues pages that
// are new or whose last capture is older than RECAPTURE_DAYS. Only allow-listed https URLs are kept.
import { allowedHosts, checkTarget, num, USER_AGENT, type Env } from "./env";
import { enqueue, readMeta, readPages, readQueue, setMeta } from "./store";

const MAX_CHILDREN = 20;
const MAX_URLS = 5000;
const MAX_SITEMAP_BYTES = 10 * 1024 * 1024;
const DAY_MS = 86400 * 1000;

function decode(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

/** The <loc> values of a sitemap, and whether it is a sitemap index. */
export function parseSitemap(xml: string): { index: boolean; locs: string[] } {
  const index = /<sitemapindex[\s>]/i.test(xml);
  const locs: string[] = [];
  const re = /<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/gi;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    locs.push(decode(m[1]));
    if (locs.length >= MAX_URLS) break;
  }
  return { index, locs };
}

async function getXml(url: URL): Promise<string> {
  // Redirects are not followed, so a sitemap can never send the Worker to another host.
  const res = await fetch(url.toString(), { headers: { "user-agent": USER_AGENT }, redirect: "manual" });
  if (!res.ok) throw new Error(`${url.pathname} answered ${res.status}`);
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len > MAX_SITEMAP_BYTES) throw new Error(`${url.pathname} is too large`);
  const text = await res.text();
  if (text.length > MAX_SITEMAP_BYTES) throw new Error(`${url.pathname} is too large`);
  return text;
}

/** Reads the sitemap, records what it read in meta, and queues new or stale pages. */
export async function syncSitemap(env: Env, now: number): Promise<{ urls: number; queued: number; errors: string[] }> {
  const hosts = allowedHosts(env);
  const root = checkTarget(env.SITEMAP_URL, hosts);
  const errors: string[] = [];
  const found = new Set<string>();
  if (!root) {
    errors.push("SITEMAP_URL is not set or not on an allowed host");
  } else {
    try {
      const top = parseSitemap(await getXml(root));
      const children = top.index ? top.locs.slice(0, MAX_CHILDREN) : [];
      if (top.index && top.locs.length > MAX_CHILDREN) errors.push(`only the first ${MAX_CHILDREN} child sitemaps were read`);
      const pages = top.index ? [] : top.locs;
      for (const child of children) {
        const target = checkTarget(child, hosts);
        if (!target) {
          errors.push("a child sitemap is not on an allowed host");
          continue;
        }
        try {
          pages.push(...parseSitemap(await getXml(target)).locs);
        } catch (e) {
          errors.push(e instanceof Error ? e.message : "child sitemap failed");
        }
      }
      for (const loc of pages) {
        const t = checkTarget(loc, hosts);
        if (t) found.add(t.toString());
        if (found.size >= MAX_URLS) break;
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "sitemap failed");
    }
  }

  const pagesIndex = await readPages(env.REVIEW);
  const queue = await readQueue(env.REVIEW);
  const failed = new Set(queue.failed);
  const staleMs = num(env.RECAPTURE_DAYS, 30, 1, 365) * DAY_MS;
  const due: string[] = [];
  for (const url of found) {
    if (failed.has(url)) continue;
    const seen = pagesIndex[url];
    if (!seen || now - Date.parse(seen.capturedAt) > staleMs) due.push(url);
  }
  const queued = await enqueue(env.REVIEW, due.slice(0, num(env.MAX_NEW_PER_SYNC, 5, 1, 1000)));
  await setMeta(env.REVIEW, {
    sitemap: { url: root ? root.toString() : "", lastRefreshAt: new Date(now).toISOString(), errors: errors.slice(0, 5), urls: found.size },
  });
  return { urls: found.size, queued, errors };
}

/** True when the last sitemap read is older than a day. */
export async function sitemapDue(env: Env, now: number): Promise<boolean> {
  const meta = await readMeta(env.REVIEW);
  const last = meta.sitemap ? Date.parse(meta.sitemap.lastRefreshAt) : 0;
  return !(now - last < DAY_MS);
}
