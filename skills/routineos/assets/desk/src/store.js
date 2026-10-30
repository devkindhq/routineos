/* src/store.js: the only module that knows about claude.use.
   Platform shapes follow the artifact-capabilities type definitions, contract 0.2.92 (db.d.ts, user.d.ts):
   page-side writes are last-writer-wins with no version pin, so set() takes no ifVersion. */

function ReadOnlyError(message) {
  this.name = "ReadOnlyError";
  this.message = message || "Demo data, read only";
}
ReadOnlyError.prototype = Object.create(Error.prototype);
ReadOnlyError.prototype.constructor = ReadOnlyError;

function NoDbError(message) {
  this.name = "NoDbError";
  this.message = message || "This page needs the db capability. Republish it with db declared.";
}
NoDbError.prototype = Object.create(Error.prototype);
NoDbError.prototype.constructor = NoDbError;

function lastSegment(path) {
  var parts = String(path).split("/");
  return parts[parts.length - 1];
}

function parentOf(path) {
  var parts = String(path).split("/");
  parts.pop();
  return parts.join("/");
}

function compareValues(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function matches(data, clause) {
  var v = data[clause[0]];
  var op = clause[1];
  var want = clause[2];
  switch (op) {
    case "==": return v === want;
    case "!=": return v !== want;
    case "<": return v !== undefined && v < want;
    case "<=": return v !== undefined && v <= want;
    case ">": return v !== undefined && v > want;
    case ">=": return v !== undefined && v >= want;
    case "in": return Array.isArray(want) && want.indexOf(v) !== -1;
    case "not-in": return Array.isArray(want) && want.indexOf(v) === -1;
    case "array-contains": return Array.isArray(v) && v.indexOf(want) !== -1;
    default: throw new TypeError("unknown operator: " + op);
  }
}

function noPin(opts) {
  if (opts !== undefined) {
    throw new TypeError("page writes carry no version pin (db.d.ts: last-writer-wins)");
  }
}

// downloads.d.ts error shape: {code, message}. Callers fall back to a copyable text block.
function unavailable() {
  return { code: "unavailable", message: "Saving a file is not available in this view" };
}

function staticStore(opts) {
  var loaded = null;
  function load() {
    if (!loaded) {
      if (opts.docs) {
        loaded = Promise.resolve(opts.docs);
      } else {
        var fetchFn = opts.fetch || globalThis.fetch;
        // A failed load is not kept, so the next read (Try again) fetches afresh.
        loaded = fetchFn(opts.url).then(function (res) {
          if (!res.ok) throw new Error("could not load " + opts.url);
          return res.json();
        }).catch(function (e) {
          loaded = null;
          throw e;
        });
      }
    }
    return loaded;
  }
  function list(collection, q) {
    q = q || {};
    return load().then(function (docs) {
      var out = [];
      Object.keys(docs).sort().forEach(function (path) {
        if (parentOf(path) !== collection) return;
        var data = docs[path].data;
        if ((q.where || []).every(function (c) { return matches(data, c); })) {
          out.push({ id: lastSegment(path), path: path, exists: true, data: data });
        }
      });
      if (q.orderBy) {
        var field = q.orderBy[0];
        var dir = q.orderBy[1] === "desc" ? -1 : 1;
        out.sort(function (x, y) {
          var a = x.data[field], b = y.data[field];
          if (a === undefined && b === undefined) return compareValues(x.id, y.id);
          if (a === undefined) return 1;
          if (b === undefined) return -1;
          return dir * compareValues(a, b) || compareValues(x.id, y.id);
        });
      }
      return q.limit ? out.slice(0, q.limit) : out;
    });
  }
  return {
    kind: "static",
    readOnly: true,
    get: function (path) {
      return load().then(function (docs) {
        var d = docs[path];
        return { id: lastSegment(path), path: path, exists: !!d, data: d ? d.data : undefined };
      });
    },
    list: list,
    subscribe: function (collection, cb, q) {
      var live = true;
      list(collection, q).then(function (rows) { if (live) cb(rows); }, function (e) {
        if (live && q && q.onError) q.onError(e);
      });
      return function () { live = false; };
    },
    set: function () { return Promise.reject(new ReadOnlyError()); },
    del: function () { return Promise.reject(new ReadOnlyError()); },
    viewer: function () { return Promise.resolve(null); },
    isOwner: function () { return Promise.resolve(false); },
    profiles: function () { return Promise.resolve({}); },
    saveFile: function () { return Promise.reject(unavailable()); },
    canDownload: function () { return Promise.resolve(false); },
  };
}

function dbStore(opts) {
  var claude = "claude" in opts ? opts.claude : globalThis.claude;
  var usable = claude && typeof claude.use === "function";
  var dbPromise = null;
  function db() {
    if (!dbPromise) dbPromise = usable ? claude.use("db") : Promise.resolve(null);
    return dbPromise.then(function (ns) {
      if (!ns) throw new NoDbError();
      return ns;
    });
  }
  function toDoc(path, snap) {
    return { id: snap.id, path: path, exists: snap.exists, data: snap.exists ? snap.data() : undefined };
  }
  function query(ns, collection, q) {
    var ref = ns.collection(collection);
    q = q || {};
    (q.where || []).forEach(function (c) { ref = ref.where(c[0], c[1], c[2]); });
    if (q.orderBy) ref = ref.orderBy(q.orderBy[0], q.orderBy[1]);
    if (q.limit) ref = ref.limit(q.limit);
    return ref;
  }
  function rows(collection, snap) {
    return snap.docs.map(function (d) { return toDoc(collection + "/" + d.id, d); });
  }
  return {
    kind: "db",
    readOnly: false,
    get: function (path) {
      return db().then(function (ns) { return ns.doc(path).get(); }).then(function (snap) { return toDoc(path, snap); });
    },
    list: function (collection, q) {
      return db().then(function (ns) { return query(ns, collection, q).get(); }).then(function (snap) { return rows(collection, snap); });
    },
    subscribe: function (collection, cb, q) {
      var unsub = null;
      var live = true;
      var onError = (q && q.onError) || function () {};
      db().then(function (ns) {
        if (!live) return;
        unsub = query(ns, collection, q).onSnapshot(function (snap) { cb(rows(collection, snap)); }, onError);
      }, onError);
      return function () {
        live = false;
        if (unsub) unsub();
      };
    },
    set: function (path, doc, opts) {
      return Promise.resolve().then(function () {
        noPin(opts);
        return db();
      }).then(function (ns) { return ns.doc(path).set(doc); });
    },
    del: function (path) {
      return db().then(function (ns) { return ns.doc(path).delete(); });
    },
    // The awaited user.id() is the only value the store accepts under data/users/<id>/.
    // null means no private subtree: per-viewer features are disabled for this visit.
    viewer: function () {
      if (!usable) return Promise.resolve(null);
      return claude.use("user").then(function (user) { return user ? user.id() : null; });
    },
    // user.isOwner() (user.d.ts: never rejects; false without a viewer). Only meta/owner's first write reads it.
    isOwner: function () {
      if (!usable) return Promise.resolve(false);
      return claude.use("user").then(function (user) { return user ? user.isOwner() : false; })
        .then(function (yes) { return yes === true; }, function () { return false; });
    },
    // {id: Profile} for the ids on screen (user.d.ts: never rejects; name is "" without scope "profile").
    // A null namespace resolves {} and the page shows "Someone".
    profiles: function (ids) {
      if (!usable || !ids.length) return Promise.resolve({});
      return claude.use("user").then(function (user) { return user ? user.profiles(ids) : {}; }).catch(function () { return {}; });
    },
    // The viewer confirms every save (downloads.d.ts); null namespace means this view cannot save.
    saveFile: function (filename, data) {
      if (!usable) return Promise.reject(unavailable());
      return claude.use("downloads").then(function (ns) {
        if (!ns) throw unavailable();
        return ns.save({ filename: filename, data: data });
      });
    },
    // Whether to show Download at all: a null namespace (or an error) hides it.
    canDownload: function () {
      if (!usable) return Promise.resolve(false);
      return claude.use("downloads").then(function (ns) { return !!ns; }, function () { return false; });
    },
  };
}

function createStore(kind, opts) {
  opts = opts || {};
  if (kind === "static") return staticStore(opts);
  if (kind === "db") return dbStore(opts);
  throw new TypeError("unknown store kind: " + kind);
}

if (typeof module === "object" && module.exports) {
  module.exports = { createStore: createStore, ReadOnlyError: ReadOnlyError, NoDbError: NoDbError };
}
