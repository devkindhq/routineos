// core/members.js: the people in a workspace, derived (spec 5.9 Members). There is no members list in the store, so
// a person is any id in by or updatedBy on decisions/, settingsHistory/ and settings/, any id under
// data/users/<id>/, plus meta/owner.by and the viewer. meta/join is the worker join card and is not read.
export var MEMBER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
// Comments are not a source: a comment grants no membership (an earlier Desk let any viewer write a `by` there).
export var MEMBER_SOURCES = ["decisions", "settingsHistory", "settings"];

export function memberId(id) { return typeof id === "string" && id !== "seed" && MEMBER_ID_RE.test(id) ? id : null; }

// docs: {path: {data}}. Returns [{id, role: "Owner"|"Member", lastActive: iso|null}], the owner first, then the
// newest activity first, people with none last.
export function deriveMembers(docs, ownerId, viewerId) {
  var seen = {};
  function note(id, at) {
    id = memberId(id);
    if (!id) return;
    if (!(id in seen)) seen[id] = null;
    if (typeof at === "string" && !isNaN(Date.parse(at)) && (seen[id] === null || Date.parse(at) > Date.parse(seen[id]))) seen[id] = at;
  }
  Object.keys(docs || {}).forEach(function (path) {
    var parts = path.split("/");
    var data = (docs[path] && docs[path].data) || {};
    var at = data.at || data.updatedAt;
    if (parts[0] === "data" && parts[1] === "users") { note(parts[2], at); return; }
    if (MEMBER_SOURCES.indexOf(parts[0]) === -1) return;
    note(data.by, at);
    if (data.updatedBy !== data.by) note(data.updatedBy, at);
  });
  note(ownerId, null);
  note(viewerId, null);
  var owner = memberId(ownerId);
  return Object.keys(seen).map(function (id) { return { id: id, role: id === owner ? "Owner" : "Member", lastActive: seen[id] }; })
    .sort(function (a, b) {
      if ((a.role === "Owner") !== (b.role === "Owner")) return a.role === "Owner" ? -1 : 1;
      var x = a.lastActive ? Date.parse(a.lastActive) : -Infinity, y = b.lastActive ? Date.parse(b.lastActive) : -Infinity;
      return x !== y ? y - x : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
}

// The person to show as a record's owner: who decided it, else null. decisions is a Map or a plain object keyed by
// record id. A comment never makes anyone an owner: its author is whoever wrote to a path, which says who spoke, not
// who owns the record. The third argument is kept so callers that still pass comments do not change.
export function ownerOf(recordKey, decisions) {
  var d = decisions instanceof Map ? decisions.get(recordKey) : decisions ? decisions[recordKey] : null;
  d = d && d.data ? d.data : d;
  if (d && typeof d.by === "string" && d.by) return { id: d.by, name: d.by };
  return null;
}
