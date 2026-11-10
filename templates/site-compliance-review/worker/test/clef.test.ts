import { afterEach, describe, expect, it, vi } from "vitest";
import { runBatch } from "../src/capture";
import {
  bodyModel, buildClefInput, clefScore, MAX_IMAGE_BYTES, MAX_QUESTIONS, MAX_STATE_CHARS, QUESTIONS, readQuestions, toBase64,
} from "../src/clef";
import { clefFlagAt, clefImageOn, clefModel, clefOn, DEFAULT_CLEF_MODEL, TOKEN_HEADER } from "../src/env";
import { handle, tick } from "../src/index";
import { enqueue, readMeta } from "../src/store";
import pack from "../../lib/rules.json";
import { MockAi, makeEnv } from "./mocks";

const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);
const auth = { [TOKEN_HEADER]: "test-token-not-real" };
const get = (env: ReturnType<typeof makeEnv>, path: string) =>
  handle(new Request("https://review.example.com" + path, { headers: auth }), env, NOW);

function stubSite() {
  vi.stubGlobal("fetch", async (input: string) => {
    if (input.endsWith("/sitemap.xml")) {
      return new Response(`<urlset><url><loc>https://www.example.com/</loc></url><url><loc>https://www.example.com/b</loc></url></urlset>`);
    }
    return new Response("<html></html>");
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("clef vars", () => {
  it("is off unless USE_CLEF is true, and image is off unless CLEF_IMAGE is true", () => {
    expect(clefOn(makeEnv())).toBe(false);
    expect(clefOn(makeEnv({ USE_CLEF: "TRUE" }))).toBe(true);
    expect(clefImageOn(makeEnv())).toBe(false);
    expect(clefImageOn(makeEnv({ CLEF_IMAGE: "yes" }))).toBe(false);
    expect(clefImageOn(makeEnv({ CLEF_IMAGE: "true" }))).toBe(true);
  });

  it("flag line defaults to 0.7 and accepts only (0, 1]", () => {
    expect(clefFlagAt(makeEnv())).toBe(0.7);
    expect(clefFlagAt(makeEnv({ CLEF_FLAG_AT: "0.85" }))).toBe(0.85);
    expect(clefFlagAt(makeEnv({ CLEF_FLAG_AT: "1" }))).toBe(1);
    for (const v of ["", "abc", "0", "-1", "1.5"]) expect(clefFlagAt(makeEnv({ CLEF_FLAG_AT: v })), v).toBe(0.7);
  });

  it("model defaults to clef-flash and ignores a placeholder", () => {
    expect(clefModel(makeEnv())).toBe(DEFAULT_CLEF_MODEL);
    expect(DEFAULT_CLEF_MODEL).toBe("@cf/cloudflare/clef-flash");
    expect(clefModel(makeEnv({ CLEF_MODEL: "REPLACE_model" }))).toBe(DEFAULT_CLEF_MODEL);
    expect(clefModel(makeEnv({ CLEF_MODEL: "@cf/other/model" }))).toBe("@cf/other/model");
    expect(bodyModel("@cf/cloudflare/clef-flash")).toBe("clef-flash");
  });
});

describe("questions", () => {
  it("bundles every enabled rule of lib/rules.json, drafts included", () => {
    const enabled = (pack as { rules: { id: string; enabled: boolean }[] }).rules.filter((r) => r.enabled).map((r) => r.id);
    expect(QUESTIONS.map((q) => q.id)).toEqual(enabled);
    expect(QUESTIONS.map((q) => q.id)).toContain("absolute_claim");
  });

  it("skips disabled rules and bad ids, and caps at 64", () => {
    const rules = [
      { id: "ok_rule", enabled: true, label: "OK", question: "Q?" },
      { id: "off_rule", enabled: false, label: "Off", question: "Q?" },
      { id: "Bad Id", enabled: true, label: "Bad", question: "Q?" },
      ...Array.from({ length: 80 }, (_, i) => ({ id: `rule_${i}`, enabled: true, label: `R${i}`, question: "" })),
    ];
    const qs = readQuestions({ rules });
    expect(qs).toHaveLength(MAX_QUESTIONS);
    expect(qs[0]).toEqual({ id: "ok_rule", label: "OK", question: "Q?" });
    expect(qs.map((q) => q.id)).not.toContain("off_rule");
    expect(readQuestions(null)).toEqual([]);
  });
});

describe("buildClefInput", () => {
  const qs = [{ id: "rule_a", label: "Rule A", question: "Is it A?" }];

  it("asks one noul question per rule and caps the text", () => {
    const inp = buildClefInput(DEFAULT_CLEF_MODEL, "a".repeat(MAX_STATE_CHARS + 500), qs);
    expect(inp.model).toBe("clef-flash");
    expect(inp.state.length).toBe(MAX_STATE_CHARS);
    expect(inp.questions.rule_a.type).toBe("noul");
    expect(inp.questions.rule_a.instructions).toContain("Rule A");
    expect(inp.questions.rule_a.instructions).toContain("Is it A?");
  });

  it("caps questions at 64", () => {
    const many = Array.from({ length: 70 }, (_, i) => ({ id: `rule_${i}`, label: `R${i}`, question: "" }));
    expect(Object.keys(buildClefInput(DEFAULT_CLEF_MODEL, "x", many).questions)).toHaveLength(MAX_QUESTIONS);
  });

  it("sends an image only when given one, in the documented shape", () => {
    expect("images" in buildClefInput(DEFAULT_CLEF_MODEL, "x", qs)).toBe(false);
    expect(buildClefInput(DEFAULT_CLEF_MODEL, "x", qs).questions.rule_a.instructions).not.toMatch(/screenshot/);
    const inp = buildClefInput(DEFAULT_CLEF_MODEL, "x", qs, "QUJD");
    expect(inp.images).toEqual([{ content_type: "image/png", base64: "QUJD" }]);
    expect(inp.questions.rule_a.instructions).toMatch(/screenshot/);
  });

  it("encodes base64 across chunk boundaries", () => {
    expect(toBase64(new Uint8Array([65, 66, 67]))).toBe("QUJD");
    const big = new Uint8Array(100_000).map((_, i) => i % 251);
    expect(toBase64(big)).toBe(Buffer.from(big).toString("base64"));
  });
});

describe("clefScore", () => {
  it("makes one call, keeps in-range scores for asked rules, and reports usage", async () => {
    const ai = new MockAi();
    ai.scores = { unsubstantiated_superlative: 0.92 };
    const env = makeEnv({ USE_CLEF: "true", AI: ai });
    const out = await clefScore(env, "page text");
    expect(ai.calls).toHaveLength(1);
    expect(ai.calls[0].model).toBe(DEFAULT_CLEF_MODEL);
    expect(out.error).toBeUndefined();
    expect(out.scores.unsubstantiated_superlative).toBe(0.92);
    expect(Object.keys(out.scores).sort()).toEqual(QUESTIONS.map((q) => q.id).sort());
    expect(out).toMatchObject({ flagAt: 0.7, inputTokens: 120, outputTokens: 7, imageSent: false });
  });

  it("drops unknown ids and out-of-range values", async () => {
    const ai = new MockAi();
    ai.reply = { answers: { rule_a: { noul: 0.5 }, rule_b: { noul: 1.7 }, other: { noul: 0.9 } } };
    const qs = [{ id: "rule_a", label: "A", question: "" }, { id: "rule_b", label: "B", question: "" }];
    const out = await clefScore(makeEnv({ AI: ai }), "x", undefined, qs);
    expect(out.scores).toEqual({ rule_a: 0.5 });
  });

  it("reports an error, never an empty all-clear, when the model fails or answers nothing", async () => {
    const ai = new MockAi();
    ai.fail = "model unavailable";
    expect(await clefScore(makeEnv({ AI: ai }), "x")).toMatchObject({ scores: {}, error: "model unavailable" });
    const empty = new MockAi();
    empty.reply = { answers: {} };
    expect(await clefScore(makeEnv({ AI: empty }), "x")).toMatchObject({ scores: {}, error: "clef returned no answers" });
    expect(await clefScore(makeEnv(), "x")).toMatchObject({ scores: {}, error: "AI binding is not set" });
    expect(await clefScore(makeEnv({ AI: new MockAi() }), "x", undefined, [])).toMatchObject({ scores: {} });
  });

  it("sends the screenshot only under the size cap", async () => {
    const ai = new MockAi();
    const env = makeEnv({ AI: ai });
    const small = await clefScore(env, "x", new Uint8Array([1, 2, 3]));
    expect(small.imageSent).toBe(true);
    expect(ai.calls[0].input.images).toHaveLength(1);
    const big = await clefScore(env, "x", new Uint8Array(MAX_IMAGE_BYTES + 1));
    expect(big).toMatchObject({ imageSent: false, imageSkipped: "screenshot over 4 MiB" });
    expect("images" in ai.calls[1].input).toBe(false);
  });
});

describe("clef in the capture path", () => {
  it("leaves clef null and makes no call when USE_CLEF is off", async () => {
    stubSite();
    const ai = new MockAi();
    const env = makeEnv({ USE_CLEF: "false", AI: ai });
    await enqueue(env.REVIEW, ["https://www.example.com/"]);
    await runBatch(env, NOW);
    expect(ai.calls).toHaveLength(0);
    const body = (await (await get(env, "/results?since=0")).json()) as { results: { clef: unknown }[] };
    expect(body.results[0].clef).toBeNull();
  });

  it("scores each capture once with its title and text, without the image by default", async () => {
    stubSite();
    const ai = new MockAi();
    ai.scores = { missing_disclosure: 0.8 };
    const env = makeEnv({ USE_CLEF: "true", AI: ai });
    await enqueue(env.REVIEW, ["https://www.example.com/", "https://www.example.com/b"]);
    await runBatch(env, NOW);
    expect(ai.calls).toHaveLength(2);
    expect(ai.calls[0].input.state).toContain("Title: Example page");
    expect(ai.calls[0].input.state).toContain("The best product in the world.");
    expect("images" in ai.calls[0].input).toBe(false);
    const body = (await (await get(env, "/results?since=0")).json()) as { results: { clef: Record<string, any> }[] };
    expect(body.results[0].clef.scores.missing_disclosure).toBe(0.8);
    expect(body.results[0].clef.asked).toEqual(QUESTIONS.map((q) => q.id));
  });

  it("sends the screenshot when CLEF_IMAGE is true", async () => {
    stubSite();
    const ai = new MockAi();
    const env = makeEnv({ USE_CLEF: "true", CLEF_IMAGE: "true", AI: ai });
    await enqueue(env.REVIEW, ["https://www.example.com/"]);
    await runBatch(env, NOW);
    expect(ai.calls[0].input.images[0].content_type).toBe("image/png");
  });

  it("keeps the capture when clef fails, records the error and does not retry", async () => {
    stubSite();
    const ai = new MockAi();
    ai.fail = "boom";
    const env = makeEnv({ USE_CLEF: "true", AI: ai });
    await enqueue(env.REVIEW, ["https://www.example.com/"]);
    const r = await runBatch(env, NOW);
    expect(r).toEqual({ done: 1, retried: 0 });
    const body = (await (await get(env, "/results?since=0")).json()) as { results: Record<string, any>[] };
    expect(body.results[0].ok).toBe(true);
    expect(body.results[0].clef).toMatchObject({ scores: {}, error: "boom" });
  });

  it("a cron tick reads the sitemap, captures and scores, and the summary shows clef totals", async () => {
    stubSite();
    const ai = new MockAi();
    const env = makeEnv({ USE_CLEF: "true", AI: ai, CLEF_FLAG_AT: "0.8" });
    const first = await tick(env, NOW);
    expect(first).toMatchObject({ synced: true, done: 2 });
    expect(ai.calls).toHaveLength(2);
    const again = await tick(env, NOW + 60_000);
    expect(again).toMatchObject({ synced: false, done: 0 });
    expect(ai.calls).toHaveLength(2);
    const meta = await readMeta(env.REVIEW);
    expect(meta.clef).toEqual({ calls: 2, errors: 0, inputTokens: 240, outputTokens: 14 });
    const summary = (await (await get(env, "/summary")).json()) as Record<string, any>;
    expect(summary.secondOpinion).toBeUndefined();
    expect(summary.clef).toMatchObject({ on: true, model: DEFAULT_CLEF_MODEL, flagAt: 0.8, image: false, calls: 2, errors: 0, inputTokens: 240 });
    expect(summary.clef.rules).toEqual(QUESTIONS.map((q) => q.id));
  });

  it("the old /score route is gone", async () => {
    const res = await handle(new Request("https://review.example.com/score", { method: "POST", headers: auth, body: "{}" }), makeEnv(), NOW);
    expect(res.status).toBe(404);
  });
});

describe("flag line config", () => {
  const post = (env: ReturnType<typeof makeEnv>, body: unknown, headers: Record<string, string> = auth) =>
    handle(new Request("https://review.example.com/config", { method: "POST", headers, body: JSON.stringify(body) }), env, NOW);
  const flagAtOf = async (env: ReturnType<typeof makeEnv>) =>
    ((await (await get(env, "/summary")).json()) as { clef: { flagAt: number; flagAtSource: string } }).clef;

  it("takes only a number above 0 and up to 1, and needs the token", async () => {
    const env = makeEnv();
    for (const bad of [0, -0.1, 1.5, "0.5", null, undefined]) {
      expect((await post(env, { clefFlagAt: bad })).status, String(bad)).toBe(400);
    }
    expect((await post(env, { clefFlagAt: 0.5 }, {})).status).toBe(401);
    expect(await flagAtOf(env)).toMatchObject({ flagAt: 0.7, flagAtSource: "default" });
  });

  it("stored config beats the var, the var beats the default, and the summary says which", async () => {
    const env = makeEnv({ CLEF_FLAG_AT: "0.8" });
    expect(await flagAtOf(env)).toMatchObject({ flagAt: 0.8, flagAtSource: "env" });
    const res = await post(env, { clefFlagAt: 0.55 });
    expect(res.status).toBe(200);
    expect(await flagAtOf(env)).toMatchObject({ flagAt: 0.55, flagAtSource: "config" });
    expect(await post(env, { clefFlagAt: 1 })).toHaveProperty("status", 200);
    expect(await flagAtOf(env)).toMatchObject({ flagAt: 1, flagAtSource: "config" });
  });

  it("applies the stored line to later captures only", async () => {
    stubSite();
    const ai = new MockAi();
    const env = makeEnv({ USE_CLEF: "true", AI: ai });
    await enqueue(env.REVIEW, ["https://www.example.com/"]);
    await runBatch(env, NOW);
    await post(env, { clefFlagAt: 0.4 });
    await enqueue(env.REVIEW, ["https://www.example.com/b"]);
    await runBatch(env, NOW);
    const body = (await (await get(env, "/results?since=0")).json()) as { results: Record<string, any>[] };
    expect(body.results.map((r) => r.clef.flagAt)).toEqual([0.7, 0.4]);
  });
});
