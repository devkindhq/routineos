function component_review_panel(ctx, props, ui) {
  var list = ui.el("ul", {});
  props.records.slice(0, 5).forEach(function (r) {
    ui.append(list, ui.el("li", {}, r.data.key || r.id));
  });
  return ui.el("div", {}, ui.el("p", {}, props.records.length + " to review"), list);
}
