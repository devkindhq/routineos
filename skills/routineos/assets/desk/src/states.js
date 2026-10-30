/* src/states.js: designed empty, loading and error states (spec s12). Each one says what is true in
   fixed words and offers at most one next action. Loading is static placeholder rows, never animated. */

var SEED_COMMAND = "python3 skills/routineos/scripts/routineos.py seed <routine-folder> --out <batch-dir>";
var PLACEHOLDER_ROWS = 3;

function nextRunLine(n) {
  return n.at ? n.label + " runs next at " + when(n.at) + " UTC." : n.label + " has not run yet. Its schedule is on the routines page.";
}

var INBOX_EMPTY = {
  all: ["No messages yet.", "Routines post here when they find something or need a decision."],
  unread: ["Nothing unread.", "Every message here has been read or marked done."],
  done: ["Nothing marked done yet.", "Messages you mark done move here."],
  snoozed: ["Nothing snoozed.", "Snoozed messages wait here and come back when the snooze ends."],
};

// kind: no-db, not-set-up, first-run, loading, read-error, per-viewer-off, empty-filter, quiet, read-only, inbox-empty.
// d carries the words that vary: collection or plural names, producers, and the callbacks for the action.
function stateView(kind, d) {
  d = d || {};
  switch (kind) {
    case "no-db":
      return el("p", { class: "notice state" }, "This page needs the db capability. Republish it with db declared.");
    case "not-set-up":
      return el("div", { class: "state" },
        el("p", null, (d.name || "This workspace") + " is not set up yet. Once seeded, it shows what its routines find, the messages that need you and each run's health."),
        el("p", null, "Seed it with one command, then apply the batch files it writes in order:"),
        el("pre", { class: "mono" }, SEED_COMMAND));
    case "first-run":
      if (d.next) {
        return el("div", { class: "state" }, el("p", null, "Nothing has run yet."),
          el("ul", { class: "rows" }, d.next.map(function (n) { return el("li", null, nextRunLine(n)); })));
      }
      return el("div", { class: "state" },
        el("p", null, "No " + d.plural + " yet." +
          (d.sources && d.sources.length ? " They appear after " + d.sources.join(" or ") + " runs." : " They appear after a producer run.") +
          (d.settings && d.settings.length ? " Shaped by the setting " + d.settings.join(", ") + "." : "")),
        d.settings && d.settings.length ? el("a", { href: "#/settings" }, "Open Settings") : null);
    case "loading":
      return el("div", { class: "state", "aria-busy": "true" },
        el("p", { class: "muted" }, "Loading " + (d.label || "")),
        el("ul", { class: "placeholder", "aria-hidden": "true" },
          Array.apply(null, Array(PLACEHOLDER_ROWS)).map(function () { return el("li"); })));
    case "read-error":
      return el("div", { class: "notice state", role: "alert" },
        el("p", null, icon("triangle-alert"), " Could not read " + (d.collection || "this page") + "." + (d.whole ? "" : " Other pages still work.")),
        d.onRetry ? button("Try again", d.onRetry) : null);
    case "per-viewer-off":
      return el("p", { class: "muted state" }, NO_VIEWER_NOTE);
    case "empty-filter":
      return el("div", { class: "state" },
        el("p", null, "No " + d.plural + " match these filters."),
        d.onClear ? button("Clear filters", d.onClear) : null);
    case "quiet":
      return el("div", { class: "state" }, el("p", { class: "quiet" }, "Nothing needs you."), d.lastRuns || null);
    case "inbox-empty":
      var words = INBOX_EMPTY[d.filter] || INBOX_EMPTY.all;
      return el("div", { class: "state" }, el("p", { class: "quiet" }, words[0]), el("p", { class: "muted" }, words[1]));
    case "suggestions-empty":
      return el("div", { class: "state" }, el("p", { class: "quiet" }, "No suggestions waiting."),
        el("p", { class: "muted" }, "A routine suggests a change here when what people kept or dropped shows a pattern."));
    case "read-only":
      return el("p", { class: "muted state" }, READ_ONLY_NOTE + ". Changes cannot be saved on this page.");
  }
  return null;
}

if (typeof module === "object" && module.exports) {
  module.exports = { stateView: stateView, SEED_COMMAND: SEED_COMMAND };
}
