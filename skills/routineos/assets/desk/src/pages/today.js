/* src/pages/today.js: what needs the viewer now (spec s8 item 1). One primary action per item. */

var TODAY_MESSAGE_KINDS = ["match", "alert"];
var TODAY_OPEN_GATE = ["waiting", "pending", undefined, null, ""];

function newestFirst(field) {
  return function (a, b) {
    var x = a.data[field] || "", y = b.data[field] || "";
    return x === y ? (a.id < b.id ? -1 : 1) : (x < y ? 1 : -1);
  };
}

// data: {definition, inbox, runs, views, columns, pending, decisions, read, done, ack}; docs are {id, data};
// read, done and ack are Sets, or null when the visit has no viewer id.
function todayItems(data) {
  var decided = new Set((data.decisions || []).map(function (d) { return d.id; }));
  var inbox = (data.inbox || []).slice().sort(newestFirst("createdAt"));
  var items = [];

  var messages = inbox.filter(function (m) { return TODAY_MESSAGE_KINDS.indexOf(m.data.kind) !== -1; });
  if (data.read && data.done) {
    messages.forEach(function (m) {
      if (!data.read.has(m.id) && !data.done.has(m.id)) items.push({ kind: "message", id: m.id, doc: m });
    });
  } else if (messages.length) {
    items.push({ kind: "inbox-count", id: "inbox", count: messages.length });
  }

  var producers = ((data.definition && data.definition.producers) || []);
  var latest = {};
  (data.runs || []).slice().sort(newestFirst("startedAt")).forEach(function (r) {
    if (!latest[r.data.producer]) latest[r.data.producer] = r;
  });
  var lastRuns = producers.map(function (p) {
    var r = latest[p.id];
    return { producer: p.id, label: p.label || p.id, runId: r ? r.id : null, run: r ? r.data : null };
  });
  lastRuns.forEach(function (lr) {
    var bad = lr.run && (lr.run.status === "partial" || lr.run.status === "failed");
    if (bad && !(data.ack && data.ack.has(lr.runId))) items.push({ kind: "run", id: lr.runId, doc: { id: lr.runId, data: lr.run } });
  });

  (data.views || []).forEach(function (v) { if (v.data.state === "proposed") items.push({ kind: "view", id: v.id, doc: v }); });
  (data.columns || []).forEach(function (c) { if (c.data.state === "proposed") items.push({ kind: "column", id: c.id, doc: c }); });

  inbox.forEach(function (m) {
    if (m.data.kind === "proposal" && !decided.has(m.id)) items.push({ kind: "proposal", id: m.id, doc: m });
  });

  (data.pending || []).forEach(function (g) {
    if (TODAY_OPEN_GATE.indexOf(g.data.status) === -1 || decided.has(g.id)) return;
    var msg = inbox.filter(function (m) { return m.data.gate === g.id; })[0] || null;
    items.push({ kind: "gate", id: g.id, doc: g, message: msg });
  });

  return { items: items, lastRuns: lastRuns };
}

function runLine(definition, run) {
  var d = run.data;
  var bits = [producerLabel(definition, d.producer) + " run " + d.status];
  if (typeof d.parsed === "number" && typeof d.claimed === "number") bits.push("parsed " + d.parsed + " of " + d.claimed + " source" + (d.claimed === 1 ? "" : "s"));
  if (d.startedAt) bits.push("started " + when(d.startedAt));
  return bits.join(", ");
}

// The proposal sentence. A proposal stored without from or to (a fault in what the routine wrote) names the
// setting only; without a setting there is no sentence and the card shows its title alone.
function proposalText(producer, p) {
  p = normalizeProposal(p);
  if (!p.setting) return null;
  if (p.from === undefined || p.to === undefined) return producer + " proposes a change to " + p.setting + ".";
  return producer + " proposes " + p.setting + ": from " + JSON.stringify(p.from) + " to " + JSON.stringify(p.to) + ".";
}

function todayItem(ctx, it) {
  var status = el("span", { class: "status", role: "status" });
  var defn = ctx.definition;
  var head, body = null, actions = [];
  if (it.kind === "message") {
    head = [badge(it.doc.data.kind), " ", it.doc.data.title || "Untitled"];
    body = it.doc.data.why || null;
    actions.push(actionButton(ctx, "Mark read", function () { return markViewer(ctx, "read", it.id, true); }, { icon: "check", status: status }));
  } else if (it.kind === "inbox-count") {
    head = it.count === 1 ? "1 message in the Inbox" : it.count + " messages in the Inbox";
    body = NO_VIEWER_NOTE;
    actions.push(el("a", { href: "#/inbox" }, "Open Inbox"));
  } else if (it.kind === "run") {
    head = [badge(it.doc.data.status, it.doc.data.status === "failed" ? "fail" : "warn"), " ", runLine(defn, it.doc)];
    if (ctx.viewer) {
      actions.push(actionButton(ctx, "Acknowledge", function () { return markViewer(ctx, "ack", it.id, true); }, { icon: "check", status: status }));
    } else {
      body = "Acknowledging needs a viewer id, which this visit does not have.";
    }
    actions.push(el("a", { href: "#/history/" + encodeURIComponent(it.id) }, "Open run"));
  } else if (it.kind === "view" || it.kind === "column") {
    head = ["Proposed " + it.kind + ": ", it.doc.data.name || it.id, " ", agentBadge(producerLabel(defn, it.doc.data.producer))];
    // Proposed views and columns are both kept or deleted on the Views page.
    actions.push(el("a", { href: "#/views" }, "Review"));
  } else if (it.kind === "proposal") {
    var p = it.doc.data.proposal || {};
    head = it.doc.data.title || "Setting proposal";
    body = proposalText(producerLabel(defn, it.doc.data.producer), p);
    if (proposalLevel(p) === "L1") actions.push(actionButton(ctx, "Accept", function () { return acceptProposal(ctx, it.doc); }, { primary: true, status: status, done: NEXT_RUN_NOTE }));
    actions.push(actionButton(ctx, "Dismiss", function () { return decide(ctx, it.id, "dismiss"); }, { icon: "x", status: status }));
  } else if (it.kind === "gate") {
    head = (it.message && it.message.data.title) || "Approval waiting";
    body = GATE_NOTE;
    actions.push(actionButton(ctx, "Approve", function () { return decide(ctx, it.id, "approve"); }, { primary: true, status: status }));
    actions.push(actionButton(ctx, "Reject", function () { return decide(ctx, it.id, "reject"); }, { icon: "x", status: status }));
  }
  return el("li", { class: "item", "data-kind": it.kind },
    el("div", { class: "item-head" }, head),
    body ? el("p", { class: "muted" }, body) : null,
    el("div", { class: "actions" }, actions, status));
}

function lastRunList(defn, lastRuns) {
  return el("ul", { class: "rows" }, lastRuns.map(function (lr) {
    return el("li", null,
      el("div", { class: "primary-field" }, lr.label),
      el("div", { class: "fields" }, lr.runId
        ? [el("span", null, "Last run " + when(lr.run.startedAt)), el("span", null, lr.run.status), el("a", { href: "#/history/" + encodeURIComponent(lr.runId) }, "Open run")]
        : el("span", null, "Has not run yet")));
  }));
}

function renderToday(outlet, ctx) {
  var box = el("div", { class: "page" }, el("h1", null, "Today"), stateView("loading", { label: "today" }));
  append(outlet, box);
  var specs = withViewerState(ctx, {
    inbox: { collection: "inbox" }, runs: { collection: "runs" }, views: { collection: "views" },
    columns: { collection: "columns" }, pending: { collection: "pending" }, decisions: { collection: "decisions" },
  }, ["read", "done", "ack"]);
  return watchAll(ctx, specs, function (got) {
    var r = todayItems({
      definition: ctx.definition, inbox: got.inbox, runs: got.runs, views: got.views, columns: got.columns,
      pending: got.pending, decisions: got.decisions,
      read: idSet(got.read), done: idSet(got.done), ack: idSet(got.ack),
    });
    clear(box);
    append(box, el("h1", null, "Today"));
    if (!got.runs.length && !r.items.length) {
      // First run: nothing has run, so name each producer and when it runs next (cron is UTC).
      append(box, stateView("first-run", { next: ((ctx.definition && ctx.definition.producers) || []).map(function (p) {
        return { label: p.label || p.id, at: nextRun(p.schedule) };
      }) }));
    } else if (!r.items.length) {
      append(box, stateView("quiet", { lastRuns: [el("h2", null, "Last run per producer"), lastRunList(ctx.definition, r.lastRuns)] }));
    } else {
      append(box, el("ul", { class: "items" }, r.items.map(function (it) { return todayItem(ctx, it); })));
    }
  }, function () {
    clear(box);
    append(box, [el("h1", null, "Today"), stateView("read-error", { collection: "today's messages and runs", onRetry: ctx.retry })]);
  });
}

if (typeof module === "object" && module.exports) {
  module.exports = { todayItems: todayItems, proposalText: proposalText };
}
