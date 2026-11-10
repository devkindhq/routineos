// app/settings/members.jsx: the people seen in this workspace, derived from who wrote what (core/members.js).
import { useEffect, useState } from "react";
import { Badge, Table, Text } from "@mantine/core";
import { human } from "../../core/dates.js";
import { MEMBER_SOURCES, deriveMembers } from "../../core/members.js";
import { personName_ } from "../../core/shared.js";
import { useStore } from "../StoreContext.jsx";
import { Section, WatchState, useCtx, useWatch } from "./common.jsx";

var SPECS = {};
MEMBER_SOURCES.forEach((c) => { SPECS[c] = { collection: c }; });

export default function Members() {
  const ctx = useCtx();
  const store = useStore();
  const w = useWatch(SPECS);
  const [profiles, setProfiles] = useState({});
  var wait = WatchState({ w: w, label: "members" });
  var rows = [];
  if (!wait) {
    var docs = {};
    MEMBER_SOURCES.forEach((c) => (w.got[c] || []).forEach((d) => { docs[c + "/" + d.id] = { data: d.data }; }));
    rows = deriveMembers(docs, ctx.owner && ctx.owner.by, ctx.viewer);
  }
  var ids = rows.map((r) => r.id).join("|");
  useEffect(() => {
    var live = true;
    if (!ids || typeof store.profiles !== "function") return undefined;
    store.profiles(ids.split("|")).then((p) => { if (live) setProfiles(p || {}); }, () => {});
    return () => { live = false; };
  }, [store, ids]);
  return (
    <Section id="members" title="Members" note="Everyone who has written to this Desk. The owner set it up; members use it.">
      {wait || (rows.length ? (
        <Table>
          <Table.Thead>
            <Table.Tr><Table.Th scope="col">Name</Table.Th><Table.Th scope="col">Role</Table.Th><Table.Th scope="col">Last active</Table.Th></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((r) => (
              <Table.Tr key={r.id} data-member={r.id}>
                <Table.Td>{personName_(profiles, r.id, null) + (r.id === ctx.viewer ? " (you)" : "")}</Table.Td>
                <Table.Td><Badge variant="light" color={r.role === "Owner" ? "blue" : "gray"}>{r.role}</Badge></Table.Td>
                <Table.Td>{r.lastActive ? human(r.lastActive, Date.now(), { style: "sentence" }) : "No activity yet"}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      ) : <Text c="dimmed">No activity yet.</Text>)}
    </Section>
  );
}
