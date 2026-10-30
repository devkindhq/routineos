/* src/pages/history.js: one History page (spec "History"). Modes from ?mode: list (runs, newest first), cal
   (runs by UTC day, like the schedules), health (on time, late, failed, next run) and activity (who did what,
   from people writes that already carry by and at). Reuses the runs.js helpers. Names come from
   store.profiles(ids) at render; only ids are stored, and an id is never shown. */

var HISTORY_MODES = [["list", "List"], ["cal", "Calendar"], ["health", "Health"], ["activity", "Activity"]];
var HISTORY_LIST_MAX = 200;
var ACTIVITY_KINDS = [["decision", "Decisions"], ["settings", "Settings"], ["merge", "Merges"], ["view", "Views"]];
var DECISION_WORDS = { approve: "Approved", reject: "Rejected", dismiss: "Dismissed", accept: "Accepted", drop: "Dropped", keep: "Kept" };
var NOT_PEOPLE = ["agent", "definition", "human"];
var WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function historyMode(params) {
  var m = params && params.query && params.query.mode;
  return HISTORY_MODES.some(function (x) { return x[0] === m; }) ? m : "list";
}

function runsByDay(runs) {
  var out = {};
  (runs || []).forEach(function (r) {
    var s = String(r.data.startedAt || "");
    if (!/^\d{4}-\d\d-\d\d/.test(s)) return;
    (out[s.slice(0, 10)] = out[s.slice(0, 10)] || []).push(r);
  });
  Object.keys(out).forEach(function (k) {
    out[k].sort(function (a, b) { return a.data.startedAt < b.data.startedAt ? 1 : a.data.startedAt > b.data.startedAt ? -1 : 0; });
  });
  return out;
}

// n weeks of UTC dates (YYYY-MM-DD), Monday first, the last week holding now.
function calendarWeeks(now, n) {
  var d = new Date(now);
  var day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  var monday = day - ((d.getUTCDay() + 6) % 7) * 864e5;
  var weeks = [];
  for (var w = n - 1; w >= 0; w--) {
    var row = [];
    for (var k = 0; k < 7; k++) row.push(new Date(monday - w * 7 * 864e5 + k * 864e5).toISOString().slice(0, 10));
    weeks.push(row);
  }
  return weeks;
}

function decisionHref_(id) {
  var s = String(id);
  if (/--g\d+$/.test(s)) return "#/approvals";
  if (/--\d+$/.test(s)) return "#/inbox";
  return entityHash(s);
}

function changedKeys_(before, after) {
  before = before || {};
  after = after || {};
  var keys = {};
  Object.keys(before).concat(Object.keys(after)).forEach(function (k) { keys[k] = true; });
  return Object.keys(keys).sort().filter(function (k) { return JSON.stringify(before[k]) !== JSON.stringify(after[k]); });
}

function isPerson_(by) {
  return typeof by === "string" && by && NOT_PEOPLE.indexOf(by) === -1;
}

// [{at, by, kind, text, href}] newest first; only writes with a person's id and a time.
function activityStream(src) {
  var out = [];
  function add(at, by, kind, text, href) { if (at && isPerson_(by)) out.push({ at: at, by: by, kind: kind, text: text, href: href }); }
  (src.decisions || []).forEach(function (d) {
    var x = d.data;
    var word = DECISION_WORDS[x.decision] || ("Decided " + x.decision + " on");
    add(x.at, x.by, "decision", word + " " + d.id + (x.reason ? ": " + x.reason : ""), decisionHref_(d.id));
  });
  (src.settingsHistory || []).forEach(function (h) {
    var x = h.data;
    var keys = changedKeys_(x.before, x.after);
    add(x.at, x.by, "settings", "Changed " + x.producer + " settings" + (keys.length ? ": " + keys.join(", ") : ""), "#/settings");
  });
  (src.merges || []).forEach(function (m) {
    add(m.data.at, m.data.by, "merge", "Merged " + m.id + " into " + m.data.into, entityHash(m.data.into));
  });
  (src.views || []).forEach(function (v) {
    add(v.data.createdAt, v.data.madeBy, "view", "Saved view " + (v.data.name || v.id), "#/views");
  });
  out.sort(function (a, b) { return a.at === b.at ? 0 : a.at < b.at ? 1 : -1; });
  return out;
}

function filterActivity(items, f) {
  f = f || {};
  return items.filter(function (i) { return (!f.by || i.by === f.by) && (!f.kind || i.kind === f.kind); });
}

function personLabel(ctx, profiles, id) {
  var p = profiles && Object.prototype.hasOwnProperty.call(profiles, id) ? profiles[id] : null;
  if (p && p.name) return p.name;
  return id === ctx.viewer ? "you" : "Someone";
}

// personLabel for the middle of a sentence ("by someone"). Approvals and Settings history use it.
function personWord(ctx, profiles, id) {
  var label = personLabel(ctx, profiles, id);
  return label === "Someone" ? "someone" : label;
}

// Each node carries data-person and is drawn first as "you" or "someone"; the names fill in once
// store.profiles(ids) answers. A page that redraws later keeps its unsaved edits.
function fillNames(ctx, nodes) {
  var ids = nodes.map(function (n) { return n.getAttribute("data-person"); })
    .filter(function (v, i, a) { return v && a.indexOf(v) === i; });
  if (!ids.length || !ctx.store || !ctx.store.profiles) return Promise.resolve();
  return ctx.store.profiles(ids).then(function (p) {
    nodes.forEach(function (n) { n.textContent = personWord(ctx, p || {}, n.getAttribute("data-person")); });
  }, function () {});
}

function modeTabs(mode) {
  return el("nav", { class: "chips", "aria-label": "History mode" }, HISTORY_MODES.map(function (m) {
    return el("a", { class: "chip" + (m[0] === mode ? " on" : ""), href: "#/history" + (m[0] === "list" ? "" : "?mode=" + m[0]),
      "aria-current": m[0] === mode ? "page" : null }, m[1]);
  }));
}

function runListRow(ctx, r) {
  var row = historyRow(r);
  row.insertBefore(el("div", { class: "muted" }, producerLabel(ctx.definition, r.data.producer)), row.firstChild);
  return row;
}

function calendarView(ctx, runs) {
  var days = runsByDay(runs);
  var weeks = calendarWeeks(Date.now(), 5);
  return [el("p", { class: "muted" }, "Days are UTC, like the schedules."),
    el("div", { class: "table-wrap" }, el("table", { class: "calendar" },
      el("thead", null, el("tr", null, WEEKDAYS.map(function (w) { return el("th", { scope: "col" }, w); }))),
      el("tbody", null, weeks.map(function (week) {
        return el("tr", null, week.map(function (date) {
          var mine = days[date] || [];
          return el("td", { "data-date": date },
            el("div", { class: "cal-day" }, date.slice(8, 10)),
            mine.slice(0, 4).map(function (r) {
              return el("a", { class: "cal-run", href: "#/history/" + encodeURIComponent(r.id), title: producerLabel(ctx.definition, r.data.producer) },
                badge(r.data.status || "unknown", runTone(r.data.status)));
            }),
            mine.length > 4 ? el("div", { class: "muted" }, "+" + (mine.length - 4) + " more") : null);
        }));
      }))))];
}

function healthView(ctx, runs) {
  var producers = (ctx.definition && ctx.definition.producers) || [];
  if (!producers.length) return el("p", { class: "muted" }, "No producers in this workspace yet.");
  return [el("p", { class: "muted" }, "Late means the last run is older than twice the time between scheduled runs."),
    el("ul", { class: "rows health" }, producers.map(function (p) {
      var mine = runs.filter(function (r) { return r.data.producer === p.id; });
      var failed = mine.filter(function (r) { return r.data.status === "failed"; }).length;
      var next = nextRun(p.schedule);
      var item = healthItem(p, mine[0] || null);
      append(item, el("div", { class: "fields" },
        el("span", { class: "num" }, mine.length + " runs, " + failed + " failed"),
        el("span", null, "Next run: " + (next ? when(next) + " UTC" : "unknown"))));
      return item;
    }))];
}

function activityView(ctx, box, got) {
  var items = activityStream(got);
  var f = { by: "", kind: "" };
  var ids = items.map(function (i) { return i.by; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
  var list = el("div");
  var profiles = {};
  var who = el("select", { "aria-label": "Person" });
  var kind = el("select", { "aria-label": "Kind" }, el("option", { value: "" }, "Any kind"),
    ACTIVITY_KINDS.map(function (k) { return el("option", { value: k[0] }, k[1]); }));
  function fillWho() {
    clear(who);
    append(who, el("option", { value: "" }, "Anyone"));
    ids.forEach(function (id) {
      var label = personLabel(ctx, profiles, id);
      if (label !== "Someone") append(who, el("option", { value: id }, label));
    });
    who.value = f.by;
  }
  function draw() {
    clear(list);
    var shown = filterActivity(items, f).slice(0, HISTORY_LIST_MAX);
    append(list, shown.length ? el("ul", { class: "rows activity" }, shown.map(function (i) {
      return el("li", { "data-kind": i.kind }, el("span", { class: "muted" }, when(i.at), " "),
        el("b", null, personLabel(ctx, profiles, i.by)), " ", el("a", { href: i.href }, i.text));
    })) : el("p", { class: "muted" }, items.length ? "Nothing matches these filters." : "No one has made a change yet."));
  }
  who.onchange = function () { f.by = who.value; draw(); };
  kind.onchange = function () { f.kind = kind.value; draw(); };
  fillWho();
  draw();
  if (ids.length && ctx.store.profiles) {
    ctx.store.profiles(ids).then(function (p) { profiles = p || {}; fillWho(); draw(); }, function () {});
  }
  return [el("p", { class: "muted" }, "Changes people made, from decisions, settings, merges and views."),
    el("div", { class: "filters" }, el("label", { class: "field" }, el("span", null, "Person"), who),
      el("label", { class: "field" }, el("span", null, "Kind"), kind)), list];
}

function renderHistory(outlet, ctx, params) {
  var mode = historyMode(params);
  var box = el("div", { class: "page" }, el("h1", null, "History"), stateView("loading", { label: "history" }));
  append(outlet, box);
  var specs = mode === "activity"
    ? { decisions: { collection: "decisions" }, settingsHistory: { collection: "settingsHistory" }, merges: { collection: "merges" }, views: { collection: "views" } }
    : { runs: { collection: "runs" } };
  return watchAll(ctx, specs, function (got) {
    clear(box);
    append(box, [el("h1", null, "History"), modeTabs(mode)]);
    if (mode === "activity") { append(box, activityView(ctx, box, got)); return; }
    var runs = runsNewest(got.runs);
    if (mode === "cal") append(box, calendarView(ctx, runs));
    else if (mode === "health") append(box, healthView(ctx, runs));
    else {
      append(box, runs.length
        ? [el("ul", { class: "rows" }, runs.slice(0, HISTORY_LIST_MAX).map(function (r) { return runListRow(ctx, r); })),
          runs.length > HISTORY_LIST_MAX ? el("p", { class: "muted" }, "Showing the newest " + HISTORY_LIST_MAX + " of " + runs.length + " runs.") : null]
        : el("p", { class: "muted" }, "No runs yet."));
    }
  }, function () {
    clear(box);
    append(box, [el("h1", null, "History"), modeTabs(mode), stateView("read-error", { collection: mode === "activity" ? "activity" : "runs", onRetry: ctx.retry })]);
  });
}

if (typeof module === "object" && module.exports) {
  module.exports = { historyMode: historyMode, runsByDay: runsByDay, calendarWeeks: calendarWeeks, activityStream: activityStream,
    filterActivity: filterActivity, personLabel: personLabel, personWord: personWord, fillNames: fillNames, renderHistory: renderHistory };
}
