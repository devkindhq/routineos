/* src/pages/approvals.js: gates a run wrote to pending/<id>, waiting for a person (spec "Inbox, Suggestions,
   Approvals"). Approve, Reject with a reason, Edit draft where the gate carries one, and a decided history.
   Recipients are shown by role, never by address. Nothing is sent from the Desk: the decision is recorded in
   decisions/<pendingId> for the routine's next run; a worker gate's (it carries its lane key) in the deciding
   person's own people/<id>/decisions/<pendingId>, the only place that worker's run reads it. */

var APPROVALS_NOTE = "Nothing is sent from the Desk. Your decision is recorded for the routine's next run.";

function gateTime_(g) {
  var t = Date.parse((g && g.createdAt) || "");
  return isNaN(t) ? 0 : t;
}

// {hours, label} left before the gate times out; hours is null without a timeout.
function timeLeft(gate, now) {
  var h = gate && Number(gate.timeoutHours);
  if (!h) return { hours: null, label: "No timeout" };
  var ms = gateTime_(gate) + h * 3600000 - (now === undefined ? Date.now() : now);
  if (ms <= 0) return { hours: 0, label: "Expired" };
  var hours = Math.floor(ms / 3600000), mins = Math.floor((ms % 3600000) / 60000);
  return { hours: ms / 3600000, label: hours ? hours + "h " + (mins < 10 ? "0" : "") + mins + "m left" : mins + "m left" };
}

// pending: pending/ docs; decisions: {id: decision data}. waiting: still pending, no decision yet, soonest timeout
// first. decided: everything else, newest decision (or gate) first. Each row is {id, gate, decision}.
function approvalLists(pending, decisions, now) {
  var waiting = [], decided = [];
  (pending || []).forEach(function (d) {
    var row = { id: d.id, gate: d.data, decision: (decisions || {})[d.id] || null };
    if (!row.decision && (d.data.status || "pending") === "pending") waiting.push(row);
    else decided.push(row);
  });
  function ends(r) { var t = timeLeft(r.gate, now); return t.hours === null ? Infinity : t.hours; }
  waiting.sort(function (a, b) { return ends(a) - ends(b) || (a.id < b.id ? -1 : 1); });
  function at(r) { return (r.decision && r.decision.at) || r.gate.createdAt || ""; }
  decided.sort(function (a, b) { return at(a) === at(b) ? (a.id < b.id ? -1 : 1) : (at(a) < at(b) ? 1 : -1); });
  return { waiting: waiting, decided: decided };
}

// {id: decision data}. A gate without a lane takes its decision from the shared decisions/. A worker gate takes it only
// from mine (people/<viewer>/decisions/), and only when the viewer serves that lane and the doc names them: a shared
// decisions/<id> anyone could write is never shown as that gate's decision.
function gateDecisions(pending, shared, workersByKey, mine, viewer) {
  var sharedById = byId(shared), mineById = byId(mine), out = {};
  (pending || []).forEach(function (d) {
    var lane = d.data && d.data.lane;
    if (!lane) { if (sharedById[d.id]) out[d.id] = sharedById[d.id]; return; }
    var w = (workersByKey || {})[lane];
    var m = mineById[d.id];
    if (viewer && w && w.by === viewer && m && m.by === viewer) out[d.id] = m;
  });
  return out;
}

// The gate fields a person sees when deciding (desk_contract GATE_KEYS), copied.
var GATE_KEYS_ = ["transport", "timeoutHours", "correlation", "draft", "recipients"];
function gateShown_(gate) {
  var out = {};
  GATE_KEYS_.forEach(function (k) { if (k in gate) out[k] = JSON.parse(JSON.stringify(gate[k])); });
  return out;
}

// A worker gate's decision names the gate's item and copies the content shown: the run honours it only while
// pending/ (writable by any Contributor) still holds that item and that content, and sends the copy.
function gateDecide_(ctx, id, gate, decision, extra) {
  if (!gate || !gate.lane) return decide(ctx, id, decision, extra);
  if (typeof gate.item !== "string" || !gate.item) return Promise.reject(new Error("this approval names no item."));
  return decidePerson(ctx, id, decision, Object.assign({}, extra || {}, { item: gate.item, shown: gateShown_(gate) }));
}

// The edited draft is stored only when it differs from the gate's own; the sending step falls back to the gate's.
function approveGate(ctx, id, gate, draft) {
  // The card is drawn once, so the timeout is checked again at the click (ruling 13).
  if (timeLeft(gate).label === "Expired") return Promise.reject(new Error("this approval timed out."));
  var own = (gate && gate.draft) || null;
  var changed = draft && (!own || draft.subject !== own.subject || draft.body !== own.body);
  return gateDecide_(ctx, id, gate, "approve", changed ? { draft: { subject: String(draft.subject), body: String(draft.body) } } : null);
}

function rejectGate(ctx, id, reason, gate) {
  var r = String(reason || "").trim();
  if (!r) return Promise.reject(new Error("give a reason for the rejection."));
  return gateDecide_(ctx, id, gate, "reject", { reason: r });
}

function recipientLine(recipients) {
  if (!Array.isArray(recipients) || !recipients.length) return "";
  return "To: " + recipients.map(function (r) { return r && r.role; }).filter(Boolean).join(", ") + " (by role)";
}

function approvalCard(ctx, row, now) {
  var g = row.gate;
  var status = el("span", { class: "status", role: "status" });
  var left = timeLeft(g, now);
  var expired = left.label === "Expired";
  var subject = el("input", { type: "text", "aria-label": "Draft subject" });
  var body = el("textarea", { rows: "8", "aria-label": "Draft body" });
  if (g.draft) { subject.value = g.draft.subject; body.value = g.draft.body; }
  var editing = false;
  var draftBox = el("div", { class: "draft" });
  function drawDraft() {
    clear(draftBox);
    if (!g.draft) return;
    if (editing) append(draftBox, [el("label", { class: "field" }, el("span", null, "Subject"), subject), el("label", { class: "field" }, el("span", null, "Body"), body)]);
    else append(draftBox, [el("p", null, el("b", null, subject.value)), el("p", { class: "pre" }, body.value)]);
  }
  drawDraft();
  var reason = el("input", { type: "text", maxlength: "200", "aria-label": "Reason for the rejection", placeholder: "Why reject?" });
  var rejectBox = el("details", null, el("summary", null, "Reject"), el("label", { class: "field" }, el("span", null, "Reason"), reason),
    el("div", { class: "actions" }, actionButton(ctx, "Reject", function () { return rejectGate(ctx, row.id, reason.value, g); }, { status: status, icon: "x" })));
  var tone = expired ? "fail" : left.hours !== null && left.hours < 6 ? "warn" : "ok";
  // A worker gate (it carries its lane key) is decided only by the person serving that lane.
  var may = canApproveGate(g, ctx.workersByKey || {}, ctx.viewer);
  var controls = may.ok ? [
    actionButton(ctx, "Approve", function () { return approveGate(ctx, row.id, g, g.draft ? { subject: subject.value, body: body.value } : null); },
      { primary: true, status: status, icon: "check", disabled: expired }),
    g.draft ? button(editing ? "Done editing" : "Edit draft", function (e) { editing = !editing; drawDraft(); e.target.textContent = editing ? "Done editing" : "Edit draft"; }) : null,
    rejectBox, status] : el("p", { class: "muted" }, may.reason);
  return el("li", { class: "item approval", "data-id": row.id },
    el("div", { class: "item-head" }, badge(left.label, tone), " ", g.title || ("Gate " + row.id)),
    el("p", { class: "muted" }, gateLine(g), " ", el("a", { href: "#/history/" + encodeURIComponent(g.run || "") }, "Run " + (g.run || "")),
      recipientLine(g.recipients) ? [" ", el("span", null, recipientLine(g.recipients))] : null),
    draftBox,
    el("div", { class: "actions" }, controls));
}

// names collects each person node for fillNames. An id is never shown (user.d.ts).
function decidedItem(ctx, row, names) {
  var d = row.decision || {};
  var word = d.decision || row.gate.outcome || row.gate.status || "closed";
  var tone = word === "approve" || word === "approved" ? "ok" : word === "reject" || word === "rejected" ? "fail" : "warn";
  var who = d.by ? el("span", { "data-person": d.by }, personWord(ctx, null, d.by)) : null;
  if (who) names.push(who);
  return el("li", { class: "item", "data-id": row.id },
    el("div", { class: "item-head" }, badge(word, tone), " ", row.gate.title || ("Gate " + row.id)),
    el("p", { class: "muted" }, d.at ? ["Decided " + when(d.at), who ? [" by ", who] : ""] : gateLine(row.gate),
      d.reason ? " Reason: " + d.reason : "", d.draft ? " Approved with an edited draft." : ""));
}

function renderApprovals(outlet, ctx) {
  var box = el("div", { class: "page" }, el("h1", null, "Approvals"), stateView("loading", { label: "approvals" }));
  append(outlet, box);
  var specs = { pending: { collection: "pending" }, decisions: { collection: "decisions" }, workers: { collection: "workers" } };
  if (ctx.viewer) specs.mine = { collection: "people/" + ctx.viewer + "/decisions" };
  return watchAll(ctx, specs, function (got) {
    var workersByKey = byId(got.workers);
    var decisions = gateDecisions(got.pending, got.decisions, workersByKey, got.mine, ctx.viewer);
    var cardCtx = Object.assign({}, ctx, { workersByKey: workersByKey });
    var now = Date.now();
    var l = approvalLists(got.pending, decisions, now);
    var names = [];
    clear(box);
    append(box, [el("h1", null, "Approvals"),
      el("p", { class: "muted" }, "Gates a run wrote. Approve, edit the draft or reject each one before it times out. Recipients are shown by role only."),
      el("section", null, el("h2", null, "Waiting for a decision (" + l.waiting.length + ")"),
        l.waiting.length ? el("ul", { class: "items" }, l.waiting.map(function (r) { return approvalCard(cardCtx, r, now); }))
          : el("p", { class: "muted" }, "Nothing waiting. A run writes a gate here when it needs a person's yes.")),
      el("p", { class: "muted" }, APPROVALS_NOTE),
      el("section", null, el("h2", null, "Decided (" + l.decided.length + ")"),
        l.decided.length ? el("ul", { class: "items" }, l.decided.slice(0, 50).map(function (r) { return decidedItem(ctx, r, names); }))
          : el("p", { class: "muted" }, "No decisions yet."))]);
    fillNames(ctx, names);
  }, function () {
    clear(box);
    append(box, [el("h1", null, "Approvals"), stateView("read-error", { collection: "approvals", onRetry: ctx.retry })]);
  });
}

if (typeof module === "object" && module.exports) {
  module.exports = { timeLeft: timeLeft, approvalLists: approvalLists, approveGate: approveGate, rejectGate: rejectGate,
    recipientLine: recipientLine, approvalCard: approvalCard, decidedItem: decidedItem, renderApprovals: renderApprovals,
    gateDecisions: gateDecisions };
}
