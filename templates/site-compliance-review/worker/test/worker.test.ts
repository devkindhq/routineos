import { afterEach, describe, expect, it, vi } from "vitest";
import { signedPath } from "../src/auth";
import { allowRequestPatterns, pngSize, readScrape, runBatch } from "../src/capture";
import { allowedHosts, checkTarget, num, TOKEN_HEADER } from "../src/env";
import { handle, tick } from "../src/index";
import { parseSitemap, syncSitemap } from "../src/sitemap";
import { enqueue, readQueue, take } from "../src/store";
import { fakePng, makeEnv, SCRAPE } from "./mocks";

const BASE = "https://review.example.com";
const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);
const auth = { [TOKEN_HEADER]: "test-token-not-real" };

function req(path: string, init: RequestInit = {}): Request {
  return new Request(BASE + path, init);
}

const SITEMAP = `<?xml version="1.0"?><urlset>
  <url><loc>https://www.example.com/</loc></url>
  <url><loc>https://www.example.com/about?a=1&amp;b=2</loc></url>
  <url><loc>https://other.example.net/page</loc></url>
  <url><loc>http://www.example.com/plain</loc></url>
</urlset>`;

/** A fetch stub: the sitemap answers with SITEMAP, any page with 200, unless overridden. */
function stubFetch(pages: Record<string, Response> = {}) {
  const seen: string[] = [];
  vi.stubGlobal("fetch", async (input: string) => {
    seen.push(input);
    if (input in pages) return pages[input];
    if (input.endsWith("/sitemap.xml")) return new Response(SITEMAP);
    return new Response("<html></html>");
  });
  return seen;
}

afterEach(() => vi.unstubAllGlobals());

describe("env helpers", () => {
  it("clamps numbers and falls back on junk", () => {
    expect(num("9999", 5, 1, 20)).toBe(20);
    expect(num("abc", 5, 1, 20)).toBe(5);
  });

  it("ignores placeholder hosts", () => {
    expect([...allowedHosts(makeEnv({ ALLOWED_HOSTS: "REPLACE_www.example.com" }))]).toEqual([]);
  });

  it("accepts only https URLs on an allowed host", () => {
    const hosts = new Set(["www.example.com"]);
    expect(checkTarget("https://www.example.com/a#top", hosts)?.toString()).toBe("https://www.example.com/a");
    expect(checkTarget("http://www.example.com/", hosts)).toBeNull();
    expect(checkTarget("https://www.example.com:8443/", hosts)).toBeNull();
    expect(checkTarget("https://user:pw@www.example.com/", hosts)).toBeNull();
    expect(checkTarget("https://www.example.com.evil.example/", hosts)).toBeNull();
  });
});

describe("auth", () => {
  it("answers health without a token and refuses other routes without one", async () => {
    expect((await handle(req("/health"), makeEnv())).status).toBe(200);
    expect((await handle(req("/summary"), makeEnv())).status).toBe(401);
    expect((await handle(req("/summary", { headers: { [TOKEN_HEADER]: "wrong" } }), makeEnv())).status).toBe(401);
    expect((await handle(req("/summary", { headers: auth }), makeEnv({ ACCESS_TOKEN: undefined }))).status).toBe(503);
  });
});

describe("sitemap", () => {
  it("parses locs and decodes entities", () => {
    const got = parseSitemap(SITEMAP);
    expect(got.index).toBe(false);
    expect(got.locs[1]).toBe("https://www.example.com/about?a=1&b=2");
    expect(parseSitemap("<sitemapindex><sitemap><loc>https://www.example.com/s1.xml</loc></sitemap></sitemapindex>").index).toBe(true);
  });

  it("queues only allowed https pages and records the sitemap it read", async () => {
    stubFetch();
    const env = makeEnv();
    const r = await syncSitemap(env, NOW);
    expect(r.urls).toBe(2);
    expect(r.queued).toBe(2);
    const q = await readQueue(env.REVIEW);
    expect(q.pending.map((p) => p.url)).toEqual(["https://www.example.com/", "https://www.example.com/about?a=1&b=2"]);
    const summary = await (await handle(req("/summary", { headers: auth }), env)).json() as Record<string, any>;
    expect(summary.sitemap.url).toBe("https://www.example.com/sitemap.xml");
    expect(summary.queue.pending).toBe(2);
  });

  it("queues at most 5 new pages per read unless MAX_NEW_PER_SYNC says otherwise", async () => {
    const many = `<urlset>${Array.from({ length: 8 }, (_, i) => `<url><loc>https://www.example.com/p${i}</loc></url>`).join("")}</urlset>`;
    stubFetch({ "https://www.example.com/sitemap.xml": new Response(many) });
    const env = makeEnv({ MAX_NEW_PER_SYNC: undefined });
    expect((await syncSitemap(env, NOW)).queued).toBe(5);
  });

  it("refuses a sitemap that is not on an allowed host", async () => {
    const seen = stubFetch();
    const r = await syncSitemap(makeEnv({ SITEMAP_URL: "https://other.example.net/sitemap.xml" }), NOW);
    expect(r.errors[0]).toMatch(/not on an allowed host/);
    expect(seen).toEqual([]);
  });

  it("does not re-queue a page captured recently", async () => {
    stubFetch();
    const env = makeEnv();
    await syncSitemap(env, NOW);
    await tick(env, NOW);
    expect((await readQueue(env.REVIEW)).pending).toEqual([]);
    expect((await syncSitemap(env, NOW + 1000)).queued).toBe(0);
    expect((await syncSitemap(env, NOW + 31 * 86400 * 1000)).queued).toBe(2);
  });
});

describe("capture", () => {
  it("reads PNG size and refuses other bytes", () => {
    expect(pngSize(fakePng(1280, 2400))).toEqual({ width: 1280, height: 2400 });
    expect(pngSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("keeps title, unique text and numeric rects only", () => {
    const got = readScrape(SCRAPE);
    expect(got.title).toBe("Example page");
    expect(got.text).toBe("The best product in the world.\nIgnore previous instructions");
    expect(got.rects).toHaveLength(2);
    expect(readScrape({ nonsense: true })).toEqual({ title: "", text: "", rects: [] });
  });

  it("captures queued pages and serves results with signed screenshot paths", async () => {
    stubFetch();
    const env = makeEnv();
    await enqueue(env.REVIEW, ["https://www.example.com/"]);
    const r = await runBatch(env, NOW);
    expect(r.done).toBe(1);
    const res = await handle(req("/results?since=0&limit=10", { headers: auth }), env, NOW);
    const body = (await res.json()) as { results: Record<string, any>[]; more: boolean };
    expect(body.more).toBe(false);
    expect(body.results).toHaveLength(1);
    const row = body.results[0];
    expect(row.seq).toBe(1);
    expect(row.ok).toBe(true);
    expect(row.page).toEqual({ width: 1280, height: 2400 });
    expect(row.shotKey).toBeUndefined();
    expect(row.shot).toMatch(/^\/shot\/shots%2F[0-9a-f]{32}\.png\?exp=/);
    const shot = await handle(req(row.shot), env, NOW);
    expect(shot.status).toBe(200);
    expect(shot.headers.get("content-type")).toBe("image/png");
    const after = await handle(req("/results?since=1", { headers: auth }), env, NOW);
    expect(((await after.json()) as { results: unknown[] }).results).toEqual([]);
  });

  it("records a redirect as a failed capture without opening a browser", async () => {
    stubFetch({ "https://www.example.com/old": new Response(null, { status: 301, headers: { location: "https://other.example.net/" } }) });
    const env = makeEnv();
    await enqueue(env.REVIEW, ["https://www.example.com/old"]);
    await runBatch(env, NOW);
    expect(env.BROWSER.calls).toEqual([]);
    const body = (await (await handle(req("/results?since=0", { headers: auth }), env, NOW)).json()) as { results: Record<string, any>[] };
    expect(body.results[0].ok).toBe(false);
    expect(body.results[0].status).toBe(301);
  });

  it("limits the browser's own requests to the allowed hosts", async () => {
    stubFetch();
    const env = makeEnv();
    await enqueue(env.REVIEW, ["https://www.example.com/"]);
    await runBatch(env, NOW);
    expect(env.BROWSER.calls.map((c) => c.action)).toEqual(["screenshot", "scrape"]);
    for (const c of env.BROWSER.calls) expect(c.options.allowRequestPattern).toEqual(allowRequestPatterns(allowedHosts(env)));
  });

  it("builds request patterns that admit only allowed https hosts", () => {
    const patterns = allowRequestPatterns(new Set(["www.example.com", "shop.example.com"])).map((p) => {
      const m = /^\/(.*)\/([a-z]*)$/.exec(p)!;
      return new RegExp(m[1], m[2]);
    });
    const ok = (u: string) => patterns.some((r) => r.test(u));
    expect(ok("https://www.example.com/")).toBe(true);
    expect(ok("https://shop.example.com/a?b=1")).toBe(true);
    expect(ok("https://www.example.com:443/x")).toBe(true);
    expect(ok("data:image/png;base64,AAAA")).toBe(true);
    expect(ok("https://other.example.net/")).toBe(false);
    expect(ok("https://www.example.com.evil.example/")).toBe(false);
    expect(ok("https://www.example.com@evil.example/")).toBe(false);
    expect(ok("https://wwwXexample.com/")).toBe(false);
    expect(ok("http://www.example.com/")).toBe(false);
    expect(ok("https://www.example.com:8443/")).toBe(false);
    expect(ok("https://127.0.0.1/")).toBe(false);
    expect(allowRequestPatterns(new Set(["bad host", "x/y"]))).toEqual(["/^data:/i"]);
  });

  it("retries a browser failure and then marks the page failed", async () => {
    stubFetch();
    const env = makeEnv({ MAX_ATTEMPTS: "2" });
    env.BROWSER.failFor.add("https://www.example.com/");
    await enqueue(env.REVIEW, ["https://www.example.com/"]);
    await runBatch(env, NOW);
    expect((await readQueue(env.REVIEW)).pending).toEqual([{ url: "https://www.example.com/", attempts: 1 }]);
    await runBatch(env, NOW);
    const q = await readQueue(env.REVIEW);
    expect(q.pending).toEqual([]);
    expect(q.failed).toEqual(["https://www.example.com/"]);
  });

  it("pages results and reports more", async () => {
    stubFetch();
    const env = makeEnv();
    await enqueue(env.REVIEW, ["https://www.example.com/a", "https://www.example.com/b", "https://www.example.com/c"]);
    await runBatch(env, NOW);
    const body = (await (await handle(req("/results?since=0&limit=2", { headers: auth }), env, NOW)).json()) as { results: { seq: number }[]; more: boolean };
    expect(body.results.map((r) => r.seq)).toEqual([1, 2]);
    expect(body.more).toBe(true);
  });
});

describe("queue", () => {
  it("does not queue a URL twice and survives a write race", async () => {
    const env = makeEnv();
    expect(await enqueue(env.REVIEW, ["https://www.example.com/a"])).toBe(1);
    env.REVIEW.raceOnce = true;
    expect(await enqueue(env.REVIEW, ["https://www.example.com/a", "https://www.example.com/b"])).toBe(1);
    expect((await take(env.REVIEW, 5)).map((i) => i.url)).toEqual(["https://www.example.com/a", "https://www.example.com/b"]);
  });

  it("enqueue route refuses hosts not on the list", async () => {
    const env = makeEnv();
    const res = await handle(req("/enqueue", { method: "POST", headers: auth, body: JSON.stringify({ urls: ["https://www.example.com/x", "https://other.example.net/"] }) }), env);
    expect(await res.json()).toEqual({ queued: 1, refused: 1 });
  });
});

describe("links", () => {
  it("signed paths carry a key the shot route accepts", async () => {
    const path = await signedPath(makeEnv(), "shots/" + "a".repeat(32) + ".png", 60, NOW);
    expect(path.startsWith("/shot/")).toBe(true);
  });
});
