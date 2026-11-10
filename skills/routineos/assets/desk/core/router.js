// core/router.js: hash routes (spec 4.4). Unknown routes land on Today. Old addresses (#/inbox, #/suggestions,
// #/views, #/history/<id>, #/settings?section=<s>) resolve to their v2 page and carry `redirect`, the address the
// shell swaps in with location.replace so Back does not loop. Queries are kept.
export var SETTINGS_SECTIONS = ["appearance", "notifications", "shortcuts", "routine", "routine-notifications", "members",
  "modules", "views", "tour", "lock", "export", "history", "about"];

// A malformed escape (%%, %zz) gives null, so a hostile address drops that part instead of throwing.
export function safeDecode_(s) {
  try { return decodeURIComponent(s); } catch (e) { return null; }
}

export function parseQuery(qs) {
  var out = {};
  qs.split("&").forEach(function (pair) {
    if (!pair) return;
    var i = pair.indexOf("=");
    var k = safeDecode_(i === -1 ? pair : pair.slice(0, i));
    var v = safeDecode_(i === -1 ? "" : pair.slice(i + 1).replace(/\+/g, " "));
    if (k !== null && v !== null) out[k] = v;
  });
  return out;
}

export function queryString_(q) {
  var keys = Object.keys(q);
  return keys.length ? "?" + keys.map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(q[k]); }).join("&") : "";
}

// The v2 address an old one moves to, or null. seg: decoded segments; q: the raw query; query: parsed.
export function redirectFor_(seg, q, query) {
  var rest = Object.assign({}, query);
  if (seg.length === 1 && (seg[0] === "inbox" || seg[0] === "suggestions")) {
    var proposals = seg[0] === "suggestions" || rest.tab === "suggestions";
    if (seg[0] === "inbox" && rest.tab === "suggestions") delete rest.tab;
    return "#/approvals" + queryString_(proposals ? Object.assign({ kind: "proposals" }, rest) : rest);
  }
  if (seg.length === 1 && seg[0] === "views") return "#/settings/views" + queryString_(rest);
  if (seg.length === 2 && seg[0] === "history") return "#/runs/" + encodeURIComponent(seg[1]) + (q ? "?" + q : "");
  if (seg.length === 1 && seg[0] === "settings" && typeof rest.section === "string" && rest.section) {
    var s = rest.section;
    delete rest.section;
    return "#/settings/" + encodeURIComponent(s) + queryString_(rest);
  }
  return null;
}

export function route(hash) {
    var h = String(hash || "").replace(/^#\/?/, "");
  var q = "";
  var qi = h.indexOf("?");
  if (qi !== -1) {
    q = h.slice(qi + 1);
    h = h.slice(0, qi);
  }
  var seg = h.split("/").filter(Boolean).map(function (x) { var d = safeDecode_(x); return d === null ? x : d; });
  var to = redirectFor_(seg, q, q ? parseQuery(q) : {});
  if (to) {
    var target = route(to);
    target.redirect = to;
    return target;
  }
  var r = { page: "today", params: {} };
  if (seg.length === 1 && ["today", "approvals", "history", "settings", "workers", "runs"].indexOf(seg[0]) !== -1) {
    r = { page: seg[0], params: {} };
  } else if (seg.length === 2 && seg[0] === "settings") {
    r = { page: "settings", params: {} };
  } else if (seg.length === 2 && seg[0] === "browse") {
    r = { page: "browse", params: { type: seg[1] } };
  } else if (seg.length === 3 && seg[0] === "entity") {
    r = { page: "entity", params: { type: seg[1], key: seg[2] } };
  } else if (seg.length === 2 && seg[0] === "runs") {
    r = { page: "run", params: { id: seg[1] } };
  } else if (seg.length >= 2 && seg[0] === "x") {
    r = { page: "ext", params: { name: seg[1], args: seg.slice(2) } };
  } else if (seg.length === 2 && seg[0] === "m") {
    r = { page: "module", params: { id: seg[1] } };
  }
  if (r.page === "settings") r.params.section = SETTINGS_SECTIONS.indexOf(seg[1]) !== -1 ? seg[1] : "appearance";
  if (q && r.page !== "today") r.params.query = parseQuery(q);
  // Approvals: ?t= is a short alias of ?tab=; ?tab= wins when both are given.
  if (r.page === "approvals" && r.params.query && r.params.query.t !== undefined && r.params.query.tab === undefined) {
    r.params.query.tab = r.params.query.t;
  }
  return r;
}
