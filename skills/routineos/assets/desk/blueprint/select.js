// blueprint/select.js: requirement and node lookups on a Blueprint graph. Pure.

function reqs(graph) { return (graph && graph.requirements) || []; }

// The ids in a requirement's served_by that are nodes of the graph (unresolved ids are dropped).
export function servingNodes(graph, reqId) {
  var r = reqs(graph).filter(function (x) { return x.id === reqId; })[0];
  if (!r) return [];
  var ids = {};
  ((graph && graph.nodes) || []).forEach(function (n) { ids[n.id] = true; });
  return (r.served_by || []).filter(function (id) { return ids[id]; });
}

// The requirement ids a node serves, in requirement order.
export function requirementsFor(graph, nodeId) {
  return reqs(graph).filter(function (r) { return (r.served_by || []).indexOf(nodeId) !== -1; })
    .map(function (r) { return r.id; });
}

export function gaps(graph) {
  return reqs(graph).filter(function (r) { return r.gap === true; }).map(function (r) { return r.id; });
}
