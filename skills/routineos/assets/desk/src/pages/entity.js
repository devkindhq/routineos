/* src/pages/entity.js: one record (spec s8 item 3). Combined fields, per source values, sighting
   history, links, the viewer's notes, and a hand merge that the next run applies. */

var MERGE_NOTE = "A hand merge is recorded now. Applies from the next run, which folds the two records together.";
var KEEP_NOTE = "A keep is recorded now. Applies from the next run, which keeps this record active.";
var DROP_AGAIN_NOTE = "Drop again is recorded now. Applies from the next run, which applies the settings filters again.";
var KEPT_SIGHTING_NOTE = "kept by person";
var PERSON_DROP_NOTE = "A drop is recorded now. The list hides this record at once; the next run marks it dropped.";
// A declared text field with this name is the record's short summary, shown above Fields.
var SUMMARY_FIELD = "summary";

// The route's key is the doc id after "<type>--"; ids already carry any merge or hash suffix.
function entityIdFromRoute(params) {
  return params.type + "--" + params.key;
}

function sparkPoints(sightings, field) {
  return (sightings || []).filter(function (s) {
    return s.values && typeof s.values[field] === "number" && isFinite(s.values[field]);
  }).map(function (s) { return { at: s.at, v: s.values[field] }; }).sort(function (a, b) {
    return a.at === b.at ? 0 : (a.at < b.at ? -1 : 1);
  });
}

function entityText(v) {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.map(entityText).join(", ");
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function fieldValue(def, v) {
  if (def && def.type === "url" && typeof v === "string") return urlOrText(v);
  return entityText(v);
}

function fieldList(defs, values, keys) {
  var shown = keys.filter(function (k) { var v = values[k]; return v !== undefined && v !== null && v !== ""; });
  if (!shown.length) return el("p", { class: "muted" }, "No values.");
  return el("dl", { class: "fieldlist" }, shown.map(function (k) {
    return [el("dt", null, (defs[k] && defs[k].label) || k), el("dd", null, fieldValue(defs[k], values[k]))];
  }));
}

// Inline SVG line, no axes: first and last values are stated in text beside it.
function sparkline(points, label) {
  var w = 240, h = 48, pad = 4;
  var vs = points.map(function (p) { return p.v; });
  var lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs);
  var span = hi - lo || 1;
  var step = points.length > 1 ? (w - 2 * pad) / (points.length - 1) : 0;
  var pts = points.map(function (p, i) {
    return (pad + i * step).toFixed(1) + "," + (h - pad - ((p.v - lo) / span) * (h - 2 * pad)).toFixed(1);
  }).join(" ");
  return el("figure", { class: "spark" },
    svg("svg", { viewBox: "0 0 " + w + " " + h, width: w, height: h, role: "img", "aria-label": label },
      svg("polyline", { points: pts, fill: "none", stroke: "currentColor", "stroke-width": 2 })),
    el("figcaption", { class: "muted" }, label + ": " + vs[0] + " on " + when(points[0].at) + ", " + vs[vs.length - 1] + " on " + when(points[points.length - 1].at)));
}

function recordTitle(t, d) {
  var display = d.display || {};
  var fields = (t && t.fields) || {};
  // Declared order first, so a role is titled by its title and not by whichever key sorts first.
  var keys = ((t && t.order) || []).filter(function (k) { return k in fields; });
  Object.keys(fields).forEach(function (k) { if (keys.indexOf(k) === -1) keys.push(k); });
  var summary = keys.filter(function (k) { return t.fields[k].summary; });
  var first = (summary.length ? summary : keys).filter(function (k) { return display[k] !== undefined && display[k] !== ""; })[0];
  return first ? entityText(display[first]) : (d.key || "Record");
}

// The linked record named under the heading: a role shows its company. Empty when the type links nothing.
function recordSubtitle(t, d) {
  var display = d.display || {};
  return ((t && t.links) || []).map(function (k) { return display[k]; })
    .filter(function (v) { return v !== undefined && v !== null && v !== ""; }).map(entityText).join(", ");
}

// The record's state once a person's keep is taken into account. A keep is decisions/<entityId>
// {decision: "keep"}; the next run applies it, so until then the stored status still reads dropped.
function keepState(d, keep) {
  if (keep && keep.decision === "drop") return d.status === "dropped" ? "person-dropped" : "person-drop-pending";
  var kept = !!(keep && keep.decision === "keep");
  var latest = (d.sightings || []).slice().sort(function (a, b) { return a.at === b.at ? 0 : (a.at < b.at ? 1 : -1); })[0];
  if (d.status === "dropped") return kept ? "kept-pending" : "dropped";
  if (kept) return "kept";
  return latest && latest.note === KEPT_SIGHTING_NOTE ? "drop-pending" : "active";
}

function keepBadge(state) {
  if (state === "dropped" || state === "person-dropped") return badge("Dropped", "fail");
  if (state === "person-drop-pending") return badge("Drop pending", "warn");
  if (state === "kept-pending") return badge("Kept (pending next run)", "warn");
  if (state === "kept") return badge("Kept", "ok");
  if (state === "drop-pending") return badge("Drop again (pending next run)", "warn");
  return badge("Active", "ok");
}

function statusSection(ctx, id, t, type, d, keep, reload) {
  var state = keepState(d, keep);
  var status = el("span", { class: "status", role: "status" });
  var noun = String(t.label || type).toLowerCase();
  var keepButton = actionButton(ctx, "Keep this " + noun, function () { return decide(ctx, id, "keep").then(reload); }, { status: status, icon: "check" });
  var dropButton = actionButton(ctx, "Drop again", function () { return remove(ctx.store, ctx.viewer, "decisions/" + id).then(reload); }, { status: status });
  var restoreButton = actionButton(ctx, "Restore", function () { return restoreRecord(ctx, id, keep).then(reload); }, { status: status, icon: "check" });
  var reason = d.dropReason || "no reason recorded";
  var given = keep && keep.reason ? shownReason(keep.reason) : "no reason given";
  var body = {
    "dropped": [el("p", { class: "notice" }, "Dropped: " + reason), el("p", { class: "muted" }, "Settings filters dropped this " + noun + ". Keep it to override them for this record.")],
    "kept-pending": [el("p", { class: "notice" }, "Dropped: " + reason), el("p", { class: "muted" }, KEEP_NOTE)],
    "kept": [el("p", { class: "muted" }, "Kept by a person" + (keep && keep.at ? " on " + when(keep.at) : "") + ". Settings filters do not drop this " + noun + ".")],
    "drop-pending": [el("p", { class: "muted" }, DROP_AGAIN_NOTE)],
    "person-dropped": [el("p", { class: "notice" }, "Dropped by a person: " + given)],
    "person-drop-pending": [el("p", { class: "notice" }, "Dropped by a person: " + given), el("p", { class: "muted" }, PERSON_DROP_NOTE)],
    "active": [],
  }[state];
  var act = state === "dropped" || state === "drop-pending" ? keepButton
    : state === "person-dropped" || state === "person-drop-pending" ? restoreButton
    : state === "active" ? null : dropButton;
  return el("section", { class: "keep" }, el("h2", null, "Status"), el("p", null, keepBadge(state)), body,
    act ? el("div", { class: "actions" }, act, status) : null,
    state === "active" || state === "kept" ? dropForm(ctx, id, noun, reload) : null);
}

// Drop with a reason (spec: Drop needs a reason). The reason is stored on decisions/<id>.
function dropForm(ctx, id, noun, reload) {
  var status = el("span", { class: "status", role: "status" });
  var input = el("input", { type: "text", maxlength: "200", "aria-label": "Reason for the drop", placeholder: "Why drop this " + noun + "?" });
  if (!canWrite(ctx).ok) input.disabled = true;
  return el("details", null, el("summary", null, "Drop this " + noun),
    el("label", { class: "field" }, el("span", null, "Reason"), input),
    el("div", { class: "actions" }, actionButton(ctx, "Drop", function () {
      return dropRecord(ctx, id, input.value).then(reload);
    }, { status: status }), status));
}

// The declared fields whose values differ between the record merged away (from) and the one kept (into).
// Each row starts on the kept record's value.
function mergeChoices(t, from, into) {
  var defs = (t && t.fields) || {};
  var keys = ((t && t.order) || []).filter(function (k) { return k in defs; });
  Object.keys(defs).forEach(function (k) { if (keys.indexOf(k) === -1) keys.push(k); });
  var a = (from && from.display) || {}, b = (into && into.display) || {};
  return keys.filter(function (k) {
    return a[k] !== undefined && a[k] !== null && a[k] !== "" && JSON.stringify(a[k]) !== JSON.stringify(b[k]);
  }).map(function (k) { return { field: k, label: defs[k].label || k, from: a[k], into: b[k], pick: "into" }; });
}

// merges/<from>: {into, at, by, fields?}. fields holds only the values picked from the merged-away record;
// the next run shows them on the kept record.
function mergeDoc(into, rows, stampData) {
  var fields = {};
  rows.forEach(function (r) { if (r.pick === "from") fields[r.field] = r.from; });
  var out = Object.assign({ into: into }, stampData);
  if (Object.keys(fields).length) out.fields = fields;
  return out;
}

function notesForm(ctx, id, name, us, reload) {
  var status = el("span", { class: "status", role: "status" });
  var tags = el("input", { type: "text", value: (us.tags || []).join(", "), "aria-label": "Tags, comma separated" });
  var note = el("textarea", { rows: "4", "aria-label": "Note" });
  note.value = us.note || "";
  if (ctx.store.readOnly) { tags.disabled = true; note.disabled = true; }
  function current() {
    return Object.assign({}, us, {
      tags: tags.value.split(",").map(function (s) { return s.trim(); }).filter(Boolean),
      note: note.value,
    });
  }
  return el("section", null,
    el("h2", null, "Your notes"),
    el("div", { class: "actions" },
      starToggle(ctx, name, !!us.star, function () {
        return save(ctx.store, ctx.viewer, "userstate/" + id, Object.assign(current(), { star: !us.star })).then(reload);
      }, { status: status })),
    el("label", { class: "field" }, el("span", null, "Tags, comma separated"), tags),
    el("label", { class: "field" }, el("span", null, "Note"), note),
    el("div", { class: "actions" },
      actionButton(ctx, "Save notes", function () { return save(ctx.store, ctx.viewer, "userstate/" + id, current()).then(reload); }, { primary: true, status: status }),
      status));
}

function mergeSection(ctx, id, type, t, merge, reload, self) {
  var status = el("span", { class: "status", role: "status" });
  var sec = el("section", null, el("h2", null, "Merge"), el("p", { class: "muted" }, MERGE_NOTE));
  if (merge) {
    append(sec, [
      el("p", null, "Merged by hand into ", el("a", { href: entityHash(merge.into) }, merge.into), merge.at ? " on " + when(merge.at) : ""),
      el("div", { class: "actions" }, actionButton(ctx, "Unmerge", function () {
        return remove(ctx.store, ctx.viewer, "merges/" + id).then(reload);
      }, { status: status }), status),
    ]);
    return sec;
  }
  var q = el("input", { type: "search", "aria-label": "Find a " + (t.label || type) + " to merge into", placeholder: "Find a " + (t.label || type) });
  var hits = el("ul", { class: "rows" });
  var all = null;
  function draw() {
    clear(hits);
    var term = q.value.trim().toLowerCase();
    if (!all || !term) return;
    all.filter(function (d) {
      return d.id !== id && (d.id.toLowerCase().indexOf(term) !== -1 || recordTitle(t, d.data).toLowerCase().indexOf(term) !== -1);
    }).slice(0, 10).forEach(function (d) {
      append(hits, el("li", null,
        el("div", { class: "primary-field" }, recordTitle(t, d.data)),
        el("div", { class: "fields mono" }, d.id),
        el("div", { class: "actions" }, el("button", { type: "button", class: "btn", onclick: function () { choose(d); } }, "Merge into this"))));
    });
  }
  // Field choices: one row per differing field, a radio for each side, then one write.
  function choose(target) {
    clear(hits);
    var rows = mergeChoices(t, self, target.data);
    var list = el("div", { class: "merge-choices" }, rows.length ? rows.map(function (r, i) {
      var name = "merge-pick-" + i;
      function opt(side, label) {
        var input = el("input", { type: "radio", name: name, value: side });
        input.checked = r.pick === side;
        input.addEventListener("change", function () { r.pick = side; });
        return el("label", null, input, " ", label + ": " + entityText(r[side] === undefined ? "" : r[side]));
      }
      return el("fieldset", null, el("legend", null, r.label), opt("into", "Keep"), opt("from", "Use this record's"));
    }) : el("p", { class: "muted" }, "No fields differ. The merge keeps the other record's values."));
    append(hits, el("li", null, el("p", null, "Merge into ", el("a", { href: entityHash(target.id) }, recordTitle(t, target.data))), list,
      el("div", { class: "actions" }, actionButton(ctx, "Confirm merge", function () {
        return save(ctx.store, ctx.viewer, "merges/" + id, mergeDoc(target.id, rows, stamp(ctx))).then(reload);
      }, { primary: true, status: status }))));
  }
  q.addEventListener("focus", function () {
    if (all) return;
    ctx.store.list("entities", { where: [["type", "==", type]] }).then(function (docs) { all = docs; draw(); }, function () {
      status.textContent = "Could not load records to merge with.";
    });
  });
  q.addEventListener("input", draw);
  if (ctx.store.readOnly) q.disabled = true;
  append(sec, el("details", null, el("summary", null, "Merge into another " + (t.label || type)), q, hits, status));
  return sec;
}

function renderEntity(outlet, ctx, params) {
  var id = entityIdFromRoute(params);
  var type = params.type;
  var t = (ctx.definition && ctx.definition.types && ctx.definition.types[type]) || { label: type, fields: {} };
  var box = el("div", { class: "page" }, stateView("loading", { label: "this record" }));
  append(outlet, box);
  var live = true;

  function load() {
    return Promise.all([ctx.store.get("entities/" + id), ctx.store.get("userstate/" + id), ctx.store.get("merges/" + id),
      ctx.store.get("decisions/" + id)]).then(function (docs) {
      if (live) draw(docs[0], docs[1].exists ? docs[1].data : {}, docs[2].exists ? docs[2].data : null, docs[3].exists ? docs[3].data : null);
    }, function () {
      if (!live) return;
      clear(box);
      append(box, stateView("read-error", { collection: "this record", onRetry: ctx.retry }));
    });
  }

  function draw(doc, us, merge, keep) {
    clear(box);
    var back = el("a", { href: "#/browse/" + encodeURIComponent(type) }, "Back to " + (t.plural || t.label || type));
    if (!doc.exists) {
      append(box, [back, el("h1", null, "Not found"), el("p", null, "No " + (t.label || type) + " has the id " + id + ". It may have been merged into another record.")]);
      return;
    }
    var d = doc.data;
    var defs = t.fields || {};
    // Declared order first (meta/definition `order`), then any field it does not list.
    var keys = (t.order || []).filter(function (k) { return k in defs; });
    Object.keys(defs).forEach(function (k) { if (keys.indexOf(k) === -1) keys.push(k); });
    var agent = d.agentFields || {};
    var numeric = keys.filter(function (k) { return defs[k].type === "number"; });
    var sightings = (d.sightings || []).slice().sort(function (a, b) { return a.at === b.at ? 0 : (a.at < b.at ? 1 : -1); });
    var summaryText = defs[SUMMARY_FIELD] && defs[SUMMARY_FIELD].type === "text" ? entityText((d.display || {})[SUMMARY_FIELD]) : "";
    var fieldKeys = keys.filter(function (k) { return !(k === SUMMARY_FIELD && defs[k].type === "text"); });

    var title = recordTitle(t, d);
    var subtitle = recordSubtitle(t, d);
    // The key is shown only when no field already shows it (a role's key is its url, listed under Fields).
    var keyShown = keys.some(function (k) { return entityText((d.display || {})[k]) === String(d.key || id); });
    // Two panes (a main column and a side pane, like a GitHub issue): the record on the left, what a person
    // does with it on the right. The pane follows the main column in the DOM, so one column reads in that order.
    var main = el("div", { class: "record-main" },
      el("h1", null, title),
      subtitle ? el("p", { class: "subtitle" }, subtitle) : null,
      el("p", { class: "fields muted" },
        el("span", null, t.label || type), " ",
        keepBadge(keepState(d, keep)),
        keyShown ? null : [" ", el("span", { class: "mono" }, d.key || id)]),

      summaryText ? el("section", { class: "summary" }, el("h2", null, "Summary"), el("p", null, summaryText)) : null,
      el("section", null, el("h2", null, "Fields"), fieldList(defs, d.display || {}, fieldKeys)),
      Object.keys(d.bySource || {}).length ? el("details", null, el("summary", null, "Per source"),
        Object.keys(d.bySource).map(function (p) {
          return [el("h3", null, producerLabel(ctx.definition, p)), fieldList(defs, d.bySource[p] || {}, keys.concat(Object.keys(d.bySource[p] || {}).filter(function (k) { return keys.indexOf(k) === -1; })))];
        })) : null,
      Object.keys(agent).length ? el("section", null, el("h2", null, "Agent fields ", agentBadge()), fieldList({}, agent, Object.keys(agent))) : null,

      el("section", null, el("h2", null, "History"),
        numeric.map(function (k) {
          var pts = sparkPoints(d.sightings, k);
          return pts.length > 1 ? sparkline(pts, (defs[k].label || k)) : null;
        }),
        sightings.length ? el("ul", { class: "rows" }, sightings.slice(0, 50).map(function (s) {
          return el("li", null,
            el("div", { class: "primary-field" }, el("time", { datetime: s.at || null }, when(s.at)), " ", producerLabel(ctx.definition, s.producer)),
            el("div", { class: "fields" },
              s.outcome ? el("span", null, s.outcome) : null,
              s.dropReason ? el("span", null, "Reason: " + s.dropReason) : null,
              s.note ? el("span", null, "Note: " + s.note) : null,
              s.run ? el("a", { href: "#/history/" + encodeURIComponent(s.run) }, "Run " + s.run) : null));
        })) : el("p", { class: "muted" }, "No sightings recorded.")));

    var pane = el("aside", { class: "record-pane", "aria-label": "About this " + String(t.label || type).toLowerCase() },
      statusSection(ctx, id, t, type, d, keep, load),
      notesForm(ctx, id, title, us, load),

      (d.links || []).length ? el("section", null, el("h2", null, "Links"), el("ul", { class: "rows" }, d.links.map(function (l) {
        var lt = ctx.definition && ctx.definition.types && ctx.definition.types[l.type];
        return el("li", null, el("a", { href: entityHash(l.id) }, l.key || l.id), " ", el("span", { class: "muted" }, (lt && lt.label) || l.type));
      }))) : null,

      el("section", null, el("h2", null, "Seen by"),
        el("p", null, (d.sources || []).map(function (p) { return producerLabel(ctx.definition, p); }).join(", ") || "No producer recorded"),
        el("p", { class: "muted" }, "First seen " + when(d.firstSeen) + ", last seen " + when(d.lastSeen) +
          (typeof d.seenCount === "number" ? ", seen " + d.seenCount + (d.seenCount === 1 ? " time" : " times") : ""))),

      mergeSection(ctx, id, type, t, merge, load, d));

    append(box, [back, el("div", { class: "record" }, main, pane)]);
  }

  load();
  return function () { live = false; };
}

if (typeof module === "object" && module.exports) {
  module.exports = { sparkPoints: sparkPoints, entityIdFromRoute: entityIdFromRoute, recordTitle: recordTitle, recordSubtitle: recordSubtitle,
    keepState: keepState, statusSection: statusSection, KEEP_NOTE: KEEP_NOTE, mergeChoices: mergeChoices, mergeDoc: mergeDoc };
}
