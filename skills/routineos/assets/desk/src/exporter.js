/* src/exporter.js: the export dialog (spec "Export and download"). CSV (default) or JSON of the selection, else
   the current view and filters. Copy always works; Download goes through store.saveFile on click only and
   is hidden when this view cannot save. The viewer confirms every save (downloads.d.ts), so nothing is capped or
   retried here. */

var EXPORT_HINT = "You'll be asked to confirm before the file saves.";
var EXPORT_FORMATS = [["csv", "CSV"], ["json", "JSON"]];

function exportSlug_(s, fallback) {
  var out = String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return out || fallback;
}

function exportName(workspace, plural, date, ext) {
  var d = date || new Date();
  function two(n) { return (n < 10 ? "0" : "") + n; }
  var day = d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate());
  return exportSlug_(workspace, "desk") + "-" + exportSlug_(plural, "records") + "-" + day + "." + (ext || "csv");
}

// rows: plain objects keyed by column key. CSV uses the column labels as headers (toCsv in pages/browse.js).
function exportData(rows, cols, format) {
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

function exportScope(rows, selected) {
  if (selected && selected.size) {
    var picked = rows.filter(function (r) { return selected.has(r.id); });
    return { rows: picked, label: picked.length + " selected" };
  }
  return { rows: rows, label: rows.length + " in this view" };
}

// downloads.d.ts codes. hide: saves cannot work in this view, so the Download button goes away.
function downloadToast(err) {
  var code = err && err.code;
  if (code === "declined") return { tone: "quiet", text: "Not saved." };
  if (code === "rate_limited") return { tone: "warn", text: "A save is already waiting for your answer, or there were too many just now. Wait a moment, then try again." };
  if (code === "too_large") return { tone: "warn", text: "This file is too large to save here. Export fewer rows, or use Copy." };
  if (code === "rejected_extension" || code === "extension_not_enabled") return { tone: "warn", text: "This format cannot be saved here. Use Copy instead." };
  if (code === "bad_request" || code === "transform_error") return { tone: "fail", text: "The file could not be prepared. Use Copy instead." };
  return { tone: "warn", text: "Saving a file is not available here. Use Copy instead.", hide: true };
}

// spec: {workspace, plural, rows (records with id), toPlain(rows) -> plain objects, cols, selected (Set)}.
function exportDialog(ctx, spec) {
  var format = "csv";
  var scope = exportScope(spec.rows, spec.selected);
  var status = el("span", { class: "status", role: "status" });
  var area = el("div", { class: "export-text" });
  function text() { return exportData(spec.toPlain(scope.rows), spec.cols, format); }
  function say(t) { status.textContent = t.text; status.setAttribute("data-tone", t.tone); }
  var formatSel = el("select", { "aria-label": "Format" }, EXPORT_FORMATS.map(function (f) { return el("option", { value: f[0] }, f[1]); }));
  formatSel.onchange = function () { format = formatSel.value; clear(area); status.textContent = ""; };
  var copy = button("Copy", function () {
    var t = text();
    var clip = typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText;
    function show() {
      clear(area);
      var box = el("textarea", { readonly: true, rows: "8", class: "mono csv", "aria-label": "Export text" });
      box.value = t;
      append(area, box);
      if (box.select) box.select();
      say({ tone: "quiet", text: "Copy is blocked here. Select the text below and copy it." });
    }
    if (!clip) { show(); return; }
    navigator.clipboard.writeText(t).then(function () { say({ tone: "ok", text: "Copied " + scope.rows.length + " rows." }); }, show);
  });
  var download = button("Download", function () {
    var name = exportName(spec.workspace, spec.plural, new Date(), format);
    download.disabled = true;
    ctx.store.saveFile(name, text()).then(function (res) {
      download.disabled = false;
      if (!(res && res.status === "delivered")) say({ tone: "ok", text: "Saved " + scope.rows.length + " rows as " + name + "." });
    }, function (e) {
      download.disabled = false;
      var t = downloadToast(e);
      say(t);
      if (t.hide) download.hidden = true;
    });
  }, { icon: "download", primary: true });
  download.hidden = true;
  if (ctx.store.canDownload) ctx.store.canDownload().then(function (ok) { download.hidden = !ok; });
  return el("div", { class: "export-dialog", role: "dialog", "aria-label": "Export" },
    el("h2", null, "Export " + spec.plural),
    el("label", { class: "field" }, el("span", null, "Format"), formatSel),
    el("p", { class: "muted" }, scope.label + (spec.selected && spec.selected.size ? "" : ", with the current filters")),
    el("div", { class: "actions" }, copy, download, status),
    el("p", { class: "muted hint" }, EXPORT_HINT),
    area);
}

if (typeof module === "object" && module.exports) {
  module.exports = { EXPORT_HINT: EXPORT_HINT, exportName: exportName, exportData: exportData, exportScope: exportScope,
    downloadToast: downloadToast, exportDialog: exportDialog };
}
