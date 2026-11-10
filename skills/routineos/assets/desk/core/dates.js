// core/dates.js: human dates in the viewer's locale and time zone. Pure; formats come from Intl, never a fixed pattern.
// opts = {locale?, timeZone?} default to the runtime's. Day comparisons use the calendar date in opts.timeZone.
export var DAY_MS = 86400000;

export function datesParse(iso) {
  if (iso === null || iso === undefined || iso === "") return null;
  var t = Date.parse(String(iso));
  return isNaN(t) ? null : t;
}

export function datesFmt(opts, o) {
  opts = opts || {};
  return new Intl.DateTimeFormat(opts.locale, Object.assign({ timeZone: opts.timeZone }, o));
}

// The calendar day number (days since the epoch) of a moment in the given zone.
export function datesDay(t, opts) {
  var parts = {};
  datesFmt(opts, { year: "numeric", month: "2-digit", day: "2-digit", calendar: "gregory", numberingSystem: "latn" })
    .formatToParts(new Date(t)).forEach(function (p) { parts[p.type] = p.value; });
  return { n: Math.round(Date.UTC(+parts.year, +parts.month - 1, +parts.day) / DAY_MS), year: +parts.year, month: parts.month };
}

// Hour and minute fields: two-digit hours where the locale uses a 24-hour clock ("09:05"), else numeric ("9:05 AM").
export function datesHm(opts) {
  var hc = datesFmt(opts, { hour: "numeric", minute: "2-digit" }).resolvedOptions().hourCycle;
  return { hour: hc === "h23" || hc === "h24" ? "2-digit" : "numeric", minute: "2-digit" };
}

export function datesTime(t, opts) { return datesFmt(opts, datesHm(opts)).format(new Date(t)); }

export function datesRel(opts) { return new Intl.RelativeTimeFormat((opts || {}).locale, { numeric: "auto" }); }

// human(iso, now, {locale?, timeZone?, style?: "list"|"sentence"}); style defaults to "list".
export function human(iso, now, opts) {
  var t = datesParse(iso);
  if (t === null) return "";
  opts = opts || {};
  var sentence = opts.style === "sentence";
  var diff = now - t;
  var abs = Math.abs(diff);
  var rel = datesRel(opts);
  if (abs < 60000) return rel.format(0, "second") === "now" ? "just now" : rel.format(0, "second");
  if (abs < 3600000) return rel.format((diff > 0 ? -1 : 1) * Math.floor(abs / 60000), "minute");
  if (diff < 0 && abs < DAY_MS && !sentence) return rel.format(Math.floor(abs / 3600000), "hour");
  var a = datesDay(t, opts);
  var b = datesDay(now, opts);
  var days = b.n - a.n;
  if (days === 0) return sentence ? rel.format(0, "day") + " at " + datesTime(t, opts) : datesTime(t, opts);
  if (days === 1 || days === -1) return rel.format(-days, "day") + " at " + datesTime(t, opts);
  if (Math.abs(days) < 7) {
    if (sentence) return datesFmt(opts, { weekday: "long" }).format(new Date(t)) + " at " + datesTime(t, opts);
    return datesFmt(opts, Object.assign({ weekday: "short" }, datesHm(opts))).format(new Date(t));
  }
  if (a.year === b.year) return datesFmt(opts, { day: "numeric", month: "short" }).format(new Date(t));
  return datesFmt(opts, { day: "numeric", month: "short", year: "numeric" }).format(new Date(t));
}

// The full local date, time and zone name, for a title attribute.
export function exact(iso, opts) {
  var t = datesParse(iso);
  if (t === null) return "";
  return datesFmt(opts, { dateStyle: "full", timeStyle: "long" }).format(new Date(t));
}

// The timeline group of a moment: today, yesterday, thisWeek, month:YYYY-MM (this year) or year:YYYY. null when unparsable.
export function bucket(iso, now, opts) {
  var t = datesParse(iso);
  if (t === null) return null;
  var a = datesDay(t, opts);
  var b = datesDay(now, opts);
  var days = b.n - a.n;
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return "thisWeek";
  if (a.year === b.year) return "month:" + a.year + "-" + a.month;
  return "year:" + a.year;
}

export function bucketLabel(key, opts) {
  var k = String(key || "");
  var cap = function (s) { return s.charAt(0).toUpperCase() + s.slice(1); };
  if (k === "today") return cap(datesRel(opts).format(0, "day"));
  if (k === "yesterday") return cap(datesRel(opts).format(-1, "day"));
  if (k === "thisWeek") return "This week";
  var m = /^month:(\d{4})-(\d\d)$/.exec(k);
  if (m) return new Intl.DateTimeFormat((opts || {}).locale, { month: "long", timeZone: "UTC" })
    .format(new Date(Date.UTC(+m[1], +m[2] - 1, 15)));
  var y = /^year:(\d{4})$/.exec(k);
  if (y) return y[1];
  return "Undated";
}

// "1 item", "2 items": the count in the locale's digits and the word Intl.PluralRules picks.
export function plural(n, one, other, locale) {
  return new Intl.NumberFormat(locale).format(n) + " " + (new Intl.PluralRules(locale).select(n) === "one" ? one : other);
}

// "in 14 hours", "in 4 days": hours read as a duration, days past two.
export function untilText(h) {
  if (h < 1) return "under an hour";
  if (h < 48) return h + (h === 1 ? " hour" : " hours");
  return Math.round(h / 24) + " days";
}

// History and Activity group their rows by calendar day in the viewer's zone, newest group first.
export var DAY_GROUPS = ["Today", "Yesterday", "This week", "Earlier"];

// "Today", "Yesterday", "This week" (two to six days back) or "Earlier". A future moment or an unreadable one is
// "Today" or "Earlier" respectively. opts = {locale?, timeZone?}.
export function dayGroup(iso, now, opts) {
  var t = datesParse(iso);
  if (t === null) return "Earlier";
  var days = datesDay(now, opts).n - datesDay(t, opts).n;
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return days < 7 ? "This week" : "Earlier";
}
