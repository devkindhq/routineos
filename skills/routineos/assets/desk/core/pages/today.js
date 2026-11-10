// core/pages/today.js: what needs the viewer now, as cards (spec 5.1). Decisions happen on Approvals.
import { datesFmt, datesParse, human } from "../dates.js";
import { deriveRequests } from "../requests.js";
import { isLate, nextRunFor } from "../schedule.js";

export var TODAY_HEALTH = [["red", "Needs action", "danger"], ["yellow", "Check", "warning"], ["green", "All good", "success"]];

// One plain status for a routine's health row: {tone, text}. h: {last, late, next}; now in ms.
export function healthLine(h, now) {
  var next = h.next && h.next.at ? "next " + human(h.next.at, now, { style: "sentence" }) : "next run unknown";
  if (!h.last) return { tone: "neutral", text: "Has not run yet, " + next };
  var d = h.last.data, t = Date.parse(d.startedAt || ""), days = Math.floor((now - t) / 864e5);
  var ran = "last ran " + (days >= 2 ? days + " days ago" : human(d.startedAt, now, { style: "sentence" }));
  var word = d.status === "failed" ? "Failed" : h.late ? "Late" : d.status === "partial" ? "Partial" : "On time";
  return { tone: word === "On time" ? "success" : word === "Partial" ? "warning" : "danger", text: word + ": " + ran + ", " + next };
}

// src: deriveRequests' inputs plus {definition, entities, done: Set|null, snooze: docs}. now in ms.
export function todayModel(src, now) {
  var defn = src.definition || {}, iso = new Date(now).toISOString();
  var latest = {};
  (src.runs || []).forEach(function (r) {
    var p = r.data.producer, cur = latest[p];
    if (!cur || (r.data.startedAt || "") > (cur.data.startedAt || "")) latest[p] = r;
  });
  var hero = null, h = defn.desk && defn.desk.health, type = h && Object.keys(h)[0];
  if (type) {
    hero = { type: type, red: 0, yellow: 0, green: 0, total: 0, stack: [], tone: "success" };
    // Only what the list shows by default: active records, less a person's drops waiting for the next run.
    var drops = {};
    (src.decisions || []).forEach(function (d) { if (d.data && d.data.decision === "drop") drops[d.id] = 1; });
    (src.entities || []).forEach(function (e) {
      if ((e.data.status || "active") === "dropped" || drops[e.id]) return;
      var v = e.data.type === type && (e.data.display || {})[h[type].field];
      TODAY_HEALTH.forEach(function (t) { if ((h[type][t[0]] || []).indexOf(v) !== -1) hero[t[0]]++; });
    });
    hero.stack = TODAY_HEALTH.map(function (t) { return { tone: t[2], label: t[1], value: hero[t[0]] }; });
    hero.total = hero.red + hero.yellow + hero.green;
    hero.tone = hero.red ? "danger" : hero.yellow ? "warning" : "success";
    hero.capped = !!(src.entities && src.entities.capped);
  }
  var snoozed = {};
  (src.snooze || []).forEach(function (d) { if (!d.data.until || d.data.until > iso) snoozed[d.id] = 1; });
  var reqs = deriveRequests(src, src.viewer || null, now);
  var waiting = reqs.filter(function (r) { return r.state === "waiting"; }).map(function (r, i) { return [r, i]; }).sort(function (a, b) {
    var x = Date.parse(a[0].timeoutAt || "") || Infinity, y = Date.parse(b[0].timeoutAt || "") || Infinity;
    return x - y || a[1] - b[1];
  }).map(function (p) { return p[0]; });
  var producers = defn.producers || [], newSince = 0, since = [];
  producers.forEach(function (p) {
    var r = latest[p.id], d = r && r.data;
    if (!d) return;
    newSince += (d.counts && d.counts.new) || 0;
    since.push({ producer: p.id, run: r, counts: d.counts || {}, changed: (d.changed || []).slice(0, 5),
      partial: d.status === "partial" ? { parsed: d.parsed, claimed: d.claimed } : null });
  });
  var out = {
    hero: hero, newSinceLast: newSince, waiting: waiting.slice(0, 3), waitingTotal: waiting.length,
    fromRoutine: (src.inbox || []).filter(function (m) {
      return (m.data.kind === "match" || m.data.kind === "alert") && !(src.done && src.done.has(m.id)) && !snoozed[m.id];
    }).sort(function (a, b) { return (b.data.createdAt || "") < (a.data.createdAt || "") ? -1 : 1; }),
    sinceLastRun: since,
    health: producers.map(function (p) {
      var r = latest[p.id] || null;
      var x = { producer: p.id, last: r, late: !!(r && isLate(r.data.startedAt, p.schedule, iso)), next: nextRunFor(defn, [p.id], now) };
      return Object.assign(x, healthLine(x, now));
    }),
    queued: reqs.filter(function (r) { return r.state === "queued"; }).length,
    proposals: waiting.filter(function (r) { return r.group === "proposals" || r.group === "views"; }).length,
  };
  out.late = out.health.filter(function (x) { return x.late; }).length;
  return out;
}

export function partialLine(p) { return "parsed " + p.parsed + " of " + p.claimed; }

// The page's one-line answer from the declared status counts {red, yellow, green, total, capped}. null when there is no
// declared status, no record, or the read was capped: an incomplete read never claims "All green".
export function headline(c) {
  if (!c || c.capped || !c.total) return null;
  var n = (c.red || 0) + (c.yellow || 0);
  if (!n) return "All green";
  return "Not all green yet: " + n + " " + (n === 1 ? "item needs" : "items need") + " attention";
}

export function leadLine(c) {
  if (!c || c.capped || !c.total) return null;
  return (c.red || 0) + " need action now, " + (c.yellow || 0) + " to check";
}

// "Last refreshed at <time>" from the newest run's finish (its start when it wrote no end), in the zone tz.
export function lastRefreshed(runs, tz, locale) {
  var best = null;
  (runs || []).forEach(function (r) {
    var d = r && r.data || {}, t = datesParse(d.endedAt || d.startedAt);
    if (t !== null && (best === null || t > best)) best = t;
  });
  if (best === null) return null;
  var o = { locale: locale, timeZone: tz };
  return "Last refreshed at " + datesFmt(o, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz }).format(new Date(best));
}

// The change in the green share between the two newest runs, only when both wrote counts.green and counts.total
// (assumed names, a producer opts in by writing them). Whole percent points, "up 5% since the previous run".
export function progressDelta(runs) {
  var rows = (runs || []).filter(function (r) { return r && r.data && isFinite(Date.parse(r.data.startedAt)); }).sort(function (a, b) {
    return Date.parse(b.data.startedAt) - Date.parse(a.data.startedAt);
  });
  function pct(r) {
    var c = (r && r.data.counts) || {};
    return typeof c.green === "number" && typeof c.total === "number" && c.total > 0 ? (c.green / c.total) * 100 : null;
  }
  var a = pct(rows[0]), b = pct(rows[1]);
  if (a === null || b === null) return null;
  var d = Math.round((a - b) * 10) / 10;
  if (!d) return "no change since the previous run";
  return (d > 0 ? "up " : "down ") + Math.abs(d) + "% since the previous run";
}

// The three count tiles over the hero's counts, each a link to Browse filtered to that status.
export function healthTiles(h) {
  if (!h) return null;
  return TODAY_HEALTH.map(function (t) {
    return { key: t[0], label: t[1], tone: t[2], value: h[t[0]] || 0, href: "#/browse/" + encodeURIComponent(h.type) + "?health=" + t[0] };
  });
}
