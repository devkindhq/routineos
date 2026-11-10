// app/settings/about.jsx: where this Desk came from and how full it is.
import { useEffect, useState } from "react";
import { Table, Text } from "@mantine/core";
import { DESK_TEMPLATE_VERSION, SETTINGS_CAP_TEXT, SETTINGS_COUNTED, lintText } from "../../core/pages/settings.js";
import { useModel, useStore } from "../StoreContext.jsx";
import { Section } from "./common.jsx";

export default function About() {
  const model = useModel();
  const store = useStore();
  const [count, setCount] = useState(null);
  useEffect(() => {
    var live = true;
    Promise.all(SETTINGS_COUNTED.map((c) => store.list(c).then((rows) => rows.length))).then(
      (ns) => { if (live) setCount(ns.reduce((a, b) => a + b, 0)); },
      () => { if (live) setCount(-1); });
    return () => { live = false; };
  }, [store]);
  var ws = model.workspace || {};
  var defn = model.definition || {};
  var tpl = ws.template ? ws.template + (ws.templateVersion ? " v" + ws.templateVersion : "") : "";
  var rows = [
    ["Template", tpl || "None recorded"],
    ["Definition version", defn.version !== undefined ? String(defn.version) : "Not recorded"],
    ["Desk template", /^[0-9]/.test(DESK_TEMPLATE_VERSION) ? "RoutineOS v" + DESK_TEMPLATE_VERSION : "Not recorded"],
    ["Lint at publish", lintText(ws.lint)],
    ["Documents", count === null ? "Counting" : count < 0 ? "Could not count" : count.toLocaleString("en-US") + " of " + SETTINGS_CAP_TEXT + " documents"],
  ];
  return (
    <Section id="about" title="About">
      {tpl ? <Text>{"Created from template " + tpl + " by routineos new"}</Text> : null}
      <Table>
        <Table.Tbody>
          {rows.map(([k, v]) => <Table.Tr key={k}><Table.Th scope="row">{k}</Table.Th><Table.Td>{v}</Table.Td></Table.Tr>)}
        </Table.Tbody>
      </Table>
      <Text size="sm" c="dimmed">The count covers shared documents. Each person's read, done and seen marks are private and not counted here.</Text>
    </Section>
  );
}
