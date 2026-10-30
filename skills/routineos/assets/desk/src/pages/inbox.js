/* src/pages/inbox.js: every message a producer wrote, newest first (spec s8 item 2).
   Actions follow the message kind; the stored `actions` field is never trusted as markup or code. */

var NEXT_RUN_NOTE = "Saved. Applies from the next run.";
var GATE_NOTE = "Recorded here. A later run acting on it is not piloted.";
var INBOX_FILTERS = [["all", "All"], ["unread", "Unread"], ["done", "Done"], ["snoozed", "Snoozed"]];
var SNOOZE_CHOICES = [["1d", "1 day"], ["3d", "3 days"], ["7d", "7 days"]];
var INBOX_TABS = [["inbox", "Inbox"], ["suggestions", "Suggestions"]];

// Kept local so the pure functions below load on their own under node.
function inboxNewest(field) {
  return function (a, b) {
    var x = a.data[field] || "", y = b.data[field] || "";
    return x === y ? (a.id < b.id ? -1 : 1) : (x < y ? 1 : -1);
  };
}

// "1d", "3d", "7d" from now, or a YYYY-MM-DD date (its local midnight, which must be in the future). ISO or null.
function snoozeUntil(choice, now) {
  var t = now instanceof Date ? now.getTime() : (now === undefined ? Date.now() : new Date(now).getTime());
  var days = { "1d": 1, "3d": 3, "7d": 7 }[choice];
  if (days) return new Date(t + days * 86400000).toISOString();
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(choice || ""));
  if (!m) return null;
  var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getTime() > t ? d.toISOString() : null;
}

// state: {read, done} as Sets and snooze as a Map id -> until, or null without a viewer id (then every
// message shows). An item snoozed past now shows only under "snoozed"; once due it is back everywhere.
function inboxList(msgs, state, filter, now) {
  var out = (msgs || []).slice().sort(inboxNewest("createdAt"));
  if (!state || !state.read || !state.done) return out;
  var at = new Date(now === undefined ? Date.now() : now).toISOString();
  var snoozed = function (m) { var u = state.snooze && state.snooze.get(m.id); return !!u && u > at; };
  if (filter === "snoozed") return out.filter(snoozed);
  out = out.filter(function (m) { return !snoozed(m); });
  if (filter === "all") return out;
  if (filter === "unread") return out.filter(function (m) { return !state.read.has(m.id) && !state.done.has(m.id); });
  if (filter === "done") return out.filter(function (m) { return state.done.has(m.id); });
  return out;
}

// What Mark all read writes: shown items that are neither read nor done.
function unreadIds(shown, state) {
  return (shown || []).filter(function (m) { return !state.read.has(m.id) && !state.done.has(m.id); }).map(function (m) { return m.id; });
}

function inboxTab(params) {
  var t = params && params.query && params.query.tab;
  return t === "suggestions" ? "suggestions" : "inbox";
}

// Exclude-role settings that filter one of the message's referenced types, with the entity's value.
function exclusionCandidates(msg, defn, entitiesById, settingsValues) {
  var m = msg.data;
  var producer = ((defn && defn.producers) || []).filter(function (p) { return p.id === m.producer; })[0];
  if (!producer) return [];
  var excludes = (producer.settings || []).filter(function (s) { return s.role === "exclude"; }).map(function (s) { return s.name; });
  var out = [];
  (m.refs || []).forEach(function (ref) {
    var t = defn.types && defn.types[ref.type];
    var entity = entitiesById[ref.id];
    if (!t || !entity) return;
    (t.settingFilters || []).forEach(function (f) {
      if (f.producer !== m.producer || excludes.indexOf(f.setting) === -1) return;
      var value = (entity.display || {})[f.field];
      if (value === undefined || value === null || value === "") return;
      var list = (settingsValues || {})[f.setting] || [];
      var lower = String(value).toLowerCase();
      // A Role and its Company can carry the same value; offer each exclusion once.
      if (out.some(function (c) { return c.setting === f.setting && String(c.value).toLowerCase() === lower; })) return;
      out.push({
        setting: f.setting, value: value, refId: ref.id,
        already: list.some(function (v) { return String(v).toLowerCase() === lower; }),
      });
    });
  });
  return out;
}

function suppressedLines(runs, defn) {
  return (runs || []).slice().sort(inboxNewest("startedAt")).filter(function (r) {
    return r.data.inboxSuppressed > 0;
  }).map(function (r) {
    var d = r.data;
    var cap = (d.settingsUsed || {}).max_inbox_per_run;
    var label = d.producer;
    ((defn && defn.producers) || []).forEach(function (p) { if (p.id === d.producer) label = p.label || p.id; });
    return { runId: r.id, text: label + ": " + d.inboxSuppressed + " more matched, not sent" + (cap === undefined ? "" : " (cap " + cap + ")") };
  });
}

// One line for a gated message: how it travels, when it times out, how it ended.
function gateLine(gate) {
  if (!gate) return "";
  var line = "Gate by " + (gate.transport || "an unknown transport");
  if (gate.outcome) return line + ", " + (gate.status || "closed") + ": " + gate.outcome + ".";
  return line + (gate.timeoutHours ? ", times out after " + gate.timeoutHours + " hours." : ".");
}

// The mono line under a proposal. Without from or to (a fault in what the routine wrote) it is the setting alone.
function proposalDiff(p) {
  p = normalizeProposal(p);
  if (p.from === undefined || p.to === undefined) return String(p.setting);
  return p.setting + ": " + JSON.stringify(p.from) + " to " + JSON.stringify(p.to);
}

function inboxCard(ctx, m, st) {
  var d = m.data;
  var status = el("span", { class: "status", role: "status" });
  var defn = ctx.definition;
  var actions = [];
  var extra = el("div", { class: "actions" });

  if (st.viewer) {
    var isRead = st.read.has(m.id), isDone = st.done.has(m.id);
    actions.push(actionButton(ctx, isRead ? "Mark unread" : "Mark read", function () { return markViewer(ctx, "read", m.id, !isRead); }, { icon: isRead ? null : "check", status: status }));
    actions.push(actionButton(ctx, isDone ? "Not done" : "Done", function () { return markViewer(ctx, "done", m.id, !isDone); }, { icon: isDone ? null : "check", status: status }));
    actions.push(snoozeControl(ctx, m, st, status));
  }
  var firstRef = (d.refs || [])[0];
  if (firstRef) {
    var starred = !!(st.userstate[firstRef.id] || {}).star;
    actions.push(starToggle(ctx, d.title || shortLabel(firstRef.key || firstRef.id), starred, function () {
      var cur = Object.assign({}, st.userstate[firstRef.id] || {});
      cur.star = !starred;
      return save(ctx.store, ctx.viewer, "userstate/" + firstRef.id, cur);
    }, { status: status }));
  }

  if (d.kind === "proposal") {
    var p = d.proposal || {};
    var dec = st.decisions[m.id];
    if (dec) {
      actions.push(el("span", { class: "muted" }, decisionWord(dec) + " " + when(dec.at)));
    } else {
      // Dismiss counts as a rejection in the routine's memory; L2 and L3 changes are decided on Suggestions.
      actions.unshift(actionButton(ctx, "Dismiss", function () { return decide(ctx, m.id, "dismiss", p.key ? { key: p.key } : null); }, { icon: "x", status: status }));
      if (proposalLevel(p) === "L1") actions.unshift(actionButton(ctx, "Accept", function () { return acceptProposal(ctx, m); }, { primary: true, status: status, done: NEXT_RUN_NOTE }));
    }
  }

  if (d.gate) {
    var gate = st.pending[d.gate];
    var gdec = st.decisions[d.gate];
    var open = !gdec && (!gate || TODAY_OPEN_GATE.indexOf(gate.status) !== -1);
    if (gdec) actions.push(el("span", { class: "muted" }, (gdec.decision === "approve" ? "Approved" : "Rejected") + " " + when(gdec.at)));
    else if (!open) actions.push(el("span", { class: "muted" }, "Gate " + gate.status));
    else {
      actions.unshift(actionButton(ctx, "Reject", function () { return decide(ctx, d.gate, "reject"); }, { icon: "x", status: status }));
      actions.unshift(actionButton(ctx, "Approve", function () { return decide(ctx, d.gate, "approve"); }, { primary: true, status: status }));
    }
  }

  // Exclusion buttons need the referenced entities and the producer's settings; fetched per card.
  if ((d.kind === "match" || d.kind === "alert") && (d.refs || []).length) {
    Promise.all([ctx.store.get("settings/" + d.producer)].concat(d.refs.map(function (r) { return ctx.store.get("entities/" + r.id); })))
      .then(function (docs) {
        var settings = docs[0].exists ? (docs[0].data.values || {}) : {};
        var ents = {};
        docs.slice(1).forEach(function (doc) { if (doc.exists) ents[doc.id] = doc.data; });
        exclusionCandidates(m, defn, ents, settings).forEach(function (c) {
          append(extra, c.already
            ? el("span", { class: "muted" }, c.value + " is already in " + c.setting)
            : actionButton(ctx, "Add " + c.value + " to " + c.setting, function () {
              return addExclusion(ctx, d.producer, c.setting, c.value);
            }, { status: status, done: NEXT_RUN_NOTE }));
        });
      }, function () { /* the card still works without exclusion buttons */ });
  }

  var unread = st.viewer && !st.read.has(m.id) && !st.done.has(m.id);
  return el("li", { class: "item" + (unread ? " unread" : ""), "data-id": m.id },
    el("div", { class: "item-head" }, badge(d.kind), " ", d.title || "Untitled", unread ? el("span", { class: "visually-hidden" }, " (unread)") : null),
    d.why ? el("p", null, d.why) : null,
    d.kind === "proposal" && d.proposal && d.proposal.setting ? el("p", { class: "mono" }, proposalDiff(d.proposal)) : null,
    d.gate && st.pending[d.gate] ? el("p", { class: "muted" }, gateLine(st.pending[d.gate])) : null,
    d.gate ? el("p", { class: "muted" }, GATE_NOTE) : null,
    (d.refs || []).length ? el("p", { class: "refs" }, d.refs.map(function (r) { return el("a", { href: entityHash(r.id), title: String(r.key || r.id) }, shortLabel(r.key || r.id)); })) : null,
    el("p", { class: "fields muted" },
      el("span", null, producerLabel(defn, d.producer)), " ",
      el("time", { datetime: d.createdAt || null }, when(d.createdAt)), " ",
      d.run ? el("a", { href: "#/history/" + encodeURIComponent(d.run) }, "Run " + d.run) : null),
    el("div", { class: "actions" }, actions, status),
    extra);
}

// Snooze for 1, 3 or 7 days or until a date; a snoozed item offers Unsnooze.
function snoozeControl(ctx, m, st, status) {
  var until = st.snooze && st.snooze.get(m.id);
  var path = viewerPath(ctx.viewer, "snooze", m.id);
  if (until && until > new Date().toISOString()) {
    return actionButton(ctx, "Unsnooze", function () { return remove(ctx.store, ctx.viewer, path); }, { status: status });
  }
  var date = el("input", { type: "date", "aria-label": "Snooze until a date" });
  var box = el("details", { class: "snooze" }, el("summary", null, "Snooze"),
    el("div", { class: "actions" }, SNOOZE_CHOICES.map(function (c) {
      return actionButton(ctx, c[1], function () { return snoozeItem(ctx, m.id, snoozeUntil(c[0])); }, { status: status, done: "Snoozed." });
    }), date, actionButton(ctx, "Until date", function () {
      var u = snoozeUntil(date.value);
      if (!u) return Promise.reject(new Error("pick a date after today."));
      return snoozeItem(ctx, m.id, u);
    }, { status: status, done: "Snoozed." })));
  return box;
}

function snoozeMap(docs) {
  var out = new Map();
  (docs || []).forEach(function (d) { if (d.data && d.data.until) out.set(d.id, d.data.until); });
  return out;
}

// Tabs Inbox and Suggestions (#/inbox?tab=suggestions); the Suggestions tab is today's Suggestions page.
function renderInbox(outlet, ctx, params) {
  var tab = inboxTab(params);
  var tabs = el("div", { class: "tabs", role: "tablist", "aria-label": "Inbox" }, INBOX_TABS.map(function (t) {
    return el("a", { role: "tab", href: t[0] === "inbox" ? "#/inbox" : "#/inbox?tab=" + t[0], "aria-selected": String(tab === t[0]),
      class: tab === t[0] ? "tab active" : "tab" }, t[1]);
  }));
  if (tab === "suggestions") {
    append(outlet, tabs);
    return renderSuggestions(outlet, ctx, params);
  }
  var filter = "all";
  var last = null;
  var chips = el("div", { class: "chips", role: "group", "aria-label": "Show" });
  var lines = el("div");
  var list = el("ul", { class: "items" });
  var bulkStatus = el("span", { class: "status", role: "status" });
  var bar = el("div", { class: "actions" });
  append(outlet, el("div", { class: "page" }, el("h1", null, "Inbox"), tabs, chips, bar,
    ctx.viewer ? null : stateView("per-viewer-off"), lines, list));

  function draw() {
    clear(chips);
    INBOX_FILTERS.forEach(function (f) {
      var c = chip(f[1], { pressed: filter === f[0], onClick: function () { filter = f[0]; draw(); } });
      if (f[0] !== "all" && !ctx.viewer) c.disabled = true;
      append(chips, c);
    });
    if (!last) return;
    var st = {
      viewer: !!ctx.viewer, read: idSet(last.read), done: idSet(last.done), snooze: snoozeMap(last.snooze),
      userstate: byId(last.userstate), decisions: byId(last.decisions), pending: byId(last.pending),
    };
    clear(lines);
    suppressedLines(last.runs, ctx.definition).forEach(function (s) { append(lines, el("p", { class: "muted" }, s.text)); });
    var shown = inboxList(last.inbox, st.viewer ? st : null, filter);
    clear(bar);
    var unread = st.viewer ? unreadIds(shown, st) : [];
    if (unread.length) {
      append(bar, [actionButton(ctx, "Mark all read (" + unread.length + ")", function () {
        return runBulk(unread.map(function (id) { return { id: id }; }), function (it) { return markViewer(ctx, "read", it.id, true); }).then(function (res) {
          bulkStatus.textContent = bulkSummary(res, shown.map(function (m) { return { id: m.id, name: m.data.title || m.id }; }));
          if (res.failed.length) throw new Error(bulkStatus.textContent);
        });
      }, { status: bulkStatus }), bulkStatus]);
    }
    clear(list);
    if (!shown.length) append(list, el("li", null, stateView("inbox-empty", { filter: filter })));
    shown.forEach(function (m) { append(list, inboxCard(ctx, m, st)); });
  }
  draw();
  append(list, el("li", null, stateView("loading", { label: "the Inbox" })));
  var specs = withViewerState(ctx, {
    inbox: { collection: "inbox" }, runs: { collection: "runs" }, userstate: { collection: "userstate" },
    decisions: { collection: "decisions" }, pending: { collection: "pending" },
  }, ["read", "done", "snooze"]);
  return watchAll(ctx, specs, function (got) { last = got; draw(); }, function () {
    clear(list);
    append(list, el("li", null, stateView("read-error", { collection: "the Inbox", onRetry: ctx.retry })));
  });
}

if (typeof module === "object" && module.exports) {
  module.exports = { inboxList: inboxList, exclusionCandidates: exclusionCandidates, suppressedLines: suppressedLines, gateLine: gateLine, proposalDiff: proposalDiff,
    snoozeUntil: snoozeUntil, unreadIds: unreadIds, inboxTab: inboxTab };
}
