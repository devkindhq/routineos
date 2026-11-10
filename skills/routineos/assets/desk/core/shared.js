// core/shared.js: helpers that core files and lazy page modules both use (spec 7.3). Core may reference only core
// names, so these moved here, verbatim, from pages/entity.js (record titles) and pages/workers.js (worker gates and
// decision sources). Their old files re-export them for the Node tests.
export var GATE_WORKER_NOTE = "Only the person who serves this lane can approve it.";
export var LANE_ID_TEXT_RE_ = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export function entityText(v) {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.map(entityText).join(", ");
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// Declared order (meta/definition `order`) first, then any field it does not list.
export function recordKeys(t) {
  var defs = (t && t.fields) || {};
  var keys = ((t && t.order) || []).filter(function (k) { return k in defs; });
  Object.keys(defs).forEach(function (k) { if (keys.indexOf(k) === -1) keys.push(k); });
  return keys;
}

export function recordTitle(t, d) {
  var display = d.display || {};
  // Declared order first, so a role is titled by its title and not by whichever key sorts first.
  var keys = recordKeys(t);
  var summary = keys.filter(function (k) { return t.fields[k].summary; });
  var first = (summary.length ? summary : keys).filter(function (k) { return display[k] !== undefined && display[k] !== ""; })[0];
  return first ? entityText(display[first]) : (d.key || "Record");
}

// Gates without a lane keep today's behavior. A worker gate is approved only by the worker serving that lane.
export function canApproveGate(gate, workersByKey, viewer) {
  if (!gate || !gate.lane) return { ok: true, reason: "" };
  var w = workersByKey && Object.prototype.hasOwnProperty.call(workersByKey, gate.lane) ? workersByKey[gate.lane] : null;
  var ok = !!viewer && !!w && w.status !== "left" && w.by === viewer;
  return { ok: ok, reason: ok ? "" : GATE_WORKER_NOTE };
}

// A display name for a person: "you" for the viewer, the profile name, else "someone". Never an id or an email.
export function personName_(profiles, id, viewer) {
  if (id && id === viewer) return "you";
  var p = profiles && id && Object.prototype.hasOwnProperty.call(profiles, id) ? profiles[id] : null;
  var name = p && typeof p.name === "string" ? p.name.trim() : "";
  return name && name.indexOf("@") === -1 && !/[\x00-\x1f\x7f]/.test(name) ? name : "someone";
}

export function laneIdOf_(laneKey) {
  var id = String(laneKey).split("--")[0];
  return LANE_ID_TEXT_RE_.test(id) ? id : "a";
}

export function joinWords_(parts) {
  if (parts.length < 2) return parts.join("");
  return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
}

// "From 7 decisions by you and 5 by Alex Rivera (sender lane)". Names only when more than one person wrote.
export function sourceLine(sources, profiles, ownerBy, viewer) {
  if (!Array.isArray(sources)) return "";
  var good = sources.filter(function (s) {
    return s && typeof s === "object" && typeof s.source === "string" && typeof s.count === "number" && s.count > 0 && s.count % 1 === 0;
  });
  if (!good.length) return "";
  var people = {};
  if (ownerBy) people[ownerBy] = true;
  good.forEach(function (s) { if (typeof s.by === "string" && s.by) people[s.by] = true; });
  var named = Object.keys(people).length > 1;
  return "From " + joinWords_(good.map(function (s, i) {
    return s.count + (i === 0 ? (s.count === 1 ? " decision" : " decisions") : "") +
      (named ? " by " + personName_(profiles, s.by, viewer) : "") +
      (s.source === "owner" ? "" : " (" + laneIdOf_(s.source) + " lane)");
  }));
}

// Entity doc ids are <type>--<rest>; the route carries both parts.
export function entityHash(id) {
  var s = String(id);
  var i = s.indexOf("--");
  if (i === -1) return "#/today";
  return "#/entity/" + encodeURIComponent(s.slice(0, i)) + "/" + encodeURIComponent(s.slice(i + 2));
}

// The address of a record, carrying the filters of the list it was opened from (query is writeFilterState text).
// A record link without a list leaves the address bare.
export function recordHref(id, query) {
  var h = entityHash(id), q = String(query || "").replace(/^\?/, "");
  return q && h !== "#/today" ? h + "?" + q : h;
}

// A note box [x, y, w, h] as percent strings for the overlay, or null when it cannot be placed: not four finite
// numbers, a side of zero or less, or any part outside the image (0..1 on both axes).
export function noteBox(box) {
  if (!Array.isArray(box) || box.length !== 4) return null;
  for (var i = 0; i < 4; i++) if (typeof box[i] !== "number" || !isFinite(box[i])) return null;
  var x = box[0], y = box[1], w = box[2], h = box[3], e = 1e-9;
  if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1 + e || y + h > 1 + e) return null;
  function pct(n) { return Math.round(n * 1e6) / 1e4 + "%"; }
  return { left: pct(x), top: pct(y), width: pct(w), height: pct(h) };
}

export function producerLabel(definition, id) {
  var ps = (definition && definition.producers) || [];
  for (var i = 0; i < ps.length; i++) if (ps[i].id === id) return ps[i].label || id;
  return id || "";
}

// Icon names the Desk knows (the icon set itself lives in the app).
export var ICON_NAMES = ["badge-check", "bell", "briefcase", "building-2", "calendar", "chart-line", "check", "chevron-down", "circle-help", "columns-3", "desk", "desk-mark", "dot", "download", "external-link", "file-search", "file-text", "filter", "folder", "git-pull-request", "globe", "history", "house", "improve", "inbox", "link", "list", "mail", "menu", "message-square", "monitor", "moon", "newspaper", "package", "panel-left", "pencil", "receipt", "rows-3", "rss", "search", "settings", "star", "star-filled", "sun", "tag", "triangle-alert", "user", "users", "video", "x"];

// Session links render only for claude.ai over https; anything else stays plain text.
export function isClaudeSessionUrl(value) {
  try {
    var u = new URL(String(value));
    var h = u.hostname.toLowerCase();
    return u.protocol === "https:" && (h === "claude.ai" || h.endsWith(".claude.ai"));
  } catch (e) {
    return false;
  }
}

// A note kind for display: a stored "yellow" (older runs) is "warn"; anything unknown is "info".
export function noteKind(k) {
  if (k === "yellow") return "warn";
  return k === "red" || k === "warn" || k === "ok" ? k : "info";
}

// A captured page image draws from the contract's own form (an artifact asset path, /assets/<32 hex>[.ext], the
// shape desk_contract.CAPTURE_IMAGE_RE keeps), data:image and blob: sources, and https. An https source makes the
// viewer's browser contact that host (it sees the viewer's address); the contract never produces one, so it only
// appears when a doc is written outside the contract. Anything else (plain http too) draws nothing.
export function isSafeImageSrc(value) {
  if (typeof value !== "string") return false;
  var v = value.trim();
  if (/^\/(?:assets|_blob)\/[0-9a-f]{32}(?:\.[a-z0-9]{1,5})?$/.test(v)) return true;
  if (/^data:image\//i.test(v)) return true;
  try {
    var p = new URL(v).protocol;
    return p === "https:" || p === "blob:";
  } catch (e) {
    return false;
  }
}
