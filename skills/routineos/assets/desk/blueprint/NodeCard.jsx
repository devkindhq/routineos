// blueprint/NodeCard.jsx: one part of the routine. The border colour is its state; the icon is generic by kind.
import { useRef } from "react";
import { Badge, Group, Text, UnstyledButton } from "@mantine/core";
import { Handle, Position } from "@xyflow/react";
import { KIND_ICON, STATE_COLOR, STATE_LABEL } from "./kinds.js";
import { NODE_H, NODE_W } from "./layout.js";

var CLICK_SLOP = 4;

export default function NodeCard({ data }) {
  var down = useRef(null);
  var Icon = KIND_ICON[data.kind];
  var key = data.state == null ? "null" : data.state;
  var color = STATE_COLOR[key] || "gray";
  var state = STATE_LABEL[key] || String(data.state);
  var dimmed = data.dim === true;
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} style={{ visibility: "hidden" }} />
      <UnstyledButton
        data-testid={"bp-node-" + data.id}
        aria-label={data.label + ", " + data.kind + ", " + state}
        onPointerDown={function (e) { down.current = { x: e.clientX, y: e.clientY }; }}
        onClick={function (e) {
          // a drag that ends on the card is not a click
          if (down.current && Math.hypot(e.clientX - down.current.x, e.clientY - down.current.y) > CLICK_SLOP) return;
          data.onOpen(data.id);
        }}
        style={{
          width: NODE_W, height: NODE_H, padding: "6px 10px", borderRadius: 8, boxSizing: "border-box",
          border: "2px solid var(--mantine-color-" + color + "-6)",
          background: "var(--mantine-color-body)", opacity: dimmed ? 0.25 : 1,
          outline: data.open ? "2px solid var(--mantine-color-" + color + "-3)" : "none", outlineOffset: 2,
        }}
      >
        <Group gap={6} wrap="nowrap">
          {Icon ? <Icon size={16} aria-hidden="true" style={{ flex: "none" }} /> : null}
          <Text size="sm" fw={600} truncate>{data.label}</Text>
        </Group>
        <Badge size="xs" variant="light" color={color} mt={4}>{state}</Badge>
      </UnstyledButton>
      <Handle type="source" position={Position.Right} isConnectable={false} style={{ visibility: "hidden" }} />
    </>
  );
}
