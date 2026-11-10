// core/schedule.js: cron helpers (UTC; minute, hour and day of week) and the next run per producer. Pure.
export var RUN_DAY = 864e5;

// One cron field as a sorted list of allowed values, or null when it is a form this page does not read.
export function cronField(text, lo, hi) {
  var out = {};
  var ok = String(text).split(",").every(function (part) {
    var m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!m) return false;
    var a = m[1] === "*" ? lo : Number(m[2]);
    var b = m[1] === "*" ? hi : m[3] !== undefined ? Number(m[3]) : (m[4] ? hi : a);
    var step = m[4] ? Number(m[4]) : 1;
    if (a < lo || b > hi || a > b || step < 1) return false;
    for (var v = a; v <= b; v += step) out[v] = true;
    return true;
  });
  return ok ? Object.keys(out).map(Number).sort(function (x, y) { return x - y; }) : null;
}

// Minute, hour and day of week; day of month and month must be "*".
export function cronParts(schedule) {
  var f = String(schedule || "").trim().split(/\s+/);
  if (f.length !== 5 || f[2] !== "*" || f[3] !== "*") return null;
  var min = cronField(f[0], 0, 59), hour = cronField(f[1], 0, 23), dow = cronField(f[4], 0, 7);
  if (!min || !hour || !dow) return null;
  // Sunday is 0 or 7.
  dow = dow.map(function (v) { return v % 7; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
  return { min: min, hour: hour, dow: dow };
}

// Fire times on the UTC days [fromMs, fromMs + days), fromMs at a UTC midnight.
export function fireTimes(c, fromMs, days) {
  var out = [];
  for (var d = 0; d < days; d++) {
    var day = fromMs + d * RUN_DAY;
    if (c.dow.indexOf(new Date(day).getUTCDay()) === -1) continue;
    c.hour.forEach(function (h) { c.min.forEach(function (m) { out.push(day + h * 3600e3 + m * 60e3); }); });
  }
  return out;
}

// The longest gap between two runs over a week, in ms; null when the schedule is not readable.
export function scheduleInterval(schedule) {
  var c = cronParts(schedule);
  if (!c) return null;
  var start = Date.UTC(2024, 0, 1); // a Monday
  var t = fireTimes(c, start, 7);
  if (!t.length) return null;
  var gap = t[0] + 7 * RUN_DAY - t[t.length - 1];
  for (var i = 1; i < t.length; i++) gap = Math.max(gap, t[i] - t[i - 1]);
  return gap;
}

// true or false, or null when the schedule or the last run time is unknown.
export function isLate(lastRunAt, schedule, now) {
  var gap = scheduleInterval(schedule);
  var last = Date.parse(lastRunAt);
  if (gap === null || !lastRunAt || isNaN(last)) return null;
  var nowMs = now ? Date.parse(now) : Date.now();
  return nowMs - last > 2 * gap;
}

export function nextRun(schedule, now) {
  var c = cronParts(schedule);
  if (!c) return null;
  var nowMs = now ? Date.parse(now) : Date.now();
  var d = new Date(nowMs);
  var t = fireTimes(c, Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), 8).filter(function (x) { return x > nowMs; });
  return t.length ? new Date(t[0]).toISOString() : null;
}

// The earliest next run across the named producers (all when producerIds is null). certain is false, and at
// null, when any named producer's schedule does not parse.
export function nextRunFor(definition, producerIds, now) {
  var at = null;
  var iso = new Date(now).toISOString();
  var ps = ((definition && definition.producers) || []).filter(function (p) {
    return !producerIds || producerIds.indexOf(p.id) !== -1;
  });
  for (var i = 0; i < ps.length; i++) {
    if (!cronParts(ps[i].schedule)) return { at: null, certain: false };
    var n = nextRun(ps[i].schedule, iso);
    if (n && (at === null || n < at)) at = n;
  }
  return { at: at, certain: true };
}
