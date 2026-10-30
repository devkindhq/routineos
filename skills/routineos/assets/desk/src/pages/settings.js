/* src/pages/settings.js: per-producer settings, workspace choices and About (spec s8 item 6).
   Settings are human-owned: this page writes settings/<producerId> and settings/workspace only.
   Producers read the values at the start of a run and snapshot them on the run record. */

var SETTINGS_LWW = "Saves from this page are last write wins: if two people change the same thing, the later save is kept.";
var SETTINGS_CAP_TEXT = "25,000";
var WORKSPACE_SETTINGS = "settings/workspace";
// Shared collections a visitor can count. Per-viewer state under data/users/ is private to each person.
var SETTINGS_COUNTED = ["meta", "entities", "runs", "inbox", "pending", "settings", "views", "columns", "userstate", "merges", "decisions", "settingsHistory"];
var NOTIFY_CHOICES = [["inbox", "Inbox only"], ["push", "Inbox plus push"]];

function plainLabel(name) {
  var s = String(name || "").replace(/[_-]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Pure: what to draw for one schema entry and the stored value (undefined falls back to the default).
function controlSpec(entry, value) {
  var kinds = ["toggle", "number", "choice", "list"];
  return {
    kind: kinds.indexOf(entry.type) === -1 ? "text" : entry.type,
    name: entry.name,
    label: entry.label || plainLabel(entry.name),
    value: value === undefined ? entry.default : value,
    // Bracket access: the bundle test rejects the synthetic-domain suffix as a substring.
    example: entry["example"] || "",
    costNote: entry.cost_note || "",
    min: typeof entry.min === "number" ? entry.min : null,
    max: typeof entry.max === "number" ? entry.max : null,
    choices: Array.isArray(entry.choices) ? entry.choices.slice() : [],
  };
}

// "" when the value is allowed, otherwise one plain sentence.
function checkSetting(entry, value) {
  var spec = controlSpec(entry, value);
  if (spec.kind === "number") {
    if (typeof value !== "number" || isNaN(value)) return "Enter a number.";
    if (spec.min !== null && value < spec.min) return "At least " + spec.min + ".";
    if (spec.max !== null && value > spec.max) return "At most " + spec.max + ".";
  }
  if (spec.kind === "choice" && spec.choices.indexOf(value) === -1) return "Choose one of the listed values.";
  return "";
}

function listAdd(list, value) {
  var v = String(value || "").trim();
  var out = (list || []).slice();
  if (!v) return out;
  var lower = v.toLowerCase();
  if (!out.some(function (x) { return String(x).toLowerCase() === lower; })) out.push(v);
  return out;
}

function listRemove(list, value) {
  return (list || []).filter(function (x) { return x !== value; });
}

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function changedValues(loaded, draft) {
  var out = {};
  Object.keys(draft).forEach(function (k) { if (!sameValue(loaded[k], draft[k])) out[k] = draft[k]; });
  return out;
}

// One visible label per control; the example and cost note sit under it as plain text.
function settingControl(entry, value, onChange) {
  var spec = controlSpec(entry, value);
  var id = "set-" + String(spec.name).replace(/[^A-Za-z0-9_-]/g, "-");
  var control;
  if (spec.kind === "toggle") {
    control = el("input", { type: "checkbox", id: id, checked: !!spec.value });
    control.checked = !!spec.value;
    control.addEventListener("change", function () { onChange(!!control.checked); });
  } else if (spec.kind === "number") {
    control = el("input", { type: "number", id: id, min: spec.min, max: spec.max, step: "1", inputmode: "numeric", value: spec.value });
    control.value = String(spec.value);
    control.addEventListener("change", function () { onChange(control.value === "" ? NaN : Number(control.value)); });
  } else if (spec.kind === "choice") {
    control = el("select", { id: id }, spec.choices.map(function (c) {
      return el("option", { value: c, selected: c === spec.value }, c);
    }));
    control.value = spec.value;
    control.addEventListener("change", function () { onChange(control.value); });
  } else if (spec.kind === "list") {
    control = listEditor(id, spec, onChange);
  } else {
    control = el("input", { type: "text", id: id, value: spec.value === undefined ? "" : String(spec.value) });
    control.value = spec.value === undefined ? "" : String(spec.value);
    control.addEventListener("change", function () { onChange(control.value); });
  }
  return el("div", { class: "field setting" + (spec.kind === "toggle" ? " check" : ""), "data-setting": spec.name },
    el("label", { for: id }, spec.label),
    control,
    spec["example"] ? el("span", { class: "muted" }, "Example: " + spec["example"]) : null,
    spec.costNote ? el("span", { class: "muted" }, "Cost: " + spec.costNote) : null);
}

// Chip editor: each value has a labelled remove button; the text box and Add button append.
function listEditor(id, spec, onChange) {
  var values = Array.isArray(spec.value) ? spec.value.slice() : [];
  var chips = el("div", { class: "chips" });
  var input = el("input", { type: "text", id: id, placeholder: spec["example"] ? "Add, for example " + spec["example"] : "Add a value" });
  function draw() {
    clear(chips);
    if (!values.length) append(chips, el("span", { class: "muted" }, "None"));
    values.forEach(function (v) {
      append(chips, el("span", { class: "chip-value" }, String(v), button("Remove " + v, function () {
        values = listRemove(values, v); draw(); onChange(values.slice());
      }, { icon: "x", iconOnly: true })));
    });
  }
  function add() {
    var next = listAdd(values, input.value);
    input.value = "";
    if (next.length === values.length) return;
    values = next;
    draw();
    onChange(values.slice());
  }
  input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); add(); } });
  draw();
  return el("div", { class: "list-editor" }, chips, el("div", { class: "actions" }, input, button("Add", add)));
}

function scheduleText(schedule) {
  return schedule ? schedule + " (cron, UTC)" : "No schedule recorded";
}

var HISTORY_SHOWN = 10;

// Open proposals from inbox for one setting of one producer: no decision, or a snooze that has run out.
function settingSuggestions(msgs, producer, setting, decisions, now) {
  decisions = decisions || {};
  return (msgs || []).filter(function (m) {
    var d = m.data, p = d.proposal;
    if (d.kind !== "proposal" || d.producer !== producer || !p || p.setting !== setting) return false;
    var dec = decisions[m.id];
    return !dec || (dec.decision === "snooze" && !!dec.until && Date.parse(dec.until) <= now);
  }).sort(function (a, b) { var x = a.data.createdAt || "", y = b.data.createdAt || ""; return x === y ? 0 : x < y ? 1 : -1; });
}

function historyLine(e) {
  return Object.keys(e.after || {}).map(function (k) {
    var b = (e.before || {})[k];
    return k + ": " + (b === null || b === undefined ? "(not set)" : JSON.stringify(b)) + " to " + JSON.stringify(e.after[k]);
  }).join("; ");
}

// Recent changes for one settings doc, newest first, each with Revert. onReverted redraws the page.
function historySection(ctx, producer, entries, onReverted) {
  var mine = (entries || []).filter(function (h) { return h.data.producer === producer; }).sort(function (a, b) {
    var x = a.data.at || "", y = b.data.at || ""; return x === y ? 0 : x < y ? 1 : -1;
  });
  var names = [];
  var out = el("details", { class: "history", "data-history": producer },
    el("summary", null, "Recent changes (" + mine.length + ")"),
    mine.length ? el("ul", { class: "rows" }, mine.slice(0, HISTORY_SHOWN).map(function (h) {
      var status = el("span", { class: "status", role: "status" });
      var who = el("span", { "data-person": h.data.by }, personWord(ctx, null, h.data.by));
      names.push(who);
      return el("li", { "data-id": h.id },
        el("span", { class: "muted" }, when(h.data.at), " ", who, " "),
        el("span", { class: "mono" }, historyLine(h.data)),
        el("div", { class: "actions" }, actionButton(ctx, "Revert", function () {
          return writeSettings(ctx, "settings/" + producer, revertChange(h.data)).then(function () { if (onReverted) onReverted(); });
        }, { status: status, done: NEXT_RUN_NOTE }), status));
    })) : el("p", { class: "muted" }, "No changes saved from the Desk yet."),
    el("p", { class: "muted" }, "The newest " + HISTORY_CAP + " changes are kept."));
  fillNames(ctx, names);
  return out;
}

function producerSection(ctx, p, doc) {
  var loaded = (doc && doc.values) || {};
  var draft = {};
  (p.settings || []).forEach(function (s) { draft[s.name] = s.name in loaded ? loaded[s.name] : s.default; });
  var base = Object.assign({}, draft);
  var status = el("span", { class: "status", role: "status" });
  var problems = el("p", { class: "status", role: "status" });
  var extra = ctx.settingsExtra || {};
  var controls = (p.settings || []).map(function (s) {
    var c = settingControl(s, draft[s.name], function (v) { draft[s.name] = v; status.textContent = ""; });
    var open = settingSuggestions(extra.inbox, p.id, s.name, extra.decisions, Date.now());
    if (open.length) {
      append(c, el("div", { class: "inline-suggestions" }, el("span", { class: "muted" }, "Suggested by the routine"),
        el("ul", { class: "items" }, open.map(function (m) { return suggestionCard(ctx, m, null); }))));
    }
    return c;
  });
  function save() {
    var bad = (p.settings || []).map(function (s) {
      var why = checkSetting(s, draft[s.name]);
      return why ? controlSpec(s).label + ": " + why : "";
    }).filter(Boolean);
    problems.textContent = bad.join(" ");
    if (bad.length) return Promise.reject(new Error("fix the values above."));
    var changes = changedValues(base, draft);
    if (!Object.keys(changes).length) return Promise.resolve();
    return writeSettings(ctx, "settings/" + p.id, changes).then(function () { base = Object.assign({}, draft); });
  }
  return el("section", { "data-producer": p.id },
    el("h2", null, p.label || p.id),
    el("p", null, "Schedule: ", el("span", { class: "mono" }, scheduleText(p.schedule)), ". Edit the schedule on the routines page."),
    p.settings && p.settings.length
      ? [el("div", { class: "filters" }, controls), problems,
        el("div", { class: "actions" }, actionButton(ctx, "Save", save, { primary: true, status: status, done: NEXT_RUN_NOTE }), status)]
      : el("p", { class: "muted" }, "This producer has no settings."),
    doc && doc.updatedAt ? el("p", { class: "muted" }, "Last saved " + when(doc.updatedAt)) : null,
    historySection(ctx, p.id, (ctx.settingsExtra || {}).history, ctx.redrawSettings));
}

function workspaceSection(ctx, doc) {
  var values = (doc && doc.values) || {};
  var types = (ctx.definition && ctx.definition.types) || {};
  var notifyStatus = el("span", { class: "status", role: "status" });
  var mergeStatus = el("span", { class: "status", role: "status" });
  var quiet = Object.assign({ from: "", to: "" }, values.quietHours || {});
  var notify = values.notifications || "inbox";
  var from = el("input", { type: "time", value: quiet.from });
  var to = el("input", { type: "time", value: quiet.to });
  from.value = quiet.from; to.value = quiet.to;
  var mergePolicy = Object.assign({}, values.mergePolicy || {});
  var theme = ctx.theme ? ctx.theme() : "system";

  return el("section", { "data-section": "workspace" },
    el("h2", null, "Workspace"),
    el("h3", { id: "notifications" }, "Notifications"),
    el("div", { class: "filters" },
      labelled("Notify me", selectOf(NOTIFY_CHOICES, notify, function (v) { notify = v; }))),
    el("h3", null, "Quiet hours"),
    el("div", { class: "filters" }, labelled("From", from), labelled("To", to)),
    el("p", { class: "muted" }, "No push between these times. Stored. No producer acts on this yet."),
    el("div", { class: "actions" }, actionButton(ctx, "Save notifications", function () {
      return writeSettings(ctx, WORKSPACE_SETTINGS, { notifications: notify, quietHours: { from: from.value, to: to.value } });
    }, { status: notifyStatus }), notifyStatus),

    el("h3", null, "Merge policy"),
    el("p", { class: "muted" }, "Whether records with the same key from different producers are one record or separate ones. Applies from the next run. Existing records are not re-keyed."),
    Object.keys(types).length ? el("div", { class: "filters" }, Object.keys(types).sort().map(function (k) {
      var current = mergePolicy[k] || (types[k].merge === "separate" ? "separate" : "merge");
      return labelled(types[k].plural || types[k].label || k, selectOf([["merge", "Merge into one record"], ["separate", "Keep separate per producer"]], current, function (v) {
        mergePolicy[k] = v;
      }));
    })) : el("p", { class: "muted" }, "No record types yet."),
    Object.keys(types).length ? el("div", { class: "actions" }, actionButton(ctx, "Save merge policy", function () {
      var out = {};
      Object.keys(types).forEach(function (k) { out[k] = mergePolicy[k] || (types[k].merge === "separate" ? "separate" : "merge"); });
      return writeSettings(ctx, WORKSPACE_SETTINGS, { mergePolicy: out });
    }, { status: mergeStatus, done: NEXT_RUN_NOTE }), mergeStatus) : null,

    el("h3", null, "Theme"),
    labelled("Theme on this device", selectOf((ctx.themes || ["system", "light", "dark"]).map(function (t) {
      return [t, t.charAt(0).toUpperCase() + t.slice(1)];
    }), theme, function (v) { if (ctx.setTheme) ctx.setTheme(v); })),
    el("p", { class: "muted" }, "Kept in this browser only."),
    historySection(ctx, "workspace", (ctx.settingsExtra || {}).history, ctx.redrawSettings));
}

function lintText(lint) {
  if (lint === undefined || lint === null) return "Not recorded";
  if (typeof lint === "string") return lint;
  if (lint.ok === true) return "Passed";
  var n = Array.isArray(lint.problems) ? lint.problems.length : 0;
  return lint.ok === false ? n + " problem" + (n === 1 ? "" : "s") : JSON.stringify(lint);
}

// bundle_desk.py puts the plugin.json version here; empty when it is not known.
var DESK_TEMPLATE_VERSION = "__ROUTINEOS_VERSION__";

function aboutSection(ctx) {
  var ws = ctx.workspace || {};
  var defn = ctx.definition || {};
  var count = el("dd", { class: "mono" }, "Counting");
  var made = ws.template
    ? "Created from template " + ws.template + (ws.templateVersion ? " v" + ws.templateVersion : "") + " by routineos new"
    : "Created by routineos new";
  Promise.all(SETTINGS_COUNTED.map(function (c) { return ctx.store.list(c); })).then(function (lists) {
    var n = lists.reduce(function (sum, l) { return sum + l.length; }, 0);
    count.textContent = n.toLocaleString("en") + " of " + SETTINGS_CAP_TEXT + " documents";
  }, function () { count.textContent = "Could not count documents"; });
  return el("section", { "data-section": "about" },
    el("h2", null, "About"),
    el("p", null, made + (ws.createdAt ? ", " + when(ws.createdAt) : "") + "."),
    el("dl", { class: "fieldlist" },
      el("dt", null, "Template"), el("dd", null, ws.template ? ws.template + (ws.templateVersion ? " v" + ws.templateVersion : "") : "None recorded"),
      el("dt", null, "Definition version"), el("dd", { class: "mono" }, defn.version !== undefined ? String(defn.version) : "Not recorded"),
      el("dt", null, "Desk template"), el("dd", { class: "mono" }, /^[0-9]/.test(DESK_TEMPLATE_VERSION) ? "RoutineOS v" + DESK_TEMPLATE_VERSION : "Not recorded"),
      el("dt", null, "Lint at publish"), el("dd", null, lintText(ws.lint)),
      el("dt", null, "Documents"), count),
    el("p", { class: "muted" }, "The count covers shared documents. Each person's read, done and seen marks are private and not counted here."));
}

function renderSettings(outlet, ctx, params) {
  var box = el("div", { class: "page" }, el("h1", null, "Settings"), stateView("loading", { label: "settings" }));
  append(outlet, box);
  var drawn = false;
  var specs = { settings: { collection: "settings" }, inbox: { collection: "inbox" }, decisions: { collection: "decisions" },
    history: { collection: "settingsHistory" } };
  // Drawn once from the first answer: a later change by someone else must not wipe an unsaved edit.
  // A Revert redraws on the next answer, since it changes the values the controls hold.
  return watchAll(ctx, specs, function (got) {
    if (drawn) return;
    drawn = true;
    var docs = byId(got.settings);
    var producers = (ctx.definition && ctx.definition.producers) || [];
    var sctx = Object.assign({}, ctx, { settingsExtra: { inbox: got.inbox, decisions: byId(got.decisions), history: got.history },
      redrawSettings: function () { drawn = false; } });
    clear(box);
    append(box, [
      el("h1", null, "Settings"),
      el("p", null, "Changes apply from the next run. Each run records the values it used."),
      el("p", { class: "notice" }, SETTINGS_LWW),
      producers.length ? producers.map(function (p) { return producerSection(sctx, p, docs[p.id]); }) : el("p", { class: "muted" }, "No producers in this workspace yet."),
      workspaceSection(sctx, docs.workspace),
      aboutSection(sctx),
    ]);
    var section = params && params.query && params.query.section;
    var target = section === "notifications" && box.querySelector ? box.querySelector("#notifications") : null;
    if (target && target.scrollIntoView) target.scrollIntoView();
  }, function () {
    clear(box);
    append(box, [el("h1", null, "Settings"), stateView("read-error", { collection: "settings", onRetry: ctx.retry })]);
  });
}

if (typeof module === "object" && module.exports) {
  module.exports = {
    controlSpec: controlSpec, checkSetting: checkSetting, listAdd: listAdd, listRemove: listRemove,
    changedValues: changedValues, settingControl: settingControl, settingSuggestions: settingSuggestions,
    historySection: historySection,
  };
}
