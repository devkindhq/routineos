// app/boot.js: the Desk's first reads. They start in the base order (meta/definition, meta/workspace, viewer,
// meta/join, meta/owner, meta/lock, settings/workspace), run together, then ensureOwner records or checks
// meta/owner. A failure resolves a model with failed "no-db" or "read-error" rather than rejecting.
import { ensureOwner } from "../core/actions.js";
import { validLock } from "../core/lock.js";
import { NoDbError } from "../core/store.js";

export function boot(store, config) {
  config = config || {};
  var model = {
    store: store, definition: null, workspace: { name: config.workspace }, viewer: null, join: null, owner: null,
    ownerTampered: false, lock: null, tour: config.tour === true, tourOff: false, failed: null, failError: null,
  };
  var reads;
  try {
    reads = [
      store.get("meta/definition"),
      store.get("meta/workspace"),
      Promise.resolve(store.viewer()).catch(function () { return null; }),
      store.get("meta/join"),
      store.get("meta/owner"),
      store.get("meta/lock"),
      Promise.resolve(store.get("settings/workspace")).catch(function () { return { exists: false }; }),
    ];
  } catch (e) {
    reads = [Promise.reject(e)];
  }
  return Promise.all(reads).then(function (docs) {
    model.definition = docs[0].exists ? docs[0].data : null;
    if (docs[1].exists && docs[1].data && typeof docs[1].data === "object") model.workspace = docs[1].data;
    model.viewer = docs[2] || null;
    model.join = docs[3].exists && docs[3].data && typeof docs[3].data === "object" ? docs[3].data : null;
    model.owner = docs[4].exists && docs[4].data && typeof docs[4].data.by === "string" ? docs[4].data : null;
    model.lock = docs[5].exists && validLock(docs[5].data) ? docs[5].data : null;
    var ws = docs[6].exists ? docs[6].data : null;
    model.tourOff = !!(ws && ws.values && ws.values.tour === false);
    return ensureOwner(model).then(function () { return model; });
  }, function (e) {
    model.failed = e instanceof NoDbError ? "no-db" : "read-error";
    model.failError = e && e.message ? String(e.message) : String(e);
    return model;
  });
}
