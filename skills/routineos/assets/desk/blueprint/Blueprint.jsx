// blueprint/Blueprint.jsx: #/x/blueprint. The routine drawn as parts and links, read only. Positions come from dagre at
// render time; a dragged card keeps its place in component state and nothing is written to the store.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Anchor, Badge, Button, Card, Group, Stack, Switch, Text, Title, useComputedColorScheme } from "@mantine/core";
import { useMediaQuery, useReducedMotion } from "@mantine/hooks";
import { Background, MiniMap, ReactFlow, ReactFlowProvider, applyNodeChanges, useReactFlow } from "@xyflow/react";
import Legend from "./Legend.jsx";
import NodeCard from "./NodeCard.jsx";
import NodeDrawer from "./NodeDrawer.jsx";
import Requirements from "./Requirements.jsx";
import { STATE_COLOR } from "./kinds.js";
import { layout } from "./layout.js";
import { requirementsFor, servingNodes } from "./select.js";

var NODE_TYPES = { bp: NodeCard };
var NONE = [];
var CSS = [
  ".bp-minimap-slot { position: absolute; right: 12px; bottom: 12px; z-index: 5; }",
  ".bp-minimap-slot .react-flow__minimap { position: static; margin: 0; }",
].join("\n");

function Approval({ approval }) {
  if (!approval) return <Badge data-testid="bp-approval" color="gray" variant="light">not approved</Badge>;
  var text = approval.matches ? "approved v" + approval.version : "changed since approved v" + approval.version;
  return <Badge data-testid="bp-approval" color={approval.matches ? "green" : "orange"} variant="light">{text}</Badge>;
}

function Canvas({ graph }) {
  var flow = useReactFlow();
  var scheme = useComputedColorScheme("light");
  var narrow = useMediaQuery("(max-width: 520px)", false, { getInitialValueInEffect: false });
  var reduced = useReducedMotion();
  var wrap = useRef(null);
  var [scrollZoom, setScrollZoom] = useState(true);
  var [selected, setSelected] = useState(null);
  var [open, setOpen] = useState(null);
  var base = useMemo(function () { return layout(graph); }, [graph]);
  var [moved, setMoved] = useState(function () { return base.nodes; });
  useEffect(function () { setMoved(base.nodes); }, [base]);

  var lit = useMemo(function () { return selected ? servingNodes(graph, selected) : NONE; }, [graph, selected]);
  var dimming = lit.length > 0;
  var served = useMemo(function () { return open ? requirementsFor(graph, open) : NONE; }, [graph, open]);

  var onOpen = useCallback(function (id) { setOpen(id); }, []);
  var nodes = useMemo(function () {
    return moved.map(function (n) {
      return Object.assign({}, n, { draggable: true, data: Object.assign({}, n.data, { onOpen: onOpen, open: open === n.id, dim: dimming && lit.indexOf(n.id) === -1 }) });
    });
  }, [moved, lit, dimming, open, onOpen]);
  var edges = useMemo(function () {
    return base.edges.map(function (e) {
      var on = !dimming || (lit.indexOf(e.source) !== -1 && lit.indexOf(e.target) !== -1);
      return Object.assign({}, e, { focusable: false, style: { opacity: on ? 1 : 0.25 } });
    });
  }, [base, lit, dimming]);

  var duration = reduced ? 0 : 250;
  var fit = useCallback(function (ids) {
    flow.fitView(ids ? { nodes: ids.map(function (id) { return { id: id }; }), padding: 0.4, maxZoom: 1.2, duration: duration } : { padding: 0.15, duration: duration });
  }, [flow, duration]);

  function select(id) {
    setSelected(id);
    var ids = servingNodes(graph, id);
    if (ids.length) fit(ids);
  }
  function showAll() { setSelected(null); fit(null); }

  // One finger scrolls the page and two fingers pan and zoom. The pane keeps touch-action none, so every touch reaches
  // the page's own handlers. d3-zoom sees every touchstart and touchend, so a second finger registers as a pinch with
  // the first. A touchmove with a single finger is stopped before d3-zoom and scrolls the nearest scrollable ancestor
  // instead.
  useEffect(function () {
    var el = wrap.current;
    if (!el) return undefined;
    var lastY = null;
    var scroller = null;
    function scrollParent() {
      for (var p = el.parentElement; p; p = p.parentElement) {
        var oy = getComputedStyle(p).overflowY;
        if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
      }
      return document.scrollingElement;
    }
    function onStart(e) {
      lastY = e.touches.length === 1 ? e.touches[0].clientY : null;
      scroller = lastY === null ? null : scrollParent();
    }
    function onMove(e) {
      if (e.touches.length !== 1) { lastY = null; return; }
      e.stopPropagation();
      var y = e.touches[0].clientY;
      if (lastY !== null && scroller) scroller.scrollTop -= y - lastY;
      lastY = y;
    }
    function onEnd(e) { lastY = e.touches.length === 1 ? e.touches[0].clientY : null; }
    el.addEventListener("touchstart", onStart, { capture: true, passive: true });
    el.addEventListener("touchmove", onMove, { capture: true, passive: true });
    el.addEventListener("touchend", onEnd, { capture: true, passive: true });
    return function () {
      el.removeEventListener("touchstart", onStart, { capture: true });
      el.removeEventListener("touchmove", onMove, { capture: true });
      el.removeEventListener("touchend", onEnd, { capture: true });
    };
  }, []);

  var openNode = open ? graph.nodes.filter(function (n) { return n.id === open; })[0] : null;
  var reqs = graph.requirements || NONE;
  return (
    <Stack gap="md">
      <style>{CSS}</style>
      <Group gap="sm" justify="space-between">
        <Group gap="sm">
          <Approval approval={graph.approval} />
          <Switch data-testid="bp-scrollzoom" label="Scroll zooms canvas" checked={scrollZoom} onChange={function (e) { setScrollZoom(e.currentTarget.checked); }} />
        </Group>
        <Button data-testid="bp-fit" variant="default" size="xs" onClick={function () { fit(null); }}>Fit view</Button>
      </Group>
      <Legend />
      <div ref={wrap} className="bp-flow" data-testid="bp-canvas" style={{ height: 520, border: "1px solid var(--mantine-color-default-border)", borderRadius: 8, overflow: "hidden" }}>
        <ReactFlow
          nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} colorMode={scheme}
          onNodesChange={function (changes) { setMoved(function (cur) { return applyNodeChanges(changes.filter(function (c) { return c.type === "position" || c.type === "dimensions"; }), cur); }); }}
          nodesConnectable={false} edgesFocusable={false} nodesFocusable={false} elementsSelectable={false}
          zoomOnScroll={scrollZoom} preventScrolling={scrollZoom} zoomOnPinch={true} zoomOnDoubleClick={false} panOnDrag={true}
          minZoom={0.2} maxZoom={2} fitView fitViewOptions={{ padding: 0.15 }}
        >
          <Background />
          {narrow ? null : <div className="bp-minimap-slot" data-testid="bp-minimap"><MiniMap pannable zoomable ariaLabel="Overview of the routine" nodeColor={function (n) { return "var(--mantine-color-" + (STATE_COLOR[n.data.state == null ? "null" : n.data.state] || "gray") + "-6)"; }} /></div>}
        </ReactFlow>
      </div>
      <Requirements requirements={reqs} selected={selected} highlighted={served} onSelect={select} onShowAll={showAll} />
      <NodeDrawer node={openNode} requirements={reqs} onClose={function () { setOpen(null); }} />
    </Stack>
  );
}

export default function Blueprint({ graph }) {
  if (!graph || !Array.isArray(graph.nodes)) {
    return (
      <Stack gap="sm">
        <Title id="page-title" order={1}>Blueprint</Title>
        <Card withBorder padding="md"><Text>This routine has no Blueprint.</Text></Card>
        <Anchor href="#/today">Back to Today</Anchor>
      </Stack>
    );
  }
  return (
    <Stack gap="md">
      <Title id="page-title" order={1}>Blueprint</Title>
      <Anchor href="#/today" size="sm">Back to Today</Anchor>
      <ReactFlowProvider><Canvas graph={graph} /></ReactFlowProvider>
    </Stack>
  );
}
