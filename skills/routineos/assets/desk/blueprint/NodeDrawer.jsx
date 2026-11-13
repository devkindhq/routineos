// blueprint/NodeDrawer.jsx: what a part is, its state, where it is declared, what it needs and the requirements it serves.
import { Badge, Code, Drawer, Group, List, Stack, Text } from "@mantine/core";
import { STATE_COLOR, STATE_LABEL } from "./kinds.js";

var DETAIL_LABEL = { purpose: "Purpose", what: "What it does", deploys: "Deploys", access: "Access", infra_kind: "Kind", connector_kind: "Kind" };

function detailRows(node) {
  var d = node.detail || {};
  return Object.keys(DETAIL_LABEL).filter(function (k) { return typeof d[k] === "string" && d[k]; })
    .map(function (k) { return [DETAIL_LABEL[k], d[k]]; });
}

export default function NodeDrawer({ node, requirements, onClose }) {
  var key = node && node.state != null ? node.state : "null";
  var rows = node ? detailRows(node) : [];
  var served = node ? requirements.filter(function (r) { return (r.served_by || []).indexOf(node.id) !== -1; }) : [];
  return (
    <Drawer opened={!!node} onClose={onClose} position="right" size="md" title={node ? node.label : ""} withinPortal>
      {node ? (
        <Stack gap="md" data-testid="bp-drawer">
          <Group gap="xs">
            <Badge variant="outline" color="gray">{node.kind}</Badge>
            <Badge color={STATE_COLOR[key]}>{STATE_LABEL[key]}</Badge>
            {node.origin === "pack" ? <Badge data-testid="bp-drawer-pack" color="yellow" variant="light">from a pack, unconfirmed</Badge> : null}
          </Group>
          {rows.map(function (r) { return <Text key={r[0]} size="sm"><b>{r[0]}:</b> {r[1]}</Text>; })}
          <div>
            <Text size="sm" fw={600}>Declared in</Text>
            <Text size="sm"><Code>{node.source.file}</Code> <Code>{node.source.key}</Code></Text>
          </div>
          {node.needs ? <div><Text size="sm" fw={600}>Needs</Text><Text size="sm">{node.needs}</Text></div> : null}
          <div>
            <Text size="sm" fw={600}>Requirements served</Text>
            {served.length ? <List size="sm">{served.map(function (r) { return <List.Item key={r.id}>{r.text}</List.Item>; })}</List>
              : <Text size="sm" c="dimmed">None.</Text>}
          </div>
        </Stack>
      ) : null}
    </Drawer>
  );
}
