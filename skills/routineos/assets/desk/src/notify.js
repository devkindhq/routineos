/* src/notify.js: the notifications feed (spec "Notifications"). Derived from the store on every read, with no
   producer writes: new inbox items, gates waiting, gates near timeout, failed or late runs, runs that hit the
   inbox cap. Read state is the viewer's existing data/users/<viewer>/state/read/<id>; each item carries the id
   it is read under (the inbox item's own id, so reading it in the Inbox also reads it here). */

var NOTIF_WINDOW_MS = 7 * 864e5;
var NOTIF_SOON_HOURS = 6;
var NOTIF_MAX = 50;
var NOTIF_TABS = [["all", "All"], ["unread", "Unread"]];

function notifMs_(iso) {
  var t = Date.parse(iso || "");
  return isNaN(t) ? 0 : t;
}

function notifLabel_(producers, id) {
  var p = (producers || []).filter(function (x) { return x.id === id; })[0];
  return (p && p.label) || id || "A routine";
}

// src: {inbox, pending, decisions (Set of decided gate ids), runs, producers, read (Set of read ids), now (ms)}.
// Returns [{id, readId, kind, title, at, href, unread}] newest first, at most NOTIF_MAX.
function deriveNotifications(src) {
  var now = src.now === undefined ? Date.now() : src.now;
  var read = src.read || new Set();
  var decided = src.decisions || new Set();
  var out = [];
  function add(kind, readId, title, at, href) {
    out.push({ id: kind + ":" + readId, readId: readId, kind: kind, title: title, at: at, href: href, unread: !read.has(readId) });
  }
  function recent(iso) { var t = notifMs_(iso); return t && now - t <= NOTIF_WINDOW_MS; }

  (src.inbox || []).forEach(function (m) {
    if (recent(m.data.createdAt)) add("inbox", m.id, m.data.title || "New inbox item", m.data.createdAt, "#/inbox");
  });
  (src.pending || []).forEach(function (g) {
    if ((g.data.status || "pending") !== "pending" || decided.has(g.id)) return;
    var left = timeLeft(g.data, now);
    if (left.label === "Expired") return;
    var name = g.data.title || ("Gate " + g.id);
    if (left.hours !== null && left.hours < NOTIF_SOON_HOURS) add("gate-soon", "soon--" + g.id, name + ": " + left.label, g.data.createdAt, "#/approvals");
    else add("gate", g.id, name + " is waiting for a decision", g.data.createdAt, "#/approvals");
  });
  var latest = {};
  (src.runs || []).forEach(function (r) {
    var d = r.data;
    var cur = latest[d.producer];
    if (!cur || notifMs_(d.startedAt) > notifMs_(cur.data.startedAt)) latest[d.producer] = r;
    if (!recent(d.startedAt)) return;
    var who = notifLabel_(src.producers, d.producer);
    if (d.status === "failed") add("run-failed", "run--" + r.id, who + " run failed", d.startedAt, "#/history/" + encodeURIComponent(r.id));
    if (d.inboxSuppressed > 0) {
      add("cap", "cap--" + r.id, who + " hit the inbox cap: " + d.inboxSuppressed + " messages held back", d.startedAt,
        "#/history/" + encodeURIComponent(r.id));
    }
  });
  (src.producers || []).forEach(function (p) {
    var last = latest[p.id];
    if (last && isLate(last.data.startedAt, p.schedule, new Date(now).toISOString()) === true) {
      add("run-late", "late--" + last.id, notifLabel_(src.producers, p.id) + " is late: no run since " + last.data.startedAt.slice(0, 10),
        last.data.startedAt, "#/history?mode=health");
    }
  });
  out.sort(function (a, b) { return notifMs_(b.at) - notifMs_(a.at) || (a.id < b.id ? -1 : 1); });
  return out.slice(0, NOTIF_MAX);
}

function unreadCount(items) {
  return items.filter(function (n) { return n.unread; }).length;
}

function notifTab(items, tab) {
  return tab === "unread" ? items.filter(function (n) { return n.unread; }) : items;
}

// The panel. opts: {tab, onTab(tab), onClose()}. Mark all read writes each unread item's read state in turn.
function notifPanel(ctx, items, opts) {
  opts = opts || {};
  var tab = opts.tab || "all";
  var status = el("span", { class: "status", role: "status" });
  var shown = notifTab(items, tab);
  var unread = items.filter(function (n) { return n.unread; });
  var markAll = actionButton(ctx, "Mark all read", function () {
    return runBulk(unread.map(function (n) { return { id: n.readId, name: n.title }; }), function (it) {
      return markViewer(ctx, "read", it.id, true);
    }).then(function (res) {
      if (res.failed.length) throw new Error(bulkSummary(res, unread.map(function (n) { return { id: n.readId, name: n.title }; })));
    });
  }, { status: status, icon: "check", disabled: !unread.length });
  return el("aside", { class: "notif-panel", role: "dialog", "aria-label": "Notifications" },
    el("div", { class: "notif-head" }, el("h2", null, "Notifications"),
      opts.onClose ? button("Close", opts.onClose, { icon: "x", iconOnly: true }) : null),
    el("div", { class: "chips", role: "tablist" }, NOTIF_TABS.map(function (t) {
      return el("button", { class: "chip" + (t[0] === tab ? " on" : ""), role: "tab", "aria-selected": t[0] === tab ? "true" : "false",
        onclick: function () { if (opts.onTab) opts.onTab(t[0]); } }, t[1] + (t[0] === "unread" ? " (" + unread.length + ")" : ""));
    })),
    el("div", { class: "actions" }, markAll, status),
    shown.length ? el("ul", { class: "notif-list" }, shown.map(function (n) {
      return el("li", { class: "notif" + (n.unread ? " unread" : ""), "data-kind": n.kind },
        el("a", { href: n.href, onclick: function () { if (n.unread && canWrite(ctx).ok) markViewer(ctx, "read", n.readId, true).catch(function () {}); } }, n.title),
        el("span", { class: "muted" }, " ", when(n.at)));
    })) : el("p", { class: "muted" }, tab === "unread" ? "Nothing unread." : "Nothing new in the last 7 days."),
    el("p", null, el("a", { href: "#/settings?section=notifications" }, "Preferences")));
}

if (typeof module === "object" && module.exports) {
  module.exports = { NOTIF_SOON_HOURS: NOTIF_SOON_HOURS, deriveNotifications: deriveNotifications, unreadCount: unreadCount,
    notifTab: notifTab, notifPanel: notifPanel };
}
