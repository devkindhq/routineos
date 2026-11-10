// core/pages/approvals.js: every request the routine is waiting on a person for (spec 5.3), from deriveRequests:
// tabs Waiting, Queued and Done, a kind chip row, one card per request. Recipients are shown by role, never by
// address. Nothing is sent from the Desk: a decision is recorded in decisions/<id> for the routine's next run; a
// worker gate's (it carries its lane key) in the deciding person's own people/<id>/decisions/<id>, the only place
// that worker's run reads it. A decision that wrote only its decision doc can be undone from its toast; a producer
// gate's also from its Queued card, until a run of its producer starts.
import { decide, decidePerson } from "../actions.js";
import { human, untilText } from "../dates.js";
import { listedRoutines, QUEUED_LABEL } from "../queue.js";
import { nextRunFor } from "../schedule.js";

export var APPROVALS_NOTE = "Nothing is sent from the Desk. Decisions are recorded for the routine's next run; a setting change applies right away. Each can be undone from its toast.";
export var UNDO_NOTE = "Back to Waiting. Nothing was sent to the routine.";
export var REPORT_ONLY_NOTE = "Only the owner can decide these.";
export var APPROVAL_SOON_HOURS = 6;
export var MAX_NOTE = 2000;
export var APPROVAL_TABS = [["waiting", "Waiting"], ["queued", "Queued"], ["done", "Done"]];
export var APPROVAL_KINDS = [["all", "All"], ["gates", "Gates"], ["proposals", "Proposals"], ["views", "Views and columns"]];
export var KIND_WORDS = { gate: "Approval", "worker-gate": "Lane approval", "proposal-l1": "Setting", "proposal-l23": "Code change",
  view: "View", column: "Column" };
export var APPROVAL_EMPTY = {
  waiting: ["Nothing is waiting for you", "You will see requests here when the routine asks."],
  queued: ["Nothing queued", "A decided approval waits here until the routine's next run."],
  done: ["No decisions yet", "Decided requests and what the routine did with them show here."],
};

export function gateTime_(g) {
  var t = Date.parse((g && g.createdAt) || "");
  return isNaN(t) ? 0 : t;
}

// {hours, label} left before the gate times out; hours is null without a timeout.
export function timeLeft(gate, now) {
  var h = gate && Number(gate.timeoutHours);
  if (!h) return { hours: null, label: "No timeout" };
  var ms = gateTime_(gate) + h * 3600000 - (now === undefined ? Date.now() : now);
  if (ms <= 0) return { hours: 0, label: "Expired" };
  var hours = Math.floor(ms / 3600000), mins = Math.floor((ms % 3600000) / 60000);
  return { hours: ms / 3600000, label: hours ? hours + "h " + (mins < 10 ? "0" : "") + mins + "m left" : mins + "m left" };
}

// The gate fields a person sees when deciding (desk_contract GATE_KEYS), copied.
export var GATE_KEYS_ = ["transport", "timeoutHours", "correlation", "draft", "recipients"];
export function gateShown_(gate) {
  var out = {};
  GATE_KEYS_.forEach(function (k) { if (k in gate) out[k] = JSON.parse(JSON.stringify(gate[k])); });
  return out;
}

// A worker gate's decision names the gate's item and copies the content shown: the run honours it only while
// pending/ (writable by any Contributor) still holds that item and that content, and sends the copy.
export function gateDecide_(ctx, id, gate, decision, extra) {
  if (!gate || !gate.lane) return decide(ctx, id, decision, extra);
  if (typeof gate.item !== "string" || !gate.item) return Promise.reject(new Error("this approval names no item."));
  return decidePerson(ctx, id, decision, Object.assign({}, extra || {}, { item: gate.item, shown: gateShown_(gate) }));
}

export function noteText_(note) {
  return String(note || "").trim().slice(0, MAX_NOTE);
}

// The edited draft is stored only when it differs from the gate's own; the sending step falls back to the gate's.
// note: the person's instructions with the approval (contract 7g).
export function approveGate(ctx, id, gate, draft, note) {
  // The card is drawn once, so the timeout is checked again at the click (ruling 13).
  if (timeLeft(gate).label === "Expired") return Promise.reject(new Error("this approval timed out."));
  var own = (gate && gate.draft) || null;
  var changed = draft && (!own || draft.subject !== own.subject || draft.body !== own.body);
  var extra = changed ? { draft: { subject: String(draft.subject), body: String(draft.body) } } : {};
  if (noteText_(note)) extra.note = noteText_(note);
  return gateDecide_(ctx, id, gate, "approve", extra);
}

// A reason is optional; when given it is the decision's reason and its note.
export function rejectGate(ctx, id, reason, gate) {
  var r = noteText_(reason);
  return gateDecide_(ctx, id, gate, "reject", r ? { reason: r, note: r } : null);
}

export function recipientLine(recipients) {
  if (!Array.isArray(recipients) || !recipients.length) return "";
  return "To: " + recipients.map(function (r) { return r && r.role; }).filter(Boolean).join(", ") + " (by role)";
}

// A gate that would send something once approved: declining it without a note asks first.
export function gateSends_(gate) {
  return !!(gate && (gate.draft || (Array.isArray(gate.recipients) && gate.recipients.length) || gate.transport));
}

// "Applies at next run: <date> (in 14 hours)" when the producer's schedule parses, else the plain line.
export function queuedLine(definition, producer, now) {
  var next = nextRunFor(definition, producer ? [producer] : null, now);
  if (!next.certain || !next.at) return "Applies at the routine's next run";
  var h = Math.max(0, Math.round((Date.parse(next.at) - now) / 3600000));
  return "Applies at next run: " + human(next.at, now, { style: "sentence" }) + " (in " + untilText(h) + ")";
}

// The state (tab) a request id sits in, or null.
export function tabOf_(list, id) {
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].state;
  return null;
}

export function setLabel_(b, text) {
  var last = b && b.lastChild;
  if (last && last.nodeType === 3) last.textContent = text;
}

export function approvalsHash_(tab, kind) {
  var q = [];
  if (tab !== "waiting") q.push("tab=" + tab);
  if (kind !== "all") q.push("kind=" + kind);
  return "#/approvals" + (q.length ? "?" + q.join("&") : "");
}

// "N queued for next run, <when>" for the page: deriveRequests rows in the queued state plus db request docs
// (requests/<id>) still pending. A handled or decided-and-applied item is not counted. null when none.
export function queuedBanner(requests, definition, now) {
  var n = (requests || []).filter(function (r) {
    return r && (r.state === "queued" || (r.data && r.data.status === "pending"));
  }).length;
  if (!n) return null;
  var next = nextRunFor(definition, listedRoutines(definition), now);
  var line = n + " " + QUEUED_LABEL.toLowerCase();
  if (!next.certain || !next.at) return line;
  var h = Math.max(0, Math.round((Date.parse(next.at) - now) / 3600000));
  return line + ", " + human(next.at, now, { style: "sentence" }) + " (in " + untilText(h) + ")";
}
