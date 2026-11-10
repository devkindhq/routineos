// app/States.jsx: the Desk's state messages. Each says what is true in fixed words and offers at most one action.
import { useEffect, useState } from "react";
import { Alert, Button, Code, Skeleton, Stack, Text } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import { READ_ONLY_NOTE } from "../core/actions.js";

export var NO_DB_TEXT = "This page needs the db capability. Republish it with db declared.";
export var SEED_COMMAND = "python3 skills/routineos/scripts/routineos.py seed <routine-folder> --out <batch-dir>";
export var OFFLINE_TEXT = "You are offline. Changes are paused.";
var LOADING_SLOW_MS = 8000;
var PLACEHOLDER_ROWS = 3;

function Loading({ label, onRetry }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!onRetry) return undefined;
    const t = setTimeout(() => setSlow(true), LOADING_SLOW_MS);
    return () => clearTimeout(t);
  }, [onRetry]);
  return (
    <Stack aria-busy="true">
      <Text c="dimmed">{"Loading " + (label || "")}</Text>
      {slow ? (
        <Alert color="yellow">
          <Text span>Still loading. Check your connection. </Text>
          <Button size="xs" variant="light" onClick={onRetry}>Retry</Button>
        </Alert>
      ) : null}
      <Stack aria-hidden="true">
        {Array.from({ length: PLACEHOLDER_ROWS }, (_, i) => <Skeleton key={i} height={16} />)}
      </Stack>
    </Stack>
  );
}

// kind: loading, error, not-set-up, no-db, empty, read-only.
export function StateView(props) {
  const { kind } = props;
  switch (kind) {
    case "loading":
      return <Loading label={props.label} onRetry={props.onRetry} />;
    case "no-db":
      return <Alert color="yellow" title="No database">{NO_DB_TEXT}</Alert>;
    case "error":
      return (
        <Alert color="red" role="alert" icon={<IconAlertTriangle />} title={"Could not read " + (props.collection || "this page")}>
          <Stack align="flex-start">
            <Text>{props.whole ? "The Desk could not start." : "Other pages still work."}</Text>
            {props.message ? <Code>{props.message}</Code> : null}
            {props.onRetry ? <Button variant="light" onClick={props.onRetry}>Try again</Button> : null}
          </Stack>
        </Alert>
      );
    case "not-set-up":
      return (
        <Stack>
          <Text>
            {(props.name || "This workspace") + " is not set up yet. Ask the person who set up this Desk to connect its routine. Then it shows what the routine finds, the requests that need you and each run's health."}
          </Text>
          <details>
            <summary>For the owner</summary>
            <Text>Seed it with one command, then apply the batch files it writes in order:</Text>
            <Code block>{SEED_COMMAND}</Code>
          </details>
        </Stack>
      );
    case "empty":
      return (
        <Stack align="flex-start">
          <Text>{props.onClear ? "No " + props.plural + " match these filters." : "No " + props.plural + " yet."}</Text>
          {props.onClear ? <Button variant="light" onClick={props.onClear}>Clear filters</Button> : null}
        </Stack>
      );
    case "read-only":
      return <Text c="dimmed" size="sm">{READ_ONLY_NOTE + ". Changes cannot be saved on this page."}</Text>;
    default:
      return null;
  }
}
