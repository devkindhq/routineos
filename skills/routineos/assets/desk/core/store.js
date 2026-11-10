// core/store.js: the only module that knows about claude.use.
// Platform shapes follow the artifact-capabilities type definitions, contract 0.2.92 (db.d.ts, user.d.ts):
// page-side writes are last-writer-wins with no version pin, so set() takes no ifVersion.
export function ReadOnlyError(message) {
  this.name = "ReadOnlyError";
  this.message = message || "Demo data, read only";
}
ReadOnlyError.prototype = Object.create(Error.prototype);
ReadOnlyError.prototype.constructor = ReadOnlyError;

export function NoDbError(message) {
  this.name = "NoDbError";
  this.message = message || "This page needs the db capability. Republish it with db declared.";
}
NoDbError.prototype = Object.create(Error.prototype);
NoDbError.prototype.constructor = NoDbError;

export function lastSegment(path) {
  var parts = String(path).split("/");
  return parts[parts.length - 1];
}

export function parentOf(path) {
  var parts = String(path).split("/");
  parts.pop();
  return parts.join("/");
}

export function compareValues(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function matches(data, clause) {
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

export function noPin(opts) {
  if (opts !== undefined) {
    throw new TypeError("page writes carry no version pin (db.d.ts: last-writer-wins)");
  }
}

// downloads.d.ts error shape: {code, message}. Callers fall back to a copyable text block.
export function unavailable() {
  return { code: "unavailable", message: "Saving a file is not available in this view" };
}

export function staticStore(opts) {
  var loaded = null;
  var bust = false;
  function load() {
    if (!loaded) {
      if (opts.docs) {
        loaded = Promise.resolve(opts.docs);
      } else {
        var fetchFn = opts.fetch || globalThis.fetch;
        // A failed load is not kept, so the next read (Try again) fetches afresh.
        // A reload asks for the file again with a changing query value so no cache answers it.
        var url = bust ? opts.url + (opts.url.indexOf("?") === -1 ? "?" : "&") + "r=" + Date.now() : opts.url;
        bust = false;
        loaded = fetchFn(url).then(function (res) {
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
    // Forget the memoised snapshot and read it again; resolves true once the new one is in.
    reload: function () {
      loaded = null;
      bust = true;
      return load().then(function () { return true; });
    },
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

export function dbStore(opts) {
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
    // user.can("data.write") (user.d.ts, contract 0.2.96): true, false, or null when the platform does not say. Anything
    // else, a missing namespace or method, or a failure is also null, so the controls stay enabled and a refused write
    // decides. Commenter and Viewer hold `view`, which writes nothing under the Desk's rules; Contributor holds `interact`.
    canWriteShared: function () {
      if (!usable) return Promise.resolve(null);
      return Promise.resolve().then(function () { return claude.use("user"); }).then(function (user) {
        return user && typeof user.can === "function" ? user.can("data.write") : null;
      }).then(function (yes) { return yes === true || yes === false ? yes : null; }, function () { return null; });
    },
    // claude.use("comments") (the platform comment composer), or null when unavailable or it fails.
    composer: function () {
      if (!usable) return Promise.resolve(null);
      return Promise.resolve().then(function () { return claude.use("comments"); }).then(function (ns) { return ns || null; }, function () { return null; });
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

// A failure that means the connection is down rather than the data being wrong. The browser's offline flag is the
// reliable signal; a fetch TypeError is the usual shape of a dropped request. The db namespace's own error shape for
// a lost connection is not documented, so "network" and "unavailable" codes are an assumption.
export function isNetworkError(e) {
  if (globalThis.navigator && globalThis.navigator.onLine === false) return true;
  if (!e) return false;
  if (e.code === "network" || e.code === "unavailable") return true;
  return e.name === "TypeError" && /fetch|network|load failed/i.test(String(e.message));
}

// Adds onNetworkError(cb) and onReadOk(cb) to a store; each returns its own unsubscribe. Reads that succeed fire
// onReadOk; any call that fails with a network error fires onNetworkError.
export function watchNetwork(s) {
  var errs = [], oks = [];
  function fire(list, arg) { list.slice().forEach(function (cb) { cb(arg); }); }
  function failed(e) { if (isNetworkError(e)) fire(errs, e); }
  function read(p) { return p.then(function (v) { fire(oks); return v; }, function (e) { failed(e); throw e; }); }
  function write(p) { return p.catch(function (e) { failed(e); throw e; }); }
  function hook(list) {
    return function (cb) {
      list.push(cb);
      return function () { var i = list.indexOf(cb); if (i !== -1) list.splice(i, 1); };
    };
  }
  var get = s.get, list = s.list, subscribe = s.subscribe, set = s.set, del = s.del;
  s.get = function () { return read(get.apply(s, arguments)); };
  s.list = function () { return read(list.apply(s, arguments)); };
  s.set = function () { return write(set.apply(s, arguments)); };
  s.del = function () { return write(del.apply(s, arguments)); };
  s.subscribe = function (collection, cb, q) {
    var own = (q && q.onError) || null;
    var q2 = Object.assign({}, q || {}, { onError: function (e) { failed(e); if (own) own(e); } });
    return subscribe.call(s, collection, function (rows) { fire(oks); cb(rows); }, q2);
  };
  s.onNetworkError = hook(errs);
  s.onReadOk = hook(oks);
  return s;
}

export function createStore(kind, opts) {
  opts = opts || {};
  if (kind === "static") return watchNetwork(staticStore(opts));
  if (kind === "db") return watchNetwork(dbStore(opts));
  throw new TypeError("unknown store kind: " + kind);
}
