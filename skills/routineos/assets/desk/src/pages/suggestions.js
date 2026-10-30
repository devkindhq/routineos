/* src/pages/suggestions.js: one card per proposal a routine wrote, open first, then history.
   L1 cards change one item of a setting on Accept; L2 and L3 cards open a PR, so they offer Reject and Snooze only
   and write no setting. The stored title and why are shown as text, never markup. */

// Kept local so the pure functions below load on their own under node.
function suggestionNewest(a, b) {
  var x = a.data.createdAt || "", y = b.data.createdAt || "";
  return x === y ? (a.id < b.id ? -1 : 1) : (x < y ? 1 : -1);
}

function suggestionLevel(p) {
  return p && typeof p === "object" && p.level ? p.level : "L1";
}

// A snooze holds until its until passes; one without until holds for good, as the routine's rejection memory reads it.
function snoozedNow(dec, now) {
  return !!dec && dec.decision === "snooze" && (!dec.until || Date.parse(dec.until) > now);
}

// decisions: {messageId: decision doc}. now in ms. A snooze whose until has passed is open again.
// Open is newest message first; history is newest decision first.
function suggestionList(msgs, decisions, now) {
  var open = [], history = [];
  decisions = decisions || {};
  (msgs || []).filter(function (m) { return m.data.kind === "proposal"; }).sort(suggestionNewest).forEach(function (m) {
    var dec = decisions[m.id];
    var woke = dec && dec.decision === "snooze" && !snoozedNow(dec, now);
    (!dec || woke ? open : history).push(m);
  });
  history.sort(function (a, b) {
    var x = decisions[a.id].at || "", y = decisions[b.id].at || "";
    return x === y ? 0 : (x < y ? 1 : -1);
  });
  return { open: open, history: history };
}

function levelLabel(p) {
  var level = suggestionLevel(p);
  if (level === "L1") return "L1 setting";
  return level + " " + (p.target || (level === "L2" ? "definition" : "workflow")) + ", opens a PR";
}

function itemLine(p) {
  p = p && typeof p === "object" ? p : {};
  if (suggestionLevel(p) !== "L1") return String(p.change || "");
  if (p.op === "add") return "Add " + p.value + " to " + p.setting;
  if (p.op === "remove") return "Remove " + p.value + " from " + p.setting;
  if (p.op === "set") return "Set " + p.setting + " to " + p.value;
  var from = "from" in p ? p.from : p.current, to = "to" in p ? p.to : p.suggested;
  return p.setting + ": " + JSON.stringify(from) + " to " + JSON.stringify(to);
}

// count of `of` is kept records; with runs it is runs under pressure; runs alone is a dead item's quiet streak.
function evidenceLine(e) {
  if (!e || typeof e !== "object") return "";
  var refs = (e.refs || []).length;
  if (e.count !== undefined && e.of !== undefined && e.runs !== undefined) return e.count + " of the last " + e.runs + " runs";
  if (e.count !== undefined && e.of !== undefined) return "Kept " + e.count + " of " + e.of + (refs ? ", " + refs + " records linked" : "");
  if (e.runs !== undefined) return "No match for " + e.runs + " runs";
  return "";
}

function suggestionCard(ctx, m, dec) {
  var d = m.data;
  var p = d.proposal || {};
  var status = el("span", { class: "status", role: "status" });
  var actions = [];
  var decided = dec && (dec.decision !== "snooze" || snoozedNow(dec, Date.now()));
  if (decided) {
    actions.push(el("span", { class: "muted" }, decisionWord(dec) + " " + when(dec.at) + (dec.decision === "snooze" && dec.until ? ", until " + when(dec.until) : "")));
  } else {
    // On a Desk others can join, applying a change is the owner's call (meta/owner).
    if (suggestionLevel(p) === "L1" && (!ctx.join || isDeskOwner(ctx))) actions.push(actionButton(ctx, "Accept", function () { return acceptProposal(ctx, m); }, { primary: true, status: status, done: NEXT_RUN_NOTE }));
    actions.push(actionButton(ctx, "Reject", function () { return rejectProposal(ctx, m); }, { icon: "x", status: status }));
    actions.push(actionButton(ctx, "Snooze", function () { return snoozeProposal(ctx, m); }, { status: status }));
  }
  var refs = ((p.evidence || {}).refs || []);
  var ownerBy = ctx.owner && ctx.owner.by;
  var sources = Array.isArray(p.sources) ? sourceLine(p.sources, {}, ownerBy, ctx.viewer) : "";
  var sourcesNode = sources ? el("p", { class: "muted" }, sources) : null;
  if (sourcesNode && ctx.store && ctx.store.profiles) {
    var ids = p.sources.map(function (x) { return x && x.by; }).filter(function (id, i, a) { return typeof id === "string" && id && a.indexOf(id) === i; });
    if (ids.length) ctx.store.profiles(ids).then(function (prof) { sourcesNode.textContent = sourceLine(p.sources, prof || {}, ownerBy, ctx.viewer); }, function () {});
  }
  return el("li", { class: "item", "data-id": m.id },
    el("div", { class: "item-head" }, badge(levelLabel(p)), " ", itemLine(p) || d.title || "Untitled"),
    evidenceLine(p.evidence) ? el("p", { class: "mono" }, evidenceLine(p.evidence)) : null,
    sourcesNode,
    d.why ? el("p", null, d.why) : null,
    refs.length ? el("p", { class: "refs" }, refs.map(function (id) { return el("a", { href: entityHash(id), title: String(id) }, shortLabel(id)); })) : null,
    el("p", { class: "fields muted" },
      el("span", null, producerLabel(ctx.definition, d.producer)), " ",
      el("time", { datetime: d.createdAt || null }, when(d.createdAt)), " ",
      d.run ? el("a", { href: "#/history/" + encodeURIComponent(d.run) }, "Run " + d.run) : null),
    el("div", { class: "actions" }, actions, status));
}

function renderSuggestions(outlet, ctx) {
  var openList = el("ul", { class: "items" }, el("li", null, stateView("loading", { label: "suggestions" })));
  var historyList = el("ul", { class: "items" });
  var historyHead = el("h2", null, "History");
  append(outlet, el("div", { class: "page" }, el("h1", null, "Suggestions"), openList, historyHead, historyList));
  return watchAll(ctx, { inbox: { collection: "inbox" }, decisions: { collection: "decisions" } }, function (got) {
    var decisions = byId(got.decisions);
    var lists = suggestionList(got.inbox, decisions, Date.now());
    clear(openList);
    clear(historyList);
    if (!lists.open.length) append(openList, el("li", null, stateView("suggestions-empty")));
    lists.open.forEach(function (m) { append(openList, suggestionCard(ctx, m, decisions[m.id])); });
    lists.history.forEach(function (m) { append(historyList, suggestionCard(ctx, m, decisions[m.id])); });
    historyHead.hidden = !lists.history.length;
  }, function () {
    clear(openList);
    append(openList, el("li", null, stateView("read-error", { collection: "suggestions", onRetry: ctx.retry })));
  });
}

if (typeof module === "object" && module.exports) {
  module.exports = { suggestionList: suggestionList, snoozedNow: snoozedNow, levelLabel: levelLabel, itemLine: itemLine, evidenceLine: evidenceLine,
    suggestionCard: suggestionCard };
}
