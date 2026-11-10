function component_review_box(ctx, props, ui) {
  var note = ui.textarea({ rows: "2", placeholder: "Reviewer note", "aria-label": "Reviewer note" });
  var state = ui.el("p", { "aria-live": "polite" }, "No review yet");
  ctx.watch("decisions", function (docs) {
    docs.forEach(function (d) {
      if (d.id === props.id + "~x") {
        ui.clear(state);
        ui.append(state, "Review: " + d.data.decision);
      }
    });
  });
  var notes = ui.markdown("## Reviewer notes\n\nThe **pay band** is stated in the posting.\n\n- Check the Band again\n- Unrelated line", { marks: ["band"] });
  return ui.el("div", {},
    ui.el("div", { "aria-label": "Rendered notes" }, notes),
    state,
    note,
    ui.el("div", {},
      ui.button("Approve", function () { return ctx.actions.decide(props.id, "approved", ui.valueOf(note)); }),
      ui.button("Flag", function () { return ctx.actions.decide(props.id, "flagged", ui.valueOf(note)); }),
      ui.button("Add comment", function () { return ctx.actions.comment(props.id, ui.valueOf(note)); })));
}
