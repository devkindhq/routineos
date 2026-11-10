// Token check for the routine's requests, and signed short-lived links for screenshots.
import { TOKEN_HEADER, type Env } from "./env";

const enc = new TextEncoder();

/** Constant-time comparison of two strings (length is not hidden). */
export function sameText(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export function tokenOk(request: Request, env: Env): boolean {
  const given = request.headers.get(TOKEN_HEADER) ?? "";
  return !!env.ACCESS_TOKEN && given.length > 0 && sameText(given, env.ACCESS_TOKEN);
}

async function signingKey(env: Env): Promise<CryptoKey> {
  // The link key is derived from the access token, so rotating the token voids every link.
  const material = await crypto.subtle.digest("SHA-256", enc.encode(`review-shot-links:${env.ACCESS_TOKEN ?? ""}`));
  return crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sign(env: Env, key: string, exp: number): Promise<string> {
  return hex(await crypto.subtle.sign("HMAC", await signingKey(env), enc.encode(`${key}.${exp}`)));
}

export async function signedPath(env: Env, key: string, ttlSeconds: number, now: number): Promise<string> {
  const exp = Math.floor(now / 1000) + ttlSeconds;
  return `/shot/${encodeURIComponent(key)}?exp=${exp}&sig=${await sign(env, key, exp)}`;
}

export async function verifyLink(env: Env, key: string, exp: string | null, sig: string | null, now: number): Promise<boolean> {
  if (!env.ACCESS_TOKEN || !exp || !sig || !/^\d{1,12}$/.test(exp)) return false;
  if (Number(exp) * 1000 < now) return false;
  return sameText(sig, await sign(env, key, Number(exp)));
}
