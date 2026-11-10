// Site review Worker: reads the sitemap daily, captures queued pages on cron (screenshot plus text
// positions), and serves the results to the routine. It never changes the site.
// Routes: GET /health (open), GET /shot/<key>?exp=&sig= (signed link, no token), and with the token
// header: GET /summary, GET /results?since=&limit=, POST /enqueue {urls}, POST /config {clefFlagAt}. Clef scores ride on each result.
import { effectiveFlagAt, validFlagAt, writeConfig } from "./config";
import { signedPath, tokenOk, verifyLink } from "./auth";
import { runBatch } from "./capture";
import { QUESTIONS } from "./clef";
import { allowedHosts, checkTarget, clefImageOn, clefModel, clefOn, num, type Env } from "./env";
import { syncSitemap, sitemapDue } from "./sitemap";
import { enqueue, listResults, readMeta, readQueue } from "./store";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

async function summary(env: Env): Promise<Response> {
  const [meta, queue, flagAt] = await Promise.all([readMeta(env.REVIEW), readQueue(env.REVIEW), effectiveFlagAt(env)]);
  return json({
    sitemap: meta.sitemap ?? null,
    queue: { pending: queue.pending.length, failed: queue.failed.length, failedUrls: queue.failed.slice(0, 20) },
    lastBatchAt: meta.lastBatchAt ?? null,
    lastSeq: meta.seq,
    clef: {
      on: clefOn(env), model: clefModel(env), flagAt: flagAt.value, flagAtSource: flagAt.source, image: clefImageOn(env),
      rules: QUESTIONS.map((q) => q.id),
      ...(meta.clef ?? { calls: 0, errors: 0, inputTokens: 0, outputTokens: 0 }),
    },
  });
}

/** POST /config {clefFlagAt}: a number above 0 and up to 1, kept for later captures. */
async function setConfig(request: Request, env: Env): Promise<Response> {
  const n = ((await readBody(request)) as { clefFlagAt?: unknown } | undefined)?.clefFlagAt;
  if (!validFlagAt(n)) return json({ error: "clefFlagAt must be a number above 0 and up to 1" }, 400);
  const saved = await writeConfig(env, { clefFlagAt: n });
  return json({ clefFlagAt: saved.clefFlagAt, source: "config" });
}

async function results(request: Request, env: Env, now: number): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const since = Number.parseInt(q.get("since") ?? "0", 10);
  if (!Number.isInteger(since) || since < 0) return json({ error: "since must be a whole number" }, 400);
  const limit = num(q.get("limit") ?? undefined, 100, 1, 100);
  const ttl = num(env.LINK_TTL_SECONDS, 86400, 300, 7 * 86400);
  const got = await listResults(env.REVIEW, since, limit);
  const rows = [];
  for (const r of got.results) {
    const { shotKey, ...rest } = r;
    rows.push({ ...rest, shot: shotKey ? await signedPath(env, shotKey, ttl, now) : "" });
  }
  return json({ results: rows, more: got.more });
}

async function queuePages(request: Request, env: Env): Promise<Response> {
  const raw = ((await readBody(request)) as { urls?: unknown } | undefined)?.urls;
  if (!Array.isArray(raw) || raw.length > 50) return json({ error: "urls must be a list of at most 50" }, 400);
  const hosts = allowedHosts(env);
  const urls = raw.map((u) => checkTarget(u, hosts)).filter((u): u is URL => !!u).map((u) => u.toString());
  const queued = await enqueue(env.REVIEW, urls);
  return json({ queued, refused: raw.length - urls.length });
}

async function serveShot(request: Request, env: Env, now: number): Promise<Response> {
  const url = new URL(request.url);
  let key: string;
  try {
    key = decodeURIComponent(url.pathname.slice("/shot/".length));
  } catch {
    return json({ error: "not found" }, 404);
  }
  if (!/^shots\/[0-9a-f]{32}\.png$/.test(key)) return json({ error: "not found" }, 404);
  if (!(await verifyLink(env, key, url.searchParams.get("exp"), url.searchParams.get("sig"), now))) {
    return json({ error: "link expired or invalid" }, 403);
  }
  const obj = await env.REVIEW.get(key);
  if (!obj) return json({ error: "not found" }, 404);
  return new Response(obj.body, { headers: { "content-type": "image/png", "cache-control": "private, max-age=300" } });
}

export async function handle(request: Request, env: Env, now = Date.now()): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/health") return json({ ok: true });
  if (url.pathname.startsWith("/shot/") && request.method === "GET") return serveShot(request, env, now);
  if (!env.ACCESS_TOKEN) return json({ error: "ACCESS_TOKEN is not set" }, 503);
  if (!tokenOk(request, env)) return json({ error: "unauthorised" }, 401);
  if (url.pathname === "/summary" && request.method === "GET") return summary(env);
  if (url.pathname === "/results" && request.method === "GET") return results(request, env, now);
  if (url.pathname === "/config" && request.method === "POST") return setConfig(request, env);
  if (url.pathname === "/enqueue" && request.method === "POST") return queuePages(request, env);
  return json({ error: "not found" }, 404);
}

/** One cron tick: read the sitemap when a day has passed, then capture one batch. */
export async function tick(env: Env, now: number): Promise<{ synced: boolean; done: number; retried: number }> {
  let synced = false;
  if (await sitemapDue(env, now)) {
    await syncSitemap(env, now);
    synced = true;
  }
  const batch = await runBatch(env, now);
  return { synced, ...batch };
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env);
  },
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(tick(env, Date.now()).then((r) => console.log(`sitemap ${r.synced ? "read" : "skipped"}, captured ${r.done}, retried ${r.retried}`)));
  },
} satisfies ExportedHandler<Env>;
