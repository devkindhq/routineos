// In-memory stand-ins for R2, Browser Run and Workers AI, enough for the Worker's own calls.
import type { Env } from "../src/env";

interface Item {
  data: Uint8Array;
  etag: string;
}

export class MemR2 {
  items = new Map<string, Item>();
  private n = 0;
  /** When set, the next conditional put fails once, as if another writer got there first. */
  raceOnce = false;
  /** When set, runs once at the start of the next put, as another writer acting between our get and put. */
  beforePut?: () => void;

  async get(key: string) {
    const item = this.items.get(key);
    if (!item) return null;
    const text = new TextDecoder().decode(item.data);
    return {
      etag: item.etag,
      body: new Response(item.data).body,
      json: async () => JSON.parse(text),
      text: async () => text,
    };
  }

  async put(key: string, value: string | ArrayBuffer, opts?: { onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } }) {
    const hook = this.beforePut;
    this.beforePut = undefined;
    hook?.();
    if (opts?.onlyIf?.etagDoesNotMatch === "*" && this.items.has(key)) return null;
    const match = opts?.onlyIf?.etagMatches;
    if (match !== undefined) {
      if (this.raceOnce) {
        this.raceOnce = false;
        return null;
      }
      if (this.items.get(key)?.etag !== match) return null;
    }
    const data = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
    const etag = `e${++this.n}`;
    this.items.set(key, { data, etag });
    return { key, etag };
  }
}

export class MockBrowser {
  calls: { action: string; options: Record<string, unknown> }[] = [];
  failFor = new Set<string>();

  async quickAction(action: string, options: Record<string, unknown>): Promise<Response> {
    this.calls.push({ action, options });
    if (this.failFor.has(String(options.url))) return new Response("no", { status: 500 });
    return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } });
  }
}

export class MockAi {
  calls: { model: string; input: Record<string, unknown> }[] = [];
  async run(model: string, input: Record<string, unknown>) {
    this.calls.push({ model, input });
    return { response: "none" };
  }
}

export function makeEnv(over: Partial<Env> = {}): Env & { SHOTS: MemR2 & R2Bucket; BROWSER: MockBrowser } {
  return {
    BROWSER: new MockBrowser(),
    SHOTS: new MemR2() as unknown as MemR2 & R2Bucket,
    ACCESS_TOKEN: "test-token-not-real",
    ALLOWED_HOSTS: "your-store.com, example-store.myshopify.com",
    SHOTS_PER_CRON: "5",
    LINK_TTL_SECONDS: "3600",
    VISION_CHECK: "off",
    ...over,
  } as Env & { SHOTS: MemR2 & R2Bucket; BROWSER: MockBrowser };
}
