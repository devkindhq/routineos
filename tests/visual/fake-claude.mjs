// A stand-in for the artifact runtime's window.claude: use("db") serves a snapshot from serve.mjs, use("user") gives
// a viewer with id(), isOwner() and profiles(ids). Reads of collections matching failCollections fail, and so do reads
// of single documents whose collection matches failDocs.
// With writable, set/delete change an in-page copy, listed in window.__deskWrites, and re-run live queries. Each
// collection read (a get or a live run) is listed in window.__deskReads by collection name.
// viewer null means no user namespace (report-only); profiles default to the two fictional people.
// canWrite answers user.can("data.write"): true (default), false or null (not told). With false a write is also
// refused (rejects with code "permission-denied"), which is how the platform treats a Commenter or Viewer (it refuses a
// db rule below interact, so such a person can write no shared data, comments included). Verified at publish time only,
// not with a real Commenter; the harness's refusal is a model.
// extra ({path: {data, version}}) adds or replaces documents in the snapshot for one test.
// downloads "save" gives a downloads namespace whose save({filename, data}) resolves; "decline" rejects it with
// {code: "declined"} as a viewer saying no would. Each call is listed in window.__deskSaves as {filename, type, data}
// (type is typeof data). Left out, use("downloads") resolves null, as a page without the capability gets.
export const PROFILES = { u_owner: { name: "Robin Vale" }, u_member: { name: "Kit Marlow" } };

export async function fakeClaude(page, opts = {}) {
  const o = {
    snapshot: opts.snapshot || "/snap/v2.json",
    writable: !!opts.writable,
    viewer: opts.viewer === undefined ? "u_owner" : opts.viewer,
    owner: !!opts.owner,
    profiles: opts.profiles || PROFILES,
    fail: opts.failCollections ? opts.failCollections.source : null,
    failDocs: opts.failDocs ? opts.failDocs.source : null,
    extra: opts.extra || null,
    canWrite: opts.canWrite === undefined ? true : opts.canWrite,
    downloads: opts.downloads || null,
  };
  await page.addInitScript((o) => {
    const snapshot = fetch(o.snapshot).then((r) => r.json()).then((docs) => Object.assign(docs, o.extra || {}));
    const failRe = o.fail ? new RegExp(o.fail) : null;
    const fail = (c) => !!(failRe && failRe.test(c));
    const failDocsRe = o.failDocs ? new RegExp(o.failDocs) : null;
    const listeners = [];
    window.__deskWrites = [];
    window.__deskSaves = [];
    window.__deskReads = [];
    function docSnap(path, docs) {
      const d = docs[path];
      return { id: path.split("/").pop(), exists: !!d, data: () => (d ? d.data : undefined) };
    }
    function query(collection, where) {
      const run = () => snapshot.then((docs) => {
        window.__deskReads.push(collection);
        if (fail(collection)) throw new Error("forced read failure: " + collection);
        const ids = Object.keys(docs).sort().filter((p) => p.slice(0, p.lastIndexOf("/")) === collection);
        const rows = ids.filter((p) => where.every(([f, op, v]) => op === "==" && docs[p].data[f] === v));
        return { docs: rows.map((p) => docSnap(p, docs)) };
      });
      return {
        where: (f, op, v) => query(collection, where.concat([[f, op, v]])),
        orderBy: function () { return this; },
        limit: function () { return this; },
        get: run,
        onSnapshot: (cb, err) => {
          const l = { run, cb, err, live: true };
          if (o.writable) listeners.push(l);
          run().then(cb, err);
          return () => { l.live = false; };
        },
      };
    }
    function write(path, data) {
      if (o.canWrite === false) {
        return Promise.reject(Object.assign(new Error("permission denied: this access level cannot write " + path), { code: "permission-denied" }));
      }
      if (!o.writable) return Promise.resolve();
      return snapshot.then((docs) => {
        window.__deskWrites.push({ op: data === undefined ? "delete" : "set", path, data });
        if (data === undefined) delete docs[path];
        else docs[path] = { version: ((docs[path] && docs[path].version) || 0) + 1, data: JSON.parse(JSON.stringify(data)) };
        listeners.filter((l) => l.live).forEach((l) => l.run().then(l.cb, l.err));
      });
    }
    // A test puts a doc as the routine would (a later run): no writable check, not recorded as a Desk write.
    window.__deskPut = (path, data) => snapshot.then((docs) => {
      docs[path] = { version: ((docs[path] && docs[path].version) || 0) + 1, data: JSON.parse(JSON.stringify(data)) };
      listeners.filter((l) => l.live).forEach((l) => l.run().then(l.cb, l.err));
    });
    const db = {
      collection: (c) => query(c, []),
      doc: (path) => ({ get: () => snapshot.then((docs) => {
        if (failDocsRe && failDocsRe.test(path.slice(0, path.lastIndexOf("/")))) throw new Error("forced read failure: " + path);
        return docSnap(path, docs);
      }), set: (data) => write(path, data), delete: () => write(path, undefined) }),
    };
    const user = {
      id: () => Promise.resolve(o.viewer),
      isOwner: () => Promise.resolve(o.owner),
      can: (capability) => Promise.resolve(capability === "data.write" ? o.canWrite : null),
      profiles: (ids) => Promise.resolve(Object.fromEntries(ids.filter((i) => i in o.profiles).map((i) => [i, o.profiles[i]]))),
    };
    const downloads = {
      save: (req) => {
        window.__deskSaves.push({ filename: req && req.filename, type: typeof (req && req.data), data: req && req.data });
        if (o.downloads === "decline") return Promise.reject({ code: "declined", message: "The viewer did not save the file." });
        return Promise.resolve();
      },
    };
    const spaces = { db: db, user: o.viewer !== null ? user : null, downloads: o.downloads ? downloads : null };
    window.claude = { use: (name) => Promise.resolve(Object.prototype.hasOwnProperty.call(spaces, name) ? spaces[name] : null) };
  }, o);
}
