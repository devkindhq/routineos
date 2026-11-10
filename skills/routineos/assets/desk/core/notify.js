// core/notify.js: the bell (spec 5.2). Derived from the store on every read, with no producer writes. The bell lists
// things that happened: match and alert messages, failed or late runs, runs that hit the inbox cap, and requests a
// run could not apply, and requests that timed out undecided. It never lists a waiting decision: gates are counted in the pinned "N waiting for you" row
// (waitingSummary) and proposals and approvals live on Approvals. Read state is the viewer's existing
// data/users/<viewer>/state/read/<id>; each item carries the id it is read under.
import { deriveRequests } from "./requests.js";
import { isLate } from "./schedule.js";

export var NOTIF_WINDOW_MS = 7 * 864e5;
export var NOTIF_SOON_HOURS = 6;
export var NOTIF_MAX = 50;

export function notifMs_(iso) {
  var t = Date.parse(iso || "");
  return isNaN(t) ? 0 : t;
}

export function notifLabel_(producers, id) {
  var p = (producers || []).filter(function (x) { return x.id === id; })[0];
  return (p && p.label) || id || "A routine";
}

// src: {inbox, pending, decisions (Set of decided gate ids), runs, producers, read (Set of read ids), now (ms)}.
// Returns [{id, readId, kind, title, at, href, unread}] newest first, at most NOTIF_MAX.
export function deriveNotifications(src) {
  var now = src.now === undefined ? Date.now() : src.now;
  var read = src.read || new Set();
  var decided = src.decisions || new Set();
  var out = [];
  function add(kind, readId, title, at, href) {
    out.push({ id: kind + ":" + readId, readId: readId, kind: kind, title: title, at: at, href: href, unread: !read.has(readId) });
  }
  function recent(iso) { var t = notifMs_(iso); return t && now - t <= NOTIF_WINDOW_MS; }

  // Docs with no data object are skipped; producer names are plain keys (no prototype).
  (src.inbox || []).forEach(function (m) {
    if (!m || !m.data || typeof m.data !== "object") return;
    if (m.data.kind === "proposal" || m.data.kind === "approval") return;
    if (recent(m.data.createdAt)) add("inbox", m.id, m.data.title || "New message", m.data.createdAt, "#/today");
  });
  var latest = Object.create(null);
  (src.runs || []).forEach(function (r) {
    var d = r && r.data;
    if (!d || typeof d !== "object") return;
    var cur = latest[d.producer];
    if (!cur || notifMs_(d.startedAt) > notifMs_(cur.data.startedAt)) latest[d.producer] = r;
    if (!recent(d.startedAt)) return;
    var who = notifLabel_(src.producers, d.producer);
    if (d.status === "failed") add("run-failed", "run--" + r.id, who + " run failed", d.startedAt, "#/runs/" + encodeURIComponent(r.id));
    var missed = (Array.isArray(d.processed) ? d.processed : []).filter(function (p) { return p && p.outcome === "not_applied"; });
    if (missed.length) {
      add("not-applied", "na--" + r.id, missed.length + (missed.length === 1 ? " approval" : " approvals") + " could not be applied in run " + r.id,
        d.endedAt || d.startedAt, "#/approvals?tab=done" + (missed.length === 1 ? "&r=" + encodeURIComponent(missed[0].request) : ""));
    }
    if (d.inboxSuppressed > 0) {
      add("cap", "cap--" + r.id, who + " hit the inbox cap: " + d.inboxSuppressed + " messages held back", d.startedAt,
        "#/runs/" + encodeURIComponent(r.id));
    }
  });
  (src.producers || []).forEach(function (p) {
    var last = latest[p.id];
    if (last && isLate(last.data.startedAt, p.schedule, new Date(now).toISOString()) === true) {
      add("run-late", "late--" + last.id, notifLabel_(src.producers, p.id) + " is late: no run since " + last.data.startedAt.slice(0, 10),
        last.data.startedAt, "#/history?mode=health");
    }
  });
  // A shared gate nobody decided before it timed out (or that closed as expired): say it was missed.
  (src.pending || []).forEach(function (g) {
    var d = g && g.data;
    if (!d || typeof d !== "object" || d.lane || decided.has(g.id)) return;
    var h = Number(d.timeoutHours), c = notifMs_(d.createdAt), at = null;
    if (d.status === "expired") at = c && h > 0 && h <= 8760 ? c + h * 3600000 : c;
    else if ((d.status || "pending") === "pending" && c && h > 0 && h <= 8760 && c + h * 3600000 <= now) at = c + h * 3600000;
    if (!at) return;
    var iso = new Date(at).toISOString();
    if (recent(iso)) add("missed", "missed--" + g.id, "Missed: " + (d.title || "A request") + " timed out", iso, "#/approvals?tab=done&r=" + encodeURIComponent(g.id));
  });
  out.sort(function (a, b) { return notifMs_(b.at) - notifMs_(a.at) || (a.id < b.id ? -1 : 1); });
  return out.slice(0, NOTIF_MAX);
}

// The pinned row: every request still waiting for a person (deriveRequests), and how many gates time out within
// NOTIF_SOON_HOURS, with the soonest. src: the deriveRequests lists (decisions as docs). Returns {count, soon: {label}|null}.
export function waitingSummary(src, now, viewer) {
  if (now === undefined) now = src.now === undefined ? Date.now() : src.now;
  var count = 0, soon = 0, soonest = Infinity;
  deriveRequests(src, viewer || null, now).forEach(function (r) {
    if (r.state !== "waiting") return;
    count++;
    var t = Date.parse(r.timeoutAt || "");
    if (isNaN(t)) return;
    var hours = (t - now) / 3600000;
    if (hours < NOTIF_SOON_HOURS) { soon++; soonest = Math.min(soonest, hours); }
  });
  if (!soon) return { count: count, soon: null };
  var h = Math.ceil(soonest);
  return { count: count, soon: { label: soon + " times out in " + (h <= 1 ? "under an hour" : h + " hours") } };
}

// The bell's badge (UX review 4): the number is what needs you, the same count as Approvals and Today; unread
// notices only add a dot and a word in the label.
export function bellBadge(waiting, unread) {
  var label = "Notifications" + (waiting ? ", " + waiting + " need you" : "") + (unread ? ", " + unread + " unread" : "");
  return { text: waiting ? String(waiting) : "", dot: !waiting && unread > 0, label: label };
}

export function unreadCount(items) {
  return items.filter(function (n) { return n.unread; }).length;
}

export function notifTab(items, tab) {
  return tab === "unread" ? items.filter(function (n) { return n.unread; }) : items;
}

export var NOTIF_ICONS = { inbox: "bell", "run-failed": "triangle-alert", "run-late": "history", cap: "inbox", "not-applied": "badge-check", missed: "history" };
