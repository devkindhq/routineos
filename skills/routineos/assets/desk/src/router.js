/* src/router.js: hash routes from spec s8 plus Desk v2. Unknown routes land on Today. The old #/runs routes
   still resolve and carry `redirect`, the History address the shell replaces them with. */

function parseQuery(qs) {
  var out = {};
  qs.split("&").forEach(function (pair) {
    if (!pair) return;
    var i = pair.indexOf("=");
    var k = i === -1 ? pair : pair.slice(0, i);
    var v = i === -1 ? "" : pair.slice(i + 1);
    out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, " "));
  });
  return out;
}

function route(hash) {
  if (hash === undefined) hash = globalThis.location ? globalThis.location.hash : "";
  var h = String(hash || "").replace(/^#\/?/, "");
  var q = "";
  var qi = h.indexOf("?");
  if (qi !== -1) {
    q = h.slice(qi + 1);
    h = h.slice(0, qi);
  }
  var seg = h.split("/").filter(Boolean).map(decodeURIComponent);
  var r = { page: "today", params: {} };
  if (seg.length === 1 && seg[0] === "runs") {
    r = { page: "history", params: {}, redirect: "#/history" };
  } else if (seg.length === 1 && ["today", "inbox", "approvals", "suggestions", "views", "history", "settings", "workers"].indexOf(seg[0]) !== -1) {
    r = { page: seg[0], params: {} };
  } else if (seg.length === 2 && seg[0] === "browse") {
    r = { page: "browse", params: { type: seg[1] } };
  } else if (seg.length === 3 && seg[0] === "entity") {
    r = { page: "entity", params: { type: seg[1], key: seg[2] } };
  } else if (seg.length === 2 && seg[0] === "history") {
    r = { page: "run", params: { id: seg[1] } };
  } else if (seg.length === 2 && seg[0] === "runs") {
    r = { page: "run", params: { id: seg[1] }, redirect: "#/history/" + encodeURIComponent(seg[1]) };
  }
  if (q && r.page !== "today") r.params.query = parseQuery(q);
  return r;
}

function go(hash) {
  globalThis.location.hash = hash;
}

if (typeof module === "object" && module.exports) {
  module.exports = { route: route, go: go, parseQuery: parseQuery };
}
