// core/pages/autorefresh.js: when a spec page should read again on its own. Pure; the page owns the timer and
// recomputes this after every refresh, never relying on a re-render.
import { nextRunFor } from "../schedule.js";

export var AUTO_GRACE_MS = 90000; // a short wait after the run is due, so its writes have landed (builder's call)

// Milliseconds from `now` (ms) until the next run plus graceMs, or null when the schedule does not parse
// (nextRunFor is not certain) or no run is due.
export function msUntilRefresh(definition, now, graceMs) {
  var next = nextRunFor(definition, null, now);
  if (!next.certain || !next.at) return null;
  return Math.max(0, Date.parse(next.at) - now) + graceMs;
}
