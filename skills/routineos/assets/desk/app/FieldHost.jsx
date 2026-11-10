// app/FieldHost.jsx: one table cell drawn by a routine's custom component (componentUi.js), or the plain fallback.
// The component's element is moved in with replaceChildren; no markup string is ever parsed.
import { useLayoutEffect, useRef, useState } from "react";
import { renderComponent } from "./componentUi.js";

// props: {value, record, field}, the contract a routine's component reads. The factory runs again only when one of
// the three changes, not when a caller passes a fresh object holding the same ones.
export default function FieldHost({ id, props, store, fallback }) {
  const ref = useRef(null);
  const [failed, setFailed] = useState(false);
  var value = props && props.value, record = props && props.record, field = props && props.field;
  useLayoutEffect(() => {
    var node = ref.current;
    if (!node) return undefined;
    var out = renderComponent(id, { value: value, record: record, field: field }, store);
    if (out) {
      node.replaceChildren(out);
      setFailed(false);
    } else {
      node.replaceChildren();
      setFailed(true);
    }
    return () => { node.replaceChildren(); };
  }, [id, value, record, field, store]);
  return (
    <>
      <span ref={ref} hidden={failed} />
      {failed ? fallback : null}
    </>
  );
}
