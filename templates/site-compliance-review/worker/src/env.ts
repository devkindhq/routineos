// Bindings and settings for the site review Worker, plus the host allow-list.

/** The Browser Run binding, reduced to the one method this Worker uses (Cloudflare docs: quickAction). */
export interface BrowserBinding {
  quickAction(action: string, options: Record<string, unknown>): Promise<Response>;
}

/** The optional Workers AI binding, reduced to run(). */
export interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export interface Env {
  BROWSER: BrowserBinding;
  REVIEW: R2Bucket;
  AI?: AiBinding;
  ACCESS_TOKEN?: string;
  ALLOWED_HOSTS?: string;
  SITEMAP_URL?: string;
  BATCH_SIZE?: string;
  MAX_ATTEMPTS?: string;
  MAX_NEW_PER_SYNC?: string;
  RECAPTURE_DAYS?: string;
  LINK_TTL_SECONDS?: string;
  /** "true" scores every rule on every capture with the Clef model (the main verdict engine). */
  USE_CLEF?: string;
  /** Workers AI model id for Clef. Default @cf/cloudflare/clef-flash. */
  CLEF_MODEL?: string;
  /** Clef score (0 to 1) at or above which a rule counts as a flag. Default 0.7. */
  CLEF_FLAG_AT?: string;
  /** "true" also sends the screenshot to Clef. Default off: image input on the live endpoint is unverified. */
  CLEF_IMAGE?: string;
}

export const TOKEN_HEADER = "x-review-token";
export const USER_AGENT = "RoutineOS-site-review/1 (read-only monitor)";

/** A whole number from a text var, clamped to [min, max], or the default when unset or not a number. */
export function num(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export const DEFAULT_CLEF_MODEL = "@cf/cloudflare/clef-flash";
export const clefOn = (env: Env) => (env.USE_CLEF ?? "false").trim().toLowerCase() === "true";
export const clefImageOn = (env: Env) => (env.CLEF_IMAGE ?? "false").trim().toLowerCase() === "true";
export const clefModel = (env: Env) => {
  const m = (env.CLEF_MODEL ?? "").trim();
  return m && !m.toLowerCase().startsWith("replace_") ? m : DEFAULT_CLEF_MODEL;
};
/** The flag line, a number in (0, 1]; anything else gives 0.7. */
export function clefFlagAt(env: Env): number {
  const raw = (env.CLEF_FLAG_AT ?? "").trim();
  const n = Number(raw);
  return raw !== "" && Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.7;
}

export function allowedHosts(env: Env): Set<string> {
  return new Set(
    (env.ALLOWED_HOSTS ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter((h) => h && !h.startsWith("replace_")),
  );
}

/** The URL when it is https, on an allowed host, on the default port and without credentials; otherwise null. */
export function checkTarget(raw: unknown, hosts: Set<string>): URL | null {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password) return null;
  if (!hosts.has(url.hostname.toLowerCase())) return null;
  url.hash = "";
  return url;
}
