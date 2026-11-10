// The one setting a person can change without redeploying: the Clef flag line, stored in R2.
// Precedence for the flag line: stored config, then the CLEF_FLAG_AT var, then 0.7.
import { clefFlagAt, type Env } from "./env";
import { update } from "./store";

const CONFIG = "state/config.json";

export interface Config {
  /** Clef score (0 to 1) at or above which a rule counts as a flag. */
  clefFlagAt?: number;
}

export type FlagAtSource = "config" | "env" | "default";

/** A flag line is a number in (0, 1]. */
export const validFlagAt = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= 1;

export async function readConfig(env: Env): Promise<Config> {
  const obj = await env.REVIEW.get(CONFIG);
  if (!obj) return {};
  try {
    const raw = (await obj.json()) as Config | null;
    return raw && validFlagAt(raw.clefFlagAt) ? { clefFlagAt: raw.clefFlagAt } : {};
  } catch {
    return {};
  }
}

export async function writeConfig(env: Env, patch: Config): Promise<Config> {
  return update<Config>(env.REVIEW, CONFIG, {}, (cur) => ({ ...cur, ...patch }));
}

/** The flag line in force and where it came from. */
export async function effectiveFlagAt(env: Env): Promise<{ value: number; source: FlagAtSource }> {
  const stored = (await readConfig(env)).clefFlagAt;
  if (validFlagAt(stored)) return { value: stored, source: "config" };
  const raw = (env.CLEF_FLAG_AT ?? "").trim();
  if (raw !== "" && validFlagAt(Number(raw))) return { value: clefFlagAt(env), source: "env" };
  return { value: 0.7, source: "default" };
}
