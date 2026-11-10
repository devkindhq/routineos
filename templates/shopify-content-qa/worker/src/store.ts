// R2 state: the capture queue and the screenshot index, each one JSON object with etag-checked updates.
const QUEUE = "state/queue.json";
const INDEX = "state/shots.json";
const MAX_QUEUE = 500;

export interface ShotEntry {
  key: string;
  at: string;
  note?: string;
}

async function update<T>(bucket: R2Bucket, path: string, empty: T, change: (cur: T) => T): Promise<T> {
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

/** Adds URLs not already queued; returns how many were added. The queue never holds more than 500. */
export async function enqueue(bucket: R2Bucket, urls: string[]): Promise<number> {
  let added = 0;
  await update<{ pending: string[] }>(bucket, QUEUE, { pending: [] }, (cur) => {
    added = 0;
    const pending = [...cur.pending];
    for (const u of urls) {
      if (pending.length >= MAX_QUEUE) break;
      if (!pending.includes(u)) {
        pending.push(u);
        added++;
      }
    }
    return { pending };
  });
  return added;
}

/** Removes and returns up to n URLs from the front of the queue. */
export async function take(bucket: R2Bucket, n: number): Promise<string[]> {
  let taken: string[] = [];
  await update<{ pending: string[] }>(bucket, QUEUE, { pending: [] }, (cur) => {
    taken = cur.pending.slice(0, n);
    return { pending: cur.pending.slice(n) };
  });
  return taken;
}

export async function readIndex(bucket: R2Bucket): Promise<Record<string, ShotEntry>> {
  const obj = await bucket.get(INDEX);
  return obj ? ((await obj.json()) as Record<string, ShotEntry>) : {};
}

export async function record(bucket: R2Bucket, url: string, entry: ShotEntry): Promise<void> {
  await update<Record<string, ShotEntry>>(bucket, INDEX, {}, (cur) => ({ ...cur, [url]: entry }));
}
