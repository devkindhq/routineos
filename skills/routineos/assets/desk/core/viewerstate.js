// core/viewerstate.js: a viewer's own choices that outlive a page (the columns picked on a list, the last route).
// A viewer whose shared writes are not refused, on a store that is not read-only, keeps them in the database at
// data/users/<id>/state/<kind>/<id>. Everyone else (Commenter, Viewer, demo, a refused write) keeps them in
// localStorage on this device. Every storage access is guarded: blocked storage reads as no choice.
import { remove, save, stamp, viewerPath } from "./actions.js";

export var COLS_KEY = "routineos-desk-cols:";
export var ROUTE_KEY = "routineos-desk-route:";

export function colsKey(viewer, type) { return COLS_KEY + (viewer || "-") + ":" + type; }
export function routeKey(viewer) { return ROUTE_KEY + (viewer || "-"); }

function storage() {
  try { return globalThis.localStorage || null; } catch (e) { return null; }
}
function readLocal(key) {
  try { var s = storage(); return s ? JSON.parse(s.getItem(key)) : null; } catch (e) { return null; }
}
function writeLocal(key, v) {
  try { var s = storage(); if (s) s.setItem(key, JSON.stringify(v)); } catch (e) { /* blocked: the choice lasts this visit */ }
}
function dropLocal(key) {
  try { var s = storage(); if (s) s.removeItem(key); } catch (e) { /* blocked */ }
}
function dbMay(ctx) {
  return !!ctx.viewer && !!ctx.store && !ctx.store.readOnly && ctx.canWriteShared !== false;
}

// Reads this device first, then the database document (any viewer with an id may read their own). A device copy is
// only ever the newer one: put() writes it when the database was not used or refused, and removes it when a database
// write lands. Resolves the stored field, or null.
function load(ctx, kind, id, field, local) {
  var here = readLocal(local);
  if (here !== null && here !== undefined) return Promise.resolve(here);
  return ctx.viewer && ctx.store && ctx.store.get
    ? Promise.resolve().then(() => ctx.store.get(viewerPath(ctx.viewer, kind, id))).then(
      (d) => (d && d.exists && d.data && d.data[field] !== undefined ? d.data[field] : null), () => null)
    : Promise.resolve(null);
}

function put(ctx, kind, id, field, value, local) {
  if (!dbMay(ctx)) { writeLocal(local, value); return Promise.resolve(); }
  var doc = Object.assign({}, stamp(ctx)); doc[field] = value;
  return Promise.resolve().then(() => save(ctx.store, ctx.viewer, viewerPath(ctx.viewer, kind, id), doc)).then(
    () => { dropLocal(local); }, () => { writeLocal(local, value); });
}

// Clears the device copy, then the database record. A failed database remove rejects: the choice would otherwise
// come back on the next load while the viewer believes it was reset.
function clear(ctx, kind, id, local) {
  dropLocal(local);
  if (!dbMay(ctx)) return Promise.resolve();
  return Promise.resolve().then(() => remove(ctx.store, ctx.viewer, viewerPath(ctx.viewer, kind, id))).then(() => undefined);
}

function colList(v) {
  return Array.isArray(v) && v.length && v.every((k) => typeof k === "string") ? v : null;
}

export function loadCols(ctx, type) {
  return load(ctx, "cols", type, "cols", colsKey(ctx.viewer, type)).then(colList);
}
export function saveCols(ctx, type, cols) {
  return put(ctx, "cols", type, "cols", cols, colsKey(ctx.viewer, type));
}
export function resetCols(ctx, type) {
  return clear(ctx, "cols", type, colsKey(ctx.viewer, type));
}

// The last route: a "#/" address of at most 500 characters, else nothing. What is stored is read back as untrusted.
export var ROUTE_MAX = 500;
export function validRoute(h) {
  return typeof h === "string" && h.length <= ROUTE_MAX && h.indexOf("#/") === 0 ? h : null;
}
export function loadRoute(ctx) {
  return load(ctx, "route", "last", "hash", routeKey(ctx.viewer)).then(validRoute);
}
export function saveRoute(ctx, hash) {
  return put(ctx, "route", "last", "hash", hash, routeKey(ctx.viewer));
}
export function clearRoute(ctx) {
  return clear(ctx, "route", "last", routeKey(ctx.viewer));
}
