// app/Copy.jsx: one way to copy text (spec 6.8). copyText awaits the clipboard write and says whether it worked;
// when the clipboard is missing or the browser refuses the write, the text opens selected in a read-only box so
// the viewer can copy it by hand. Nothing says "Copied" unless the write went through.
import { useEffect, useState } from "react";
import { Button, Modal, Textarea } from "@mantine/core";

export async function copyText(text) {
  var c = typeof navigator !== "undefined" ? navigator.clipboard : null;
  if (!c || typeof c.writeText !== "function") return false;
  try {
    await c.writeText(String(text));
    return true;
  } catch (e) {
    return false;
  }
}

// The read-only box for copying by hand. value null keeps it closed.
export function CopyFallback({ value, onClose }) {
  return (
    <Modal opened={value !== null && value !== undefined} onClose={onClose} title="Copy this">
      <Textarea aria-label="Text to copy" readOnly autosize minRows={2} value={value || ""}
        onFocus={(e) => e.currentTarget.select()} data-autofocus />
    </Modal>
  );
}

// A button that copies value, shows "Copied" for a moment on success, and opens the box when the copy fails.
export function CopyTextButton({ value, label, size, variant, leftSection }) {
  const [copied, setCopied] = useState(false);
  const [fallback, setFallback] = useState(null);
  useEffect(() => {
    if (!copied) return undefined;
    var t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  function onClick() {
    copyText(value).then((ok) => { if (ok) setCopied(true); else setFallback(String(value)); });
  }
  return (
    <>
      <Button size={size} variant={variant || "default"} leftSection={leftSection} onClick={onClick}>{copied ? "Copied" : label}</Button>
      <CopyFallback value={fallback} onClose={() => setFallback(null)} />
    </>
  );
}
