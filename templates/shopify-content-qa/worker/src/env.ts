// Bindings and settings for the content QA Worker, plus the host allow-list.

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
  SHOTS: R2Bucket;
  AI?: AiBinding;
  ACCESS_TOKEN?: string;
  ALLOWED_HOSTS?: string;
  SHOTS_PER_CRON?: string;
  LINK_TTL_SECONDS?: string;
  VISION_CHECK?: string;
  VISION_MODEL?: string;
}

export const TOKEN_HEADER = "x-content-qa-token";
export const USER_AGENT = "RoutineOS-content-qa/1 (read-only monitor)";

/** A whole number from a text var, clamped to [min, max], or the default when unset or not a number. */
export function num(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
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
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password) return null;
  if (!hosts.has(url.hostname.toLowerCase())) return null;
  url.hash = "";
  return url;
}
