// The v2 page routes and their text goldens (golden/pages-v2.json). Each route is checked in light and dark, at 390
// and 1280 px, in wa and native mode; the golden key is `${key}|${theme}|${width}` and its value the normalised
// text of `main`, which both modes must equal. Packages add routes as their pages land.
// CAPTURE_V2=1 records keys that are missing; it never overwrites a key with different text.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const GOLDEN_V2 = join(dirname(fileURLToPath(import.meta.url)), "golden", "pages-v2.json");

// {key, hash, snap?: "demo"|"v2", viewer?: string, owner?: boolean}
export const V2_ROUTES = [
  { key: "entity-active", hash: "#/entity/role/https-jobs-example-au-00003", snap: "demo" },
  { key: "entity-dropped", hash: "#/entity/role/https-jobs-example-au-00049", snap: "demo" },
  { key: "entity-kept", hash: "#/entity/role/https-jobs-example-au-00174", snap: "demo" },
  { key: "entity-v2", hash: "#/entity/role/https-jobs-example-au-00003", owner: true },
  { key: "today", hash: "#/today", owner: true },
  { key: "approvals", hash: "#/approvals", owner: true },
  { key: "approvals-queued", hash: "#/approvals?tab=queued", owner: true },
  { key: "approvals-done", hash: "#/approvals?tab=done", owner: true },
  { key: "approvals-proposals", hash: "#/approvals?kind=proposals", owner: true },
  { key: "runs", hash: "#/runs", snap: "demo" },
  { key: "run-partial", hash: "#/runs/jobs-watch-20261027", snap: "demo" },
  { key: "run-v2", hash: "#/runs/jobs-watch-20261028", owner: true },
  { key: "history", hash: "#/history", owner: true },
  { key: "history-calendar", hash: "#/history?mode=cal", snap: "demo" },
  { key: "settings-appearance", hash: "#/settings/appearance", owner: true },
  { key: "settings-members", hash: "#/settings/members", owner: true },
  { key: "settings-views", hash: "#/settings/views", owner: true },
  { key: "workers", hash: "#/workers", owner: true },
];

export function goldenKey(key, theme, width) { return `${key}|${theme}|${width}`; }

function load(path) { return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {}; }

export function goldenFor(key, path = GOLDEN_V2) { return load(path)[key]; }

// In capture mode, store text under key when the key is missing and return it. A key already stored with other text
// throws: goldens are captured once. Outside capture mode, return the stored text (undefined when missing).
export function captureGolden(key, text, opts = {}) {
  const path = opts.path || GOLDEN_V2;
  const capture = opts.capture === undefined ? process.env.CAPTURE_V2 === "1" : opts.capture;
  const all = load(path);
  if (!capture) return all[key];
  if (key in all) {
    if (all[key] !== text) throw new Error(`refusing to overwrite golden ${key}; goldens are captured once`);
    return all[key];
  }
  all[key] = text;
  const sorted = Object.fromEntries(Object.keys(all).sort().map((k) => [k, all[k]]));
  writeFileSync(path, JSON.stringify(sorted, null, 2) + "\n");
  return text;
}
