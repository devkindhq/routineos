// Viewer probe: checks that Mantine mounts, that a click can save through the downloads capability,
// and that the clipboard works inside the artifact viewer. The only file outside core/store.js that calls claude.use.
import "@mantine/core/styles.css";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Alert, Button, Container, CopyButton, MantineProvider, Stack, Text, Title } from "@mantine/core";

function hasUse() {
  return typeof window.claude === "object" && window.claude !== null && typeof window.claude.use === "function";
}

function Probe() {
  const [result, setResult] = useState(null);

  async function save() {
    try {
      const downloads = hasUse() ? await window.claude.use("downloads") : null;
      if (!downloads) {
        setResult({ ok: false, text: "No downloads capability (claude.use missing or returned nothing)." });
        return;
      }
      const out = await downloads.save({ filename: "probe.txt", data: "ok" });
      setResult({ ok: true, text: "Saved: " + JSON.stringify(out === undefined ? null : out) });
    } catch (err) {
      setResult({ ok: false, text: "Error: " + ((err && (err.code || err.message)) || String(err)) });
    }
  }

  return (
    <Container size="sm" py="xl">
      <Stack>
        <Title order={1}>Desk probe</Title>
        <Text>claude.use resolved: {hasUse() ? "yes" : "no"}</Text>
        <Button onClick={save}>Save test file</Button>
        {result && (
          <Alert color={result.ok ? "green" : "red"} title={result.ok ? "Save result" : "Save failed"}>
            {result.text}
          </Alert>
        )}
        <CopyButton value="probe">
          {({ copied, copy }) => (
            <Button variant="light" onClick={copy}>
              {copied ? "Copied" : "Copy \"probe\""}
            </Button>
          )}
        </CopyButton>
      </Stack>
    </Container>
  );
}

createRoot(document.getElementById("root")).render(
  <MantineProvider defaultColorScheme="auto">
    <Probe />
  </MantineProvider>,
);
