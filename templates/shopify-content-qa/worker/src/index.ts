// Content QA Worker: an allow-listed fetch proxy, a screenshot queue run on cron, and signed screenshot links.
// Routes: GET /health (open), GET /fetch?url= , POST /enqueue {urls}, GET /shots (token header),
// GET /shot/<key>?exp=&sig= (signed link, no token). Only hosts in ALLOWED_HOSTS are ever fetched.
import { signedPath, tokenOk, verifyLink } from "./auth";
import { allowedHosts, checkTarget, num, USER_AGENT, type Env } from "./env";
import { enqueue, readIndex, record, take } from "./store";

const MAX_FETCH_BYTES = 3 * 1024 * 1024;
const DEFAULT_VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function shotKey(url: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url));
  return `shots/${[...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("")}.png`;
}

/** Reads a body up to max bytes; past that it cancels the stream and returns null. */
async function readCapped(stream: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array | null> {
  if (!stream) return new Uint8Array(0);
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

async function proxy(request: Request, env: Env): Promise<Response> {
  const target = checkTarget(new URL(request.url).searchParams.get("url"), allowedHosts(env));
  if (!target) return json({ error: "url must be https on an allowed host" }, 400);
  const upstream = await fetch(target.toString(), { headers: { "user-agent": USER_AGENT }, redirect: "manual" });
  if (upstream.status >= 300 && upstream.status < 400) {
    // Redirects are returned, not followed, so the caller applies its own host check.
    return new Response(null, { status: upstream.status, headers: { location: upstream.headers.get("location") ?? "" } });
  }
  const body = await readCapped(upstream.body, MAX_FETCH_BYTES);
  if (!body) return json({ error: "too large" }, 502);
  const type = upstream.headers.get("content-type") ?? "application/octet-stream";
  const headers: Record<string, string> = { "content-type": type };
  const retry = upstream.headers.get("retry-after");
  if (retry) headers["retry-after"] = retry;
  return new Response(body, { status: upstream.status, headers });
}

async function queueShots(request: Request, env: Env): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "body must be JSON" }, 400);
  }
  const raw = (body as { urls?: unknown })?.urls;
  if (!Array.isArray(raw) || raw.length > 50) return json({ error: "urls must be a list of at most 50" }, 400);
  const hosts = allowedHosts(env);
  const urls = raw.map((u) => checkTarget(u, hosts)).filter((u): u is URL => !!u).map((u) => u.toString());
  const queued = await enqueue(env.SHOTS, urls);
  return json({ queued, refused: raw.length - urls.length });
}

async function listShots(request: Request, env: Env, now: number): Promise<Response> {
  const ttl = num(env.LINK_TTL_SECONDS, 86400, 300, 7 * 86400);
  const origin = new URL(request.url).origin;
  const index = await readIndex(env.SHOTS);
  const shots: Record<string, string> = {};
  const notes: Record<string, string> = {};
  for (const [url, entry] of Object.entries(index)) {
    shots[url] = origin + (await signedPath(env, entry.key, ttl, now));
    if (entry.note) notes[url] = entry.note;
  }
  return json({ shots, notes, ttlSeconds: ttl });
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
  const obj = await env.SHOTS.get(key);
  if (!obj) return json({ error: "not found" }, 404);
  return new Response(obj.body, { headers: { "content-type": "image/png", "cache-control": "private, max-age=300" } });
}

async function visionNote(env: Env, image: ArrayBuffer): Promise<string | undefined> {
  if (env.VISION_CHECK !== "on" || !env.AI) return undefined;
  try {
    const out = (await env.AI.run(env.VISION_MODEL || DEFAULT_VISION_MODEL, {
      image: [...new Uint8Array(image)],
      prompt: "List visible layout problems on this store page in under 40 words: broken images, overlapping text, empty sections. Say none if there are none.",
      max_tokens: 120,
    })) as { response?: unknown; description?: unknown };
    const text = typeof out?.response === "string" ? out.response : typeof out?.description === "string" ? out.description : "";
    return text.trim().slice(0, 300) || undefined;
  } catch {
    return undefined;
  }
}

/** Captures up to SHOTS_PER_CRON queued pages. A failed capture is dropped, not retried, and logged by status only. */
export async function capture(env: Env, now: number): Promise<{ done: number; failed: number }> {
  const hosts = allowedHosts(env);
  const urls = await take(env.SHOTS, num(env.SHOTS_PER_CRON, 5, 1, 20));
  let done = 0;
  let failed = 0;
  for (const u of urls) {
    if (!checkTarget(u, hosts)) {
      failed++;
      continue;
    }
    try {
      const res = await env.BROWSER.quickAction("screenshot", {
        url: u,
        screenshotOptions: { fullPage: true, type: "png" },
        gotoOptions: { waitUntil: "networkidle2", timeout: 45000 },
      });
      if (!res.ok) {
        console.log(`capture failed with status ${res.status}`);
        failed++;
        continue;
      }
      const image = await res.arrayBuffer();
      const key = await shotKey(u);
      await env.SHOTS.put(key, image, { httpMetadata: { contentType: "image/png" } });
      await record(env.SHOTS, u, { key, at: new Date(now).toISOString(), note: await visionNote(env, image) });
      done++;
    } catch {
      console.log("capture failed");
      failed++;
    }
  }
  return { done, failed };
}

export async function handle(request: Request, env: Env, now = Date.now()): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/health") return json({ ok: true });
  if (url.pathname.startsWith("/shot/") && request.method === "GET") return serveShot(request, env, now);
  if (!env.ACCESS_TOKEN) return json({ error: "ACCESS_TOKEN is not set" }, 503);
  if (!tokenOk(request, env)) return json({ error: "unauthorised" }, 401);
  if (url.pathname === "/fetch" && request.method === "GET") return proxy(request, env);
  if (url.pathname === "/enqueue" && request.method === "POST") return queueShots(request, env);
  if (url.pathname === "/shots" && request.method === "GET") return listShots(request, env, now);
  return json({ error: "not found" }, 404);
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env);
  },
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(capture(env, Date.now()).then((r) => console.log(`captured ${r.done}, failed ${r.failed}`)));
  },
} satisfies ExportedHandler<Env>;
