// app/DecisionControl.jsx: a record's Decision (Keep, Drop, Pending) as one control (8876114). It writes only on a
// deliberate choice: Keep writes decisions/<id> keep, Pending removes a person's decision, Drop opens the reason form
// and writes nothing itself. The control moves at once and goes back to its prior value when the write is refused,
// with the reason in a notification. A visit that may not decide sees no control at all (canDecide).
import { useEffect, useRef, useState } from "react";
import { SegmentedControl } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { canDecide, canWrite, decide, remove, writeMessage } from "../core/actions.js";

export { canDecide };

// keepState (core/pages/entity.js) to its badge: [label, color].
export var KEEP_BADGES = {
  dropped: ["Dropped", "red"], "person-dropped": ["Dropped", "red"], "person-drop-pending": ["Drop pending", "yellow"],
  "kept-pending": ["Kept (pending next run)", "yellow"], kept: ["Kept", "teal"], "drop-pending": ["Drop again (pending next run)", "yellow"],
  active: ["Active", "teal"],
};

// value: decisionNow(keepState(...)). decided: a person's decisions/<id> exists. canDrop: the reason form is offered.
export default function DecisionControl({ ctx, id, value, decided, canDrop, onDrop, onSaved }) {
  const [v, setV] = useState(value);
  const [busy, setBusy] = useState(false);
  // An arrow key moves focus across the radios, and the browser checks each one it lands on. That is not a choice,
  // so a change while an arrow key is down is ignored; Space or a click on the focused option still chooses it.
  const arrow = useRef(false);
  useEffect(() => { setV(value); }, [value]);
  if (!canDecide(ctx)) return null;

  function change(next) {
    if (busy || next === v || arrow.current) return;
    if (next === "drop") {
      if (onDrop) onDrop();
      return;
    }
    var run = next === "keep" ? () => decide(ctx, id, "keep")
      : decided ? () => remove(ctx.store, ctx.viewer, "decisions/" + id) : null;
    if (!run) return;
    var prior = v;
    setV(next);
    setBusy(true);
    Promise.resolve().then(run).then(() => {
      setBusy(false);
      if (onSaved) onSaved();
    }, (e) => {
      setV(prior);
      setBusy(false);
      notifications.show({ color: "red", title: "Not saved", message: writeMessage(e) });
    });
  }

  return (
    <SegmentedControl aria-label="Decision" value={v} onChange={change} readOnly={busy}
      onKeyDownCapture={(e) => { arrow.current = /^Arrow/.test(e.key); }} onKeyUpCapture={() => { arrow.current = false; }}
      data={[{ value: "keep", label: "Keep" }, { value: "drop", label: "Drop", disabled: !canDrop && value !== "drop" },
        { value: "pending", label: "Pending" }]} />
  );
}
