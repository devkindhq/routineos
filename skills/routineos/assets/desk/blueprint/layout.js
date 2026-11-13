// blueprint/layout.js: graph (routineos.blueprint.v1, no coordinates) -> React Flow nodes and edges, left to right.
// Pure: no DOM, no input mutation. Positions are computed here at render time (spec 6.1).
import dagre from "@dagrejs/dagre";

export var NODE_W = 196;
export var NODE_H = 64;

export function layout(graph) {
  var g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: "LR", nodesep: 28, ranksep: 64, marginx: 16, marginy: 16 });
  g.setDefaultEdgeLabel(function () { return {}; });
  var nodes = (graph && graph.nodes) || [];
  var ids = {};
  nodes.forEach(function (n) { ids[n.id] = true; g.setNode(n.id, { width: NODE_W, height: NODE_H }); });
  var edges = ((graph && graph.edges) || []).filter(function (e) { return ids[e.from] && ids[e.to]; });
  edges.forEach(function (e) { g.setEdge(e.from, e.to, {}, e.from + ">" + e.to + ":" + e.type); });
  dagre.layout(g);
  return {
    nodes: nodes.map(function (n) {
      var p = g.node(n.id);
      return { id: n.id, type: "bp", position: { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 }, data: n };
    }),
    edges: edges.map(function (e) {
      return { id: e.from + ">" + e.to + ":" + e.type, source: e.from, target: e.to, label: e.label || undefined, data: { type: e.type } };
    }),
  };
}
