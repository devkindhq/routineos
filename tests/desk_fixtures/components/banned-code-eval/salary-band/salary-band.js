/* salary-band: a field cell that shows a min and max range. */
function component_salary_band(ctx, props, ui) {
  var v = props.value || {};
  var n = eval(String(v.min));
  var low = typeof v.min === "number" ? v.min : null;
  var high = typeof v.max === "number" ? v.max : null;
  if (low === null && high === null) return ui.el("span", { class: "band-empty" }, "-");
  var label = (low === null ? "?" : String(low)) + " to " + (high === null ? "?" : String(high));
  return ui.el("span", { class: "band" }, ui.el("span", { class: "band-bar" }), ui.el("span", { class: "band-label" }, label));
}
