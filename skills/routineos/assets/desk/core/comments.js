// core/comments.js: where comments live and who wrote them.
// A comment is written only at people/<author>/comments/<entity>--<ts36>, a path the Desk's db rules let nobody but
// <author> write (DESK_DB_RULES). So the AUTHOR IS THE PATH OWNER: a `by` or `entity` field in the document body is
// never believed. Comments written by an earlier Desk sit flat at comments/<entity>--<by>--<ts36>; any `view` writer
// could write those, so they still render but are marked unverified and are never used for identity.
// Readers get the old shape back, {id: "<entity>--<author>--<ts36>", data: {..., by: <author>}, verified}, so
// commentView and the pages above it work on both.
import { save } from "./actions.js";
import { memberId } from "./members.js";

export var LEGACY_COMMENTS = "comments";

export function commentsCollection(author) { return "people/" + author + "/comments"; }

// A time id for a new comment: ms since the epoch in base 36, never the same twice in one page, so two comments
// posted in the same millisecond do not land on the same path and overwrite each other.
var lastTs = 0;
export function nextTs36() {
  var t = Date.now();
  if (t <= lastTs) t = lastTs + 1;
  lastTs = t;
  return t.toString(36);
}

// Writes a comment, and first the marker doc people/<author>: listing people returns only real docs, so the marker is
// what lets other visits find this author. Observed with the owner and with as_level interact (no second real account):
// without it a comment under people/<id>/comments was not listed.
export function saveComment(store, author, path, doc) {
  return save(store, author, "people/" + author, { at: doc.at }).then(function () { return save(store, author, path, doc); });
}

// The document path a person writes a new comment (or an edit or delete of their own) to.
export function commentPath(author, entity, ts36) {
  return commentsCollection(author) + "/" + entity + "--" + ts36;
}

// A doc read from people/<author>/comments as a comment. Author and record come from the path; null when the id has
// no record or time to read.
export function fromPeople(author, doc) {
  var p = String(doc.id).split("--"), ts = p.pop(), entity = p.join("--");
  if (!entity || !ts || !isFinite(parseInt(ts, 36))) return null;
  var data = Object.assign({}, doc.data, { by: author, entity: entity });
  return { id: entity + "--" + author + "--" + ts, path: doc.path, data: data, verified: true };
}

// A doc read from the flat comments/ collection of an earlier Desk: kept as written, marked unverified.
export function fromLegacy(doc) {
  return { id: doc.id, path: doc.path, data: doc.data, verified: false };
}

function uniq(list) {
  var seen = {}, out = [];
  list.forEach(function (x) { if (x && !seen[x]) { seen[x] = 1; out.push(x); } });
  return out;
}

// Whose people/<id>/comments to read. Nothing lists a store's people, so this is a set of ids worth looking at, not
// a statement about anyone: the viewer, the owner, anyone named on other records, and the people collection itself.
// The ids only choose paths to read; a comment is attributed by the path it is found at. But `by` is a field any
// Contributor writes, so the set is capped at MAX_AUTHORS (each id costs a subscription). Order, first kept: the viewer,
// the owner, the people collection (marker docs only their own person can write), then names from decisions,
// settingsHistory and settings in that order, each as the store lists them. Past the cap the later names are dropped.
export var MAX_AUTHORS = 50;
export function candidateAuthors(ctx) {
  var store = ctx.store;
  function names(collection) {
    return Promise.resolve().then(function () { return store.list(collection); }).then(function (rows) {
      var out = [];
      rows.forEach(function (d) {
        var x = d.data || {};
        out.push(x.by, x.updatedBy);
      });
      return out;
    }, function () { return []; });
  }
  function peopleIds() {
    return Promise.resolve().then(function () { return store.list("people"); }).then(function (rows) {
      return rows.map(function (d) { return d.id; });
    }, function () { return []; });
  }
  // Not the flat comments' by: that is a claim in a body any `view` writer could make, so it must not choose paths.
  return Promise.all([names("decisions"), names("settingsHistory"), names("settings"), peopleIds()]).then(function (r) {
    var ids = [ctx.viewer, ctx.owner && ctx.owner.by].concat(r[3], r[0], r[1], r[2]);
    return uniq(ids.map(memberId)).slice(0, MAX_AUTHORS);
  });
}

function merge(legacy, byAuthor) {
  var out = (legacy || []).map(fromLegacy);
  Object.keys(byAuthor).forEach(function (a) {
    byAuthor[a].forEach(function (d) { var c = fromPeople(a, d); if (c) out.push(c); });
  });
  return out;
}

// Every comment, once. entity (optional) keeps only that record's.
export function listComments(ctx, entity) {
  return candidateAuthors(ctx).then(function (ids) {
    var by = {};
    return Promise.all([
      Promise.resolve().then(function () { return ctx.store.list(LEGACY_COMMENTS); }).catch(function () { return []; }),
    ].concat(ids.map(function (a) {
      return Promise.resolve().then(function () { return ctx.store.list(commentsCollection(a)); }).then(function (rows) { by[a] = rows; }, function () { by[a] = []; });
    }))).then(function (r) {
      var all = merge(r[0], by);
      return entity ? all.filter(function (c) { return c.data.entity === entity; }) : all;
    });
  });
}

// Watches every comment. cb gets the merged list once each source has answered, then on every change. A person whose
// comments cannot be read counts as having none; only a failure to start at all reaches onError.
export function watchComments(ctx, cb, onError) {
  var live = true, stops = [], got = {}, waiting = 0;
  function emit() {
    var by = {};
    Object.keys(got).forEach(function (k) { if (k !== "\u0000legacy") by[k] = got[k]; });
    cb(merge(got["\u0000legacy"], by));
  }
  candidateAuthors(ctx).then(function (ids) {
    if (!live) return;
    var keys = ["\u0000legacy"].concat(ids);
    waiting = keys.length;
    keys.forEach(function (k) {
      var first = true;
      function answer(rows) {
        got[k] = rows;
        if (first) { first = false; waiting--; }
        if (waiting === 0 && live) emit();
      }
      try {
        stops.push(ctx.store.subscribe(k === "\u0000legacy" ? LEGACY_COMMENTS : commentsCollection(k), answer, { onError: function () { answer(got[k] || []); } }));
      } catch (e) { answer([]); }
    });
  }, function (e) { if (live && onError) onError(e); });
  return function () { live = false; stops.forEach(function (s) { if (typeof s === "function") s(); }); };
}
