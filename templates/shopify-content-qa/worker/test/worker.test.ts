import { afterEach, describe, expect, it, vi } from "vitest";
import { signedPath, verifyLink } from "../src/auth";
import { allowedHosts, checkTarget, num, TOKEN_HEADER } from "../src/env";
import { capture, handle } from "../src/index";
import { enqueue, readIndex, take } from "../src/store";
import { MemR2, MockAi, makeEnv } from "./mocks";

const BASE = "https://qa.example.workers.dev";
const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);
const auth = { [TOKEN_HEADER]: "test-token-not-real" };

function req(path: string, init: RequestInit = {}): Request {
  return new Request(BASE + path, init);
}

afterEach(() => vi.unstubAllGlobals());

describe("env helpers", () => {
  it("clamps numbers and falls back on junk", () => {
    expect(num("9999", 5, 1, 20)).toBe(20);
    expect(num("abc", 5, 1, 20)).toBe(5);
    expect(num(undefined, 5, 1, 20)).toBe(5);
  });

  it("ignores placeholder hosts", () => {
    expect([...allowedHosts(makeEnv({ ALLOWED_HOSTS: "REPLACE_your-store.com" }))]).toEqual([]);
  });

  it("accepts only https URLs on an allowed host", () => {
    const hosts = new Set(["your-store.com"]);
    expect(checkTarget("https://your-store.com/products/mug", hosts)?.toString()).toBe("https://your-store.com/products/mug");
    expect(checkTarget("http://your-store.com/", hosts)).toBeNull();
    expect(checkTarget("https://other.example/", hosts)).toBeNull();
    expect(checkTarget("https://your-store.com:8443/", hosts)).toBeNull();
    expect(checkTarget("https://user:pw@your-store.com/", hosts)).toBeNull();
    expect(checkTarget("https://your-store.com.evil.example/", hosts)).toBeNull();
    expect(checkTarget(42, hosts)).toBeNull();
  });
});

describe("auth", () => {
  it("answers health without a token", async () => {
    const res = await handle(req("/health"), makeEnv());
    expect(res.status).toBe(200);
  });

  it("refuses a missing or wrong token", async () => {
    expect((await handle(req("/shots"), makeEnv())).status).toBe(401);
    expect((await handle(req("/shots", { headers: { [TOKEN_HEADER]: "wrong" } }), makeEnv())).status).toBe(401);
  });

  it("returns 503 when no token is configured", async () => {
    expect((await handle(req("/shots", { headers: auth }), makeEnv({ ACCESS_TOKEN: undefined }))).status).toBe(503);
  });

  it("signed links verify until they expire and fail when tampered", async () => {
    const env = makeEnv();
    const path = await signedPath(env, "shots/abc.png", 60, NOW);
    const u = new URL(BASE + path);
    const exp = u.searchParams.get("exp");
    const sig = u.searchParams.get("sig");
    expect(await verifyLink(env, "shots/abc.png", exp, sig, NOW)).toBe(true);
    expect(await verifyLink(env, "shots/abc.png", exp, sig, NOW + 61_000)).toBe(false);
    expect(await verifyLink(env, "shots/other.png", exp, sig, NOW)).toBe(false);
    expect(await verifyLink(makeEnv({ ACCESS_TOKEN: "rotated" }), "shots/abc.png", exp, sig, NOW)).toBe(false);
  });
});

describe("fetch proxy", () => {
  it("fetches an allowed URL and passes status through", async () => {
    const spy = vi.fn(async () => new Response("<html></html>", { status: 404, headers: { "content-type": "text/html" } }));
    vi.stubGlobal("fetch", spy);
    const res = await handle(req("/fetch?url=" + encodeURIComponent("https://your-store.com/pages/about"), { headers: auth }), makeEnv());
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("<html></html>");
    expect(spy).toHaveBeenCalledOnce();
  });

  it("refuses a host that is not allowed without fetching", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const res = await handle(req("/fetch?url=" + encodeURIComponent("https://other.example/"), { headers: auth }), makeEnv());
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it("stops reading a body over 3 MB and cancels the upstream stream", async () => {
    const chunk = new Uint8Array(64 * 1024);
    let pulled = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        if (pulled > 64) controller.close();
        else controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream, { status: 200, headers: { "content-type": "text/html" } })));
    const res = await handle(req("/fetch?url=" + encodeURIComponent("https://your-store.com/big"), { headers: auth }), makeEnv());
    expect(res.status).toBe(502);
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThan(60);
  });

  it("returns redirects without following them", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 301, headers: { location: "https://other.example/" } })));
    const res = await handle(req("/fetch?url=" + encodeURIComponent("https://your-store.com/old"), { headers: auth }), makeEnv());
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://other.example/");
  });
});

describe("screenshot queue", () => {
  it("queues allowed URLs only, once each", async () => {
    const env = makeEnv();
    const body = JSON.stringify({ urls: ["https://your-store.com/a", "https://your-store.com/a", "https://other.example/b"] });
    const res = await handle(req("/enqueue", { method: "POST", headers: auth, body }), env);
    expect(await res.json()).toEqual({ queued: 1, refused: 1 });
    expect(await take(env.SHOTS, 10)).toEqual(["https://your-store.com/a"]);
  });

  it("rejects a body that is not a list", async () => {
    const res = await handle(req("/enqueue", { method: "POST", headers: auth, body: "{\"urls\": \"x\"}" }), makeEnv());
    expect(res.status).toBe(400);
  });

  it("retries a conditional write that lost a race", async () => {
    const bucket = new MemR2();
    await enqueue(bucket as unknown as R2Bucket, ["https://your-store.com/a"]);
    bucket.raceOnce = true;
    expect(await enqueue(bucket as unknown as R2Bucket, ["https://your-store.com/b"])).toBe(1);
    expect(await take(bucket as unknown as R2Bucket, 10)).toEqual(["https://your-store.com/a", "https://your-store.com/b"]);
  });

  it("does not overwrite a state file another writer created first", async () => {
    const bucket = new MemR2();
    bucket.beforePut = () => {
      bucket.items.set("state/queue.json", {
        data: new TextEncoder().encode(JSON.stringify({ pending: ["https://your-store.com/b"] })),
        etag: "other",
      });
    };
    await enqueue(bucket as unknown as R2Bucket, ["https://your-store.com/a"]);
    expect(await take(bucket as unknown as R2Bucket, 10)).toEqual(["https://your-store.com/b", "https://your-store.com/a"]);
  });

  it("captures queued pages on cron, stores them and serves a signed link", async () => {
    const env = makeEnv({ SHOTS_PER_CRON: "2" });
    await enqueue(env.SHOTS, ["https://your-store.com/a", "https://your-store.com/b", "https://your-store.com/c"]);
    env.BROWSER.failFor.add("https://your-store.com/b");
    expect(await capture(env, NOW)).toEqual({ done: 1, failed: 1 });
    expect(env.BROWSER.calls[0].action).toBe("screenshot");
    expect(await take(env.SHOTS, 10)).toEqual(["https://your-store.com/c"]);

    const listed = (await (await handle(req("/shots", { headers: auth }), env, NOW)).json()) as { shots: Record<string, string> };
    const link = listed.shots["https://your-store.com/a"];
    expect(link.startsWith(BASE + "/shot/")).toBe(true);
    const shot = await handle(new Request(link), env, NOW);
    expect(shot.status).toBe(200);
    expect(shot.headers.get("content-type")).toBe("image/png");
    expect((await handle(new Request(link), env, NOW + 3601_000)).status).toBe(403);
  });

  it("skips a queued URL whose host was removed from the allow-list", async () => {
    const env = makeEnv();
    await enqueue(env.SHOTS, ["https://your-store.com/a"]);
    env.ALLOWED_HOSTS = "example-store.myshopify.com";
    expect(await capture(env, NOW)).toEqual({ done: 0, failed: 1 });
    expect(env.BROWSER.calls).toHaveLength(0);
  });

  it("adds a vision note only when the check is on and AI is bound", async () => {
    const ai = new MockAi();
    const env = makeEnv({ VISION_CHECK: "on", AI: ai });
    await enqueue(env.SHOTS, ["https://your-store.com/a"]);
    await capture(env, NOW);
    expect(ai.calls).toHaveLength(1);
    expect((await readIndex(env.SHOTS))["https://your-store.com/a"].note).toBe("none");

    const off = makeEnv({ AI: ai });
    await enqueue(off.SHOTS, ["https://your-store.com/a"]);
    await capture(off, NOW);
    expect(ai.calls).toHaveLength(1);
  });
});

describe("signed shot route", () => {
  it("answers 404 for a malformed percent sequence", async () => {
    const res = await handle(req("/shot/shots%2F%E0%A4%A.png?exp=1&sig=x"), makeEnv());
    expect(res.status).toBe(404);
  });
});
