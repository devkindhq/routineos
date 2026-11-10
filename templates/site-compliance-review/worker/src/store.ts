// R2 state: the capture queue, the page index, the counters, and one JSON object per capture result.
// Every shared object is updated with an etag check, so two runs never overwrite each other.
import type { ClefResult } from "./clef";

const QUEUE = "state/queue.json";
const PAGES = "state/pages.json";
const META = "state/meta.json";
const MAX_QUEUE = 2000;
const MAX_FAILED = 200;

export interface QueueItem {
  url: string;
  attempts: number;
}

export interface Queue {
  pending: QueueItem[];
  failed: string[];
}

export interface PageEntry {
  seq: number;
  capturedAt: string;
}

export interface Meta {
  seq: number;
  lastBatchAt?: string;
  sitemap?: { url: string; lastRefreshAt: string; errors: string[]; urls: number };
  /** Running Clef totals since the Worker was first deployed. */
  clef?: { calls: number; errors: number; inputTokens: number; outputTokens: number };
}

export interface Result {
  seq: number;
  url: string;
  ok: boolean;
  status: number | null;
  title: string;
  capturedAt: string;
  error: string;
  text: string;
  rects: { text: string; left: number; top: number; width: number; height: number }[];
  page: { width: number; height: number } | null;
  shotKey: string;
  /** Clef scores for this capture; null when USE_CLEF is off or the capture did not load. */
  clef: ClefResult | null;
}

async function read<T>(bucket: R2Bucket, path: string, empty: T): Promise<T> {
  const obj = await bucket.get(path);
  return obj ? ((await obj.json()) as T) : empty;
}

export async function update<T>(bucket: R2Bucket, path: string, empty: T, change: (cur: T) => T): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const obj = await bucket.get(path);
    const cur = obj ? ((await obj.json()) as T) : empty;
    const next = change(cur);
    const opts: R2PutOptions = { httpMetadata: { contentType: "application/json" } };
    // The first write is create-only, so a writer that created the file meanwhile is not overwritten.
    opts.onlyIf = obj ? { etagMatches: obj.etag } : { etagDoesNotMatch: "*" };
    const put = await bucket.put(path, JSON.stringify(next), opts);
    if (put) return next;
  }
  throw new Error("state changed under five attempts in a row");
}

const emptyQueue = (): Queue => ({ pending: [], failed: [] });

export const readQueue = (bucket: R2Bucket) => read<Queue>(bucket, QUEUE, emptyQueue());
export const readPages = (bucket: R2Bucket) => read<Record<string, PageEntry>>(bucket, PAGES, {});
export const readMeta = (bucket: R2Bucket) => read<Meta>(bucket, META, { seq: 0 });

/** Adds URLs not already queued; returns how many were added. The queue never holds more than MAX_QUEUE. */
export async function enqueue(bucket: R2Bucket, urls: string[]): Promise<number> {
  let added = 0;
  await update<Queue>(bucket, QUEUE, emptyQueue(), (cur) => {
    added = 0;
    const pending = [...cur.pending];
    const seen = new Set(pending.map((p) => p.url));
    for (const u of urls) {
      if (pending.length >= MAX_QUEUE) break;
      if (!seen.has(u)) {
        pending.push({ url: u, attempts: 0 });
        seen.add(u);
        added++;
      }
    }
    return { pending, failed: cur.failed.filter((f) => !seen.has(f)) };
  });
  return added;
}

/** Removes and returns up to n items from the front of the queue. */
export async function take(bucket: R2Bucket, n: number): Promise<QueueItem[]> {
  let taken: QueueItem[] = [];
  await update<Queue>(bucket, QUEUE, emptyQueue(), (cur) => {
    taken = cur.pending.slice(0, n);
    return { pending: cur.pending.slice(n), failed: cur.failed };
  });
  return taken;
}

/** Puts a failed item back at the end of the queue, or into `failed` after maxAttempts. */
export async function retryOrFail(bucket: R2Bucket, item: QueueItem, maxAttempts: number): Promise<void> {
  await update<Queue>(bucket, QUEUE, emptyQueue(), (cur) => {
    const attempts = item.attempts + 1;
    if (attempts < maxAttempts) return { pending: [...cur.pending, { url: item.url, attempts }], failed: cur.failed };
    const failed = cur.failed.includes(item.url) ? cur.failed : [...cur.failed, item.url].slice(-MAX_FAILED);
    return { pending: cur.pending, failed };
  });
}

/** Takes the next capture number. */
export async function nextSeq(bucket: R2Bucket): Promise<number> {
  const meta = await update<Meta>(bucket, META, { seq: 0 }, (cur) => ({ ...cur, seq: cur.seq + 1 }));
  return meta.seq;
}

export async function setMeta(bucket: R2Bucket, patch: Partial<Meta>): Promise<void> {
  await update<Meta>(bucket, META, { seq: 0 }, (cur) => ({ ...cur, ...patch }));
}

export type ClefUsage = NonNullable<Meta["clef"]>;

/** Marks a batch run and adds its Clef usage to the running totals. */
export async function recordBatch(bucket: R2Bucket, at: string, usage: ClefUsage): Promise<void> {
  await update<Meta>(bucket, META, { seq: 0 }, (cur) => {
    const prev = cur.clef ?? { calls: 0, errors: 0, inputTokens: 0, outputTokens: 0 };
    return {
      ...cur, lastBatchAt: at,
      clef: {
        calls: prev.calls + usage.calls, errors: prev.errors + usage.errors,
        inputTokens: prev.inputTokens + usage.inputTokens, outputTokens: prev.outputTokens + usage.outputTokens,
      },
    };
  });
}

export function resultKey(seq: number): string {
  return `results/${String(seq).padStart(10, "0")}.json`;
}

/** Stores one capture result and records it in the page index. */
export async function saveResult(bucket: R2Bucket, result: Result): Promise<void> {
  await bucket.put(resultKey(result.seq), JSON.stringify(result), { httpMetadata: { contentType: "application/json" } });
  await update<Record<string, PageEntry>>(bucket, PAGES, {}, (cur) => ({
    ...cur,
    [result.url]: { seq: result.seq, capturedAt: result.capturedAt },
  }));
}

/** Results with seq above `since`, oldest first, at most `limit`, and whether more remain. */
export async function listResults(bucket: R2Bucket, since: number, limit: number): Promise<{ results: Result[]; more: boolean }> {
  const listed = await bucket.list({ prefix: "results/", startAfter: resultKey(since), limit: limit + 1 });
  const keys = listed.objects.map((o) => o.key).sort();
  const results: Result[] = [];
  for (const key of keys.slice(0, limit)) {
    const obj = await bucket.get(key);
    if (obj) results.push((await obj.json()) as Result);
  }
  return { results, more: keys.length > limit || listed.truncated };
}
