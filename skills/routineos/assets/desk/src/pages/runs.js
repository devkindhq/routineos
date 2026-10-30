/* src/pages/runs.js: health strip, run history and run detail (spec s8 item 5). Read only apart
   from the viewer's own "seen" mark. Schedules are cron in UTC and are edited on the routines page. */

var RUN_DAY = 864e5;
var RUN_COUNTS = [["new", "New"], ["updated", "Updated"], ["unchanged", "Unchanged"], ["dropped", "Dropped"]];

// One cron field as a sorted list of allowed values, or null when it is a form this page does not read.
function cronField(text, lo, hi) {
  var out = {};
  var ok = String(text).split(",").every(function (part) {
    var m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!m) return false;
    var a = m[1] === "*" ? lo : Number(m[2]);
    var b = m[1] === "*" ? hi : m[3] !== undefined ? Number(m[3]) : (m[4] ? hi : a);
    var step = m[4] ? Number(m[4]) : 1;
    if (a < lo || b > hi || a > b || step < 1) return false;
    for (var v = a; v <= b; v += step) out[v] = true;
    return true;
  });
  return ok ? Object.keys(out).map(Number).sort(function (x, y) { return x - y; }) : null;
}

// Minute, hour and day of week; day of month and month must be "*".
function cronParts(schedule) {
  var f = String(schedule || "").trim().split(/\s+/);
  if (f.length !== 5 || f[2] !== "*" || f[3] !== "*") return null;
  var min = cronField(f[0], 0, 59), hour = cronField(f[1], 0, 23), dow = cronField(f[4], 0, 7);
  if (!min || !hour || !dow) return null;
  // Sunday is 0 or 7.
  dow = dow.map(function (v) { return v % 7; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
  return { min: min, hour: hour, dow: dow };
}

// Fire times on the UTC days [fromMs, fromMs + days), fromMs at a UTC midnight.
function fireTimes(c, fromMs, days) {
  var out = [];
  for (var d = 0; d < days; d++) {
    var day = fromMs + d * RUN_DAY;
    if (c.dow.indexOf(new Date(day).getUTCDay()) === -1) continue;
    c.hour.forEach(function (h) { c.min.forEach(function (m) { out.push(day + h * 3600e3 + m * 60e3); }); });
  }
  return out;
}

// The longest gap between two runs over a week, in ms; null when the schedule is not readable.
function scheduleInterval(schedule) {
  var c = cronParts(schedule);
  if (!c) return null;
  var start = Date.UTC(2024, 0, 1); // a Monday
  var t = fireTimes(c, start, 7);
  if (!t.length) return null;
  var gap = t[0] + 7 * RUN_DAY - t[t.length - 1];
  for (var i = 1; i < t.length; i++) gap = Math.max(gap, t[i] - t[i - 1]);
  return gap;
}

// true or false, or null when the schedule or the last run time is unknown.
function isLate(lastRunAt, schedule, now) {
  var gap = scheduleInterval(schedule);
  var last = Date.parse(lastRunAt);
  if (gap === null || !lastRunAt || isNaN(last)) return null;
  var nowMs = now ? Date.parse(now) : Date.now();
  return nowMs - last > 2 * gap;
}

function nextRun(schedule, now) {
  var c = cronParts(schedule);
  if (!c) return null;
  var nowMs = now ? Date.parse(now) : Date.now();
  var d = new Date(nowMs);
  var t = fireTimes(c, Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), 8).filter(function (x) { return x > nowMs; });
  return t.length ? new Date(t[0]).toISOString() : null;
}

function idType(id) {
  var s = String(id || "");
  var i = s.indexOf("--");
  return i === -1 ? "" : s.slice(0, i);
}

// [{reason, count, href}] biggest first. The type comes from the run's dropped sample, else the
// producer's first type; with neither there is no link.
function dropReasonLinks(run, producer) {
  var by = (run && run.droppedByReason) || {};
  var dropped = (run && run.dropped) || [];
  var fallback = (producer && producer.types && producer.types[0]) || "";
  return Object.keys(by).sort(function (a, b) { return by[b] - by[a] || (a < b ? -1 : 1); }).map(function (reason) {
    var sample = dropped.filter(function (d) { return d.reason === reason && idType(d.id); })[0];
    var type = sample ? idType(sample.id) : fallback;
    var p = new URLSearchParams();
    p.set("status", "dropped");
    p.set("reason", reason);
    return { reason: reason, count: by[reason], href: type ? "#/browse/" + encodeURIComponent(type) + "?" + p.toString() : null };
  });
}

function settingsDiff(used, current) {
  used = used || {};
  current = current || {};
  var keys = {};
  Object.keys(used).concat(Object.keys(current)).forEach(function (k) { keys[k] = true; });
  return Object.keys(keys).sort().map(function (k) {
    return { name: k, used: used[k], current: current[k], differs: JSON.stringify(used[k]) !== JSON.stringify(current[k]) };
  });
}

function sourcesLine(run) {
  if (typeof run.parsed !== "number" || typeof run.claimed !== "number") return "";
  return "parsed " + run.parsed + " of " + run.claimed + " source" + (run.claimed === 1 ? "" : "s");
}

function runTone(status) {
  return status === "ok" ? "ok" : status === "failed" ? "fail" : "warn";
}

function runsNewest(docs) {
  return docs.slice().sort(function (a, b) {
    var x = a.data.startedAt || "", y = b.data.startedAt || "";
    return x === y ? (a.id < b.id ? 1 : -1) : (x < y ? 1 : -1);
  });
}

function scheduleLine(p) {
  return [el("span", { class: "mono" }, p.schedule ? p.schedule + " (cron, UTC)" : "No schedule recorded"), ". Edit the schedule on the routines page."];
}

function healthItem(p, last) {
  var late = last ? isLate(last.data.startedAt, p.schedule) : null;
  var lateText = late === true ? "late" : late === false ? "on time" : "unknown";
  return el("li", { "data-producer": p.id },
    el("div", { class: "primary-field" }, p.label || p.id),
    el("div", { class: "fields" },
      last
        ? [el("span", null, "Last run ", el("time", { datetime: last.data.startedAt || null }, when(last.data.startedAt))),
          badge(last.data.status || "unknown", runTone(last.data.status)),
          el("a", { href: "#/history/" + encodeURIComponent(last.id) }, "Open run")]
        : el("span", null, "Has not run yet"),
      el("span", null, "Schedule: ", scheduleLine(p)),
      last ? el("span", null, "Timing: ", badge(lateText, late === true ? "fail" : null)) : null));
}

function historyRow(r) {
  var d = r.data;
  var c = d.counts || {};
  var line = sourcesLine(d);
  return el("li", { "data-run": r.id },
    el("div", { class: "primary-field" }, el("a", { href: "#/history/" + encodeURIComponent(r.id) }, when(d.startedAt) || r.id), " ", badge(d.status || "unknown", runTone(d.status))),
    el("div", { class: "fields" },
      line ? el("span", null, line) : null,
      RUN_COUNTS.map(function (k) { return typeof c[k[0]] === "number" ? el("span", { class: "num" }, c[k[0]] + " " + k[1].toLowerCase()) : null; })));
}

function renderRuns(outlet, ctx) {
  var box = el("div", { class: "page" }, el("h1", null, "Runs"), stateView("loading", { label: "runs" }));
  append(outlet, box);
  return watchAll(ctx, { runs: { collection: "runs" } }, function (got) {
    var runs = runsNewest(got.runs);
    var producers = (ctx.definition && ctx.definition.producers) || [];
    clear(box);
    append(box, [
      el("h1", null, "Runs"),
      el("h2", null, "Health"),
      el("p", { class: "muted" }, "Late means the last run is older than twice the time between scheduled runs."),
      producers.length
        ? el("ul", { class: "rows health" }, producers.map(function (p) {
          return healthItem(p, runs.filter(function (r) { return r.data.producer === p.id; })[0] || null);
        }))
        : el("p", { class: "muted" }, "No producers in this workspace yet."),
      producers.map(function (p) {
        var mine = runs.filter(function (r) { return r.data.producer === p.id; });
        return el("section", { "data-producer": p.id }, el("h2", null, (p.label || p.id) + " history"),
          mine.length ? el("ul", { class: "rows" }, mine.map(historyRow)) : el("p", { class: "muted" }, "No runs yet."));
      }),
    ]);
  }, function () {
    clear(box);
    append(box, [el("h1", null, "Runs"), stateView("read-error", { collection: "runs", onRetry: ctx.retry })]);
  });
}

function currentSettings(definition, producer, doc) {
  var p = ((definition && definition.producers) || []).filter(function (x) { return x.id === producer; })[0];
  var out = {};
  ((p && p.settings) || []).forEach(function (s) { out[s.name] = s.default; });
  return Object.assign(out, (doc && doc.values) || {});
}

function shown(v) {
  return v === undefined ? "(not set)" : JSON.stringify(v);
}

function runDetail(ctx, id, d, settingsDoc, seen) {
  var producer = ((ctx.definition && ctx.definition.producers) || []).filter(function (p) { return p.id === d.producer; })[0] || null;
  var c = d.counts || {};
  var line = sourcesLine(d);
  var drops = dropReasonLinks(d, producer);
  var diff = settingsDiff(d.settingsUsed, currentSettings(ctx.definition, d.producer, settingsDoc));
  var status = el("span", { class: "status", role: "status" });
  var seenBox;
  if (!ctx.viewer) seenBox = el("p", { class: "muted" }, "Mark seen needs a viewer id, which this visit does not have.");
  else if (seen) seenBox = el("p", { class: "muted" }, "You marked this run seen.");
  else seenBox = el("div", { class: "actions" }, actionButton(ctx, "Mark seen", function () { return markViewer(ctx, "ack", id, true); }, { icon: "check", status: status }), status);
  return [
    el("h1", null, producerLabel(ctx.definition, d.producer) + " run"),
    el("p", null, badge(d.status || "unknown", runTone(d.status)), " ",
      "Started ", el("time", { datetime: d.startedAt || null }, when(d.startedAt) || "unknown"),
      d.endedAt ? [", ended ", el("time", { datetime: d.endedAt }, when(d.endedAt))] : null,
      line ? ". This run " + line + "." : "."),
    seenBox,
    el("dl", { class: "fieldlist" }, RUN_COUNTS.map(function (k) {
      return [el("dt", null, k[1]), el("dd", { class: "num" }, typeof c[k[0]] === "number" ? String(c[k[0]]) : "0")];
    }),
    el("dt", null, "Inbox messages"), el("dd", { class: "num" }, String(d.inboxWritten || 0) + (d.inboxSuppressed ? ", " + d.inboxSuppressed + " held back by the cap" : ""))),
    el("section", null, el("h2", null, "Dropped by reason"),
      drops.length ? el("ul", { class: "rows" }, drops.map(function (x) {
        var text = x.count + " " + x.reason;
        return el("li", null, x.href ? el("a", { href: x.href }, text) : text);
      })) : el("p", { class: "muted" }, "Nothing was dropped.")),
    el("section", null, el("h2", null, "What changed"),
      (d.changed || []).length ? el("ul", { class: "refs" }, d.changed.map(function (cid) {
        return el("li", null, idType(cid) ? el("a", { href: entityHash(cid) }, cid) : String(cid));
      })) : el("p", { class: "muted" }, "No records changed.")),
    el("section", null, el("h2", null, "Settings used and now"),
      diff.length ? el("div", { class: "table-wrap" }, el("table", { class: "settings-diff" },
        el("thead", null, el("tr", null, el("th", { scope: "col" }, "Setting"), el("th", { scope: "col" }, "This run"), el("th", { scope: "col" }, "Now"), el("th", { scope: "col" }, "Changed"))),
        el("tbody", null, diff.map(function (row) {
          return el("tr", { class: row.differs ? "differs" : null, "data-setting": row.name },
            el("td", { class: "mono" }, row.name), el("td", { class: "mono" }, shown(row.used)), el("td", { class: "mono" }, shown(row.current)),
            el("td", null, row.differs ? badge("changed since", "warn") : "same"));
        })))) : el("p", { class: "muted" }, "This run recorded no settings.")),
    el("section", null, el("h2", null, "Details"),
      el("dl", { class: "fieldlist" },
        el("dt", null, "Definition version"), el("dd", { class: "mono" }, d.definitionVersion !== undefined ? String(d.definitionVersion) : "Not recorded"),
        el("dt", null, "Merge policy"), el("dd", { class: "mono" }, d.mergePolicy ? JSON.stringify(d.mergePolicy) : "Not recorded"),
        el("dt", null, "Parent run"), el("dd", null, d.parentRun ? el("a", { href: "#/history/" + encodeURIComponent(d.parentRun) }, d.parentRun) : "None"),
        el("dt", null, "Claude session"), el("dd", null, d.sessionUrl
          ? (isClaudeSessionUrl(d.sessionUrl) ? el("a", { href: String(d.sessionUrl), rel: "noopener noreferrer" }, "Open session") : String(d.sessionUrl))
          : "Not recorded"),
        el("dt", null, "Run id"), el("dd", { class: "mono" }, id))),
    el("p", null, el("a", { href: "#/history" }, "All runs")),
  ];
}

function renderRun(outlet, ctx, params) {
  var id = params.id;
  var box = el("div", { class: "page" }, el("h1", null, "Run"), stateView("loading", { label: "the run" }));
  append(outlet, box);
  var specs = withViewerState(ctx, { runs: { collection: "runs" }, settings: { collection: "settings" } }, ["ack"]);
  return watchAll(ctx, specs, function (got) {
    var run = got.runs.filter(function (r) { return r.id === id; })[0];
    clear(box);
    if (!run) {
      append(box, [el("h1", null, "Run"), el("p", { class: "notice" }, "No run with id " + id + "."), el("a", { href: "#/history" }, "All runs")]);
      return;
    }
    var settingsDoc = byId(got.settings)[run.data.producer];
    var seen = !!(got.ack && idSet(got.ack).has(id));
    append(box, runDetail(ctx, id, run.data, settingsDoc, seen));
  }, function () {
    clear(box);
    append(box, [el("h1", null, "Run"), stateView("read-error", { collection: "runs", onRetry: ctx.retry })]);
  });
}

if (typeof module === "object" && module.exports) {
  module.exports = {
    scheduleInterval: scheduleInterval, isLate: isLate, nextRun: nextRun, dropReasonLinks: dropReasonLinks,
    settingsDiff: settingsDiff, sourcesLine: sourcesLine,
  };
}
