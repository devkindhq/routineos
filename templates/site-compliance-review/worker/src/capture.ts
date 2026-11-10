// Page capture with Browser Run: a full-page screenshot plus the text and position of visible text
// elements, so the routine can draw a box where a flag's wording sits. The shapes of the Browser Run
// "screenshot" and "scrape" responses used here are taken from Cloudflare's docs and are unverified
// against a live account.
import { clefScore, QUESTIONS } from "./clef";
import { effectiveFlagAt } from "./config";
import { allowedHosts, checkTarget, clefImageOn, clefOn, num, USER_AGENT, type Env } from "./env";
import { nextSeq, recordBatch, retryOrFail, saveResult, take, type Result } from "./store";

const VIEWPORT = { width: 1280, height: 800, deviceScaleFactor: 1 };
const GOTO = { waitUntil: "networkidle2", timeout: 45000 };
const SELECTORS = ["title", "h1", "h2", "h3", "h4", "p", "li", "td", "th", "dt", "dd", "blockquote", "figcaption", "label", "button", "a", "small"];
const MAX_TEXT = 200_000;
const MAX_RECTS = 3000;

type Rect = Result["rects"][number];

/** Width and height from a PNG's IHDR chunk, or null when the bytes are not a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const magic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || magic.some((b, i) => bytes[i] !== b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

async function shotKey(url: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url));
  return `shots/${[...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("")}.png`;
}

/** Title, page text and element rects from a scrape response; anything unexpected is skipped. */
export function readScrape(body: unknown): { title: string; text: string; rects: Rect[] } {
  const groups = (body as { result?: unknown })?.result;
  let title = "";
  const lines: string[] = [];
  const seen = new Set<string>();
  const rects: Rect[] = [];
  if (!Array.isArray(groups)) return { title, text: "", rects };
  for (const g of groups) {
    const selector = (g as { selector?: unknown })?.selector;
    const items = (g as { results?: unknown })?.results;
    if (!Array.isArray(items)) continue;
    for (const it of items) {
      const text = typeof it?.text === "string" ? it.text.replace(/\s+/g, " ").trim() : "";
      if (!text) continue;
      if (selector === "title") {
        title ||= text.slice(0, 300);
        continue;
      }
      if (!seen.has(text)) {
        seen.add(text);
        lines.push(text);
      }
      const box = ["left", "top", "width", "height"].map((k) => it?.[k]);
      if (rects.length < MAX_RECTS && box.every((v) => typeof v === "number" && Number.isFinite(v))) {
        rects.push({ text: text.slice(0, 2000), left: box[0], top: box[1], width: box[2], height: box[3] });
      }
    }
  }
  return { title, text: lines.join("\n").slice(0, MAX_TEXT), rects };
}

/**
 * Request patterns for Browser Run's allowRequestPattern: only https requests to an allowed host (default port,
 * no credentials) and data: URLs may load. The status probe below cannot vouch for what the browser later
 * navigates to, so a redirect or script that points the browser at another host is blocked here instead.
 * Each entry is a "/regex/" string.
 */
export function allowRequestPatterns(hosts: Set<string>): string[] {
  const names = [...hosts].filter((h) => /^[a-z0-9.-]+$/.test(h)).map((h) => h.replace(/\./g, "\\."));
  const data = "/^data:/i";
  return names.length ? [`/^https:\\/\\/(${names.join("|")})(:443)?([\\/?#]|$)/i`, data] : [data];
}

/** Status of the page itself, without following redirects; a redirect counts as a failed capture. */
async function pageStatus(url: string): Promise<{ status: number; error: string }> {
  const res = await fetch(url, { method: "GET", headers: { "user-agent": USER_AGENT }, redirect: "manual" });
  await res.body?.cancel();
  if (res.status >= 300 && res.status < 400) return { status: res.status, error: "page redirects; list its final URL in the sitemap" };
  if (!res.ok) return { status: res.status, error: `page answered ${res.status}` };
  return { status: res.status, error: "" };
}

/** Captures one page. Throws on a transient Browser Run failure so the caller can retry. */
export async function captureOne(env: Env, url: string, now: number): Promise<Result> {
  const allowRequestPattern = allowRequestPatterns(allowedHosts(env));
  const base: Omit<Result, "seq"> = {
    url, ok: false, status: null, title: "", capturedAt: new Date(now).toISOString(),
    error: "", text: "", rects: [], page: null, shotKey: "", clef: null,
  };
  const head = await pageStatus(url);
  base.status = head.status;
  if (head.error) return { ...base, seq: await nextSeq(env.REVIEW), error: head.error };

  const shot = await env.BROWSER.quickAction("screenshot", {
    url, viewport: VIEWPORT, gotoOptions: GOTO, allowRequestPattern, screenshotOptions: { fullPage: true, type: "png" },
  });
  if (!shot.ok) throw new Error(`screenshot failed with status ${shot.status}`);
  const image = new Uint8Array(await shot.arrayBuffer());
  const page = pngSize(image);
  if (!page) throw new Error("screenshot was not a PNG");

  const scrape = await env.BROWSER.quickAction("scrape", {
    url, viewport: VIEWPORT, gotoOptions: GOTO, allowRequestPattern, elements: SELECTORS.map((selector) => ({ selector })),
  });
  if (!scrape.ok) throw new Error(`scrape failed with status ${scrape.status}`);
  const read = readScrape(await scrape.json());

  const key = await shotKey(url);
  await env.REVIEW.put(key, image, { httpMetadata: { contentType: "image/png" } });
  // One Clef call per capture, after the browser work so a Clef failure never retries the capture.
  const clef = clefOn(env)
    ? await clefScore(env, `Title: ${read.title}\n\n${read.text}`, clefImageOn(env) ? image : undefined, QUESTIONS, (await effectiveFlagAt(env)).value)
    : null;
  if (clef) {
    console.log(JSON.stringify({
      clef: "usage", model: clef.model, inputTokens: clef.inputTokens ?? null, outputTokens: clef.outputTokens ?? null,
      scored: Object.keys(clef.scores).length, imageSent: clef.imageSent ?? false, imageSkipped: clef.imageSkipped ?? null,
      error: clef.error ?? null,
    }));
  }
  return { ...base, ...read, ok: true, page, shotKey: key, clef, seq: await nextSeq(env.REVIEW) };
}

/** Captures up to BATCH_SIZE queued pages. A failure is retried on later batches up to MAX_ATTEMPTS. */
export async function runBatch(env: Env, now: number): Promise<{ done: number; retried: number }> {
  const hosts = allowedHosts(env);
  const items = await take(env.REVIEW, num(env.BATCH_SIZE, 5, 1, 20));
  const maxAttempts = num(env.MAX_ATTEMPTS, 3, 1, 10);
  let done = 0;
  let retried = 0;
  const usage = { calls: 0, errors: 0, inputTokens: 0, outputTokens: 0 };
  for (const item of items) {
    if (!checkTarget(item.url, hosts)) continue;
    try {
      const result = await captureOne(env, item.url, now);
      await saveResult(env.REVIEW, result);
      done++;
      if (result.clef) {
        usage.calls++;
        if (result.clef.error) usage.errors++;
        usage.inputTokens += result.clef.inputTokens ?? 0;
        usage.outputTokens += result.clef.outputTokens ?? 0;
      }
    } catch (e) {
      console.log(`capture failed: ${e instanceof Error ? e.message : "unknown"}`);
      await retryOrFail(env.REVIEW, item, maxAttempts);
      retried++;
    }
  }
  if (items.length) await recordBatch(env.REVIEW, new Date(now).toISOString(), usage);
  return { done, retried };
}
