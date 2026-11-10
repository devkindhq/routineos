/* clef-card: the Clef scorecard on a page record. Reads the page's clef_card value (written by lib/track.py from
   lib/apply_rules.py) and draws it read-only. Clef is the verdict model: a score at or above the flag-at percent is a
   flag. Off and error are states of their own, never "clear". */
function component_clef_card(ctx, props, ui) {
  var record = props.record || {};
  var card = (record.display || {}).clef_card;
  function outcome(o) {
    var res = { text: String(o || ""), tone: "info" };
    if (o === "agree") res = { text: "Agree", tone: "ok" };
    else if (o === "needs-review") res = { text: "Needs review", tone: "fail" };
    else if (o === "clef-flag") res = { text: "Clef flag", tone: "warn" };
    else if (o === "clear") res = { text: "Clear", tone: "info" };
    return res;
  }

  function state() {
    if (!card || !card.state || card.state === "off") return "Clef scoring is off for this capture.";
    if (card.state === "error") return "Clef scoring failed: " + (card.error || "no message") + ". The rule flags stand unchanged.";
    var parts = [];
    if (card.model) parts.push("Model " + card.model);
    if (typeof card.flagAt === "number") parts.push("flag at " + Math.round(card.flagAt * 100) + "%");
    if (card.inputTokens != null || card.outputTokens != null) parts.push((card.inputTokens || 0) + " input and " + (card.outputTokens || 0) + " output tokens");
    return parts.length ? parts.join(", ") + "." : "Clef scored this page.";
  }

  var out = [ui.el("p", {}, state())];
  if (card && card.state === "ok") {
    var rows = (card.rows || []).slice().sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
    if (!rows.length) {
      out.push(ui.el("p", {}, "Clef returned no rule scores for this page."));
    } else {
      var table = ui.el("table", {}, ui.el("thead", {}, ui.el("tr", {},
        ui.el("th", {}, "Rule"), ui.el("th", {}, "Score"), ui.el("th", {}, "Rule fired"), ui.el("th", {}, "Outcome"))));
      var tbody = ui.el("tbody", {});
      rows.forEach(function (r) {
        var o = outcome(r.outcome);
        ui.append(tbody, ui.el("tr", {},
          ui.el("td", {}, r.label || r.rule, " ", ui.el("small", {}, (r.rule || "") + (r.hidden ? " (draft, hidden)" : ""))),
          ui.el("td", {}, String(r.score) + "%"),
          ui.el("td", {}, r.fired ? "Yes" : "No"),
          ui.el("td", {}, ui.badge(o.text, o.tone))));
      });
      ui.append(table, tbody);
      out.push(table);
    }
    if (card.unscored && card.unscored.length) out.push(ui.el("p", {}, "Fired but not scored by Clef: " + card.unscored.join(", ") + "."));
    if (card.omitted) out.push(ui.el("p", {}, String(card.omitted) + " more clear rows not shown."));
  }
  out.push(ui.el("p", {}, ui.el("small", {}, "Clef decides the flags. A rule scored at or above the flag-at percent is a flag. A rule hit Clef scores below it is kept and marked needs review.")));
  return ui.el("div", {}, out);
}
