function component_review_page(ctx, props, ui) {
  var body = ui.el("div", {}, ui.el("p", {}, "Loading"));
  ctx.list({ type: "role" }).then(function (rows) {
    ui.clear(body);
    ui.append(body, ui.el("p", {}, rows.length + " records in the queue"));
    if (rows.length) {
      var first = rows[0].id;
      ui.append(body, ui.button("Approve first", function () { return ctx.actions.decide(first, "approved", ""); }));
    }
  });
  return body;
}
