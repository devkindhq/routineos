// core/exporter.js: the export dialog (spec "Export and download"). CSV (default) or JSON of the selection, else
// the current view and filters. Copy always works; Download goes through store.saveFile on click only and
// is hidden when this view cannot save. The viewer confirms every save (downloads.d.ts), so nothing is capped or
// retried here.
import { toCsv } from "./pages/browse.js";

export var EXPORT_HINT = "You'll be asked to confirm before the file saves.";
export var EXPORT_FORMATS = [["csv", "CSV"], ["json", "JSON"]];

export function exportSlug_(s, fallback) {
  var out = String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return out || fallback;
}

export function exportName(workspace, plural, date, ext) {
  var d = date || new Date();
  function two(n) { return (n < 10 ? "0" : "") + n; }
  var day = d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate());
  return exportSlug_(workspace, "desk") + "-" + exportSlug_(plural, "records") + "-" + day + "." + (ext || "csv");
}

// rows: plain objects keyed by column key. CSV uses the column labels as headers (toCsv in pages/browse.js).
export function exportData(rows, cols, format) {
  if (format === "csv") return toCsv(rows, cols);
  if (format === "json") {
    return JSON.stringify(rows.map(function (r) {
      var o = {};
      cols.forEach(function (c) { o[c.key] = r[c.key] === undefined ? null : r[c.key]; });
      return o;
    }), null, 2) + "\n";
  }
  throw new Error("export format must be csv or json");
}

// The History page's export: one row per event, newest first as listed. Quoting is toCsv's (RFC 4180).
export var HISTORY_COLS = [{ key: "at", label: "When" }, { key: "who", label: "Who" }, { key: "kind", label: "Kind" }, { key: "text", label: "What" }];
export function historyCsv(events) {
  return toCsv(events.map(function (e) { return { at: e.at, who: e.by || "routine", kind: e.kind, text: e.text }; }), HISTORY_COLS);
}

export function exportScope(rows, selected) {
  if (selected && selected.size) {
    var picked = rows.filter(function (r) { return selected.has(r.id); });
    return { rows: picked, label: picked.length + " selected" };
  }
  return { rows: rows, label: rows.length + " in this view" };
}

// downloads.d.ts codes. hide: saves cannot work in this view, so the Download button goes away.
export function downloadToast(err) {
  var code = err && err.code;
  if (code === "declined") return { tone: "quiet", text: "Not saved." };
  if (code === "rate_limited") return { tone: "warn", text: "A save is already waiting for your answer, or there were too many just now. Wait a moment, then try again." };
  if (code === "too_large") return { tone: "warn", text: "This file is too large to save here. Export fewer rows, or use Copy." };
  if (code === "rejected_extension" || code === "extension_not_enabled") return { tone: "warn", text: "This format cannot be saved here. Use Copy instead." };
  if (code === "bad_request" || code === "transform_error") return { tone: "fail", text: "The file could not be prepared. Use Copy instead." };
  return { tone: "warn", text: "Saving a file is not available here. Use Copy instead.", hide: true };
}
