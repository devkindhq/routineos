import { describe, expect, it } from "vitest";
import { layout } from "../blueprint/layout.js";
import { gaps, requirementsFor, servingNodes } from "../blueprint/select.js";
import { KIND_ICON, STATE_COLOR } from "../blueprint/kinds.js";

var NODE_KINDS = ["trigger", "routine", "stage", "connector", "mcp", "http", "infra", "store", "gate", "output", "setting", "secret"];

function node(id, kind, extra) {
  return Object.assign({ id: id, kind: kind, label: id, name: id, state: null, needs: null, source: { file: "routine.toml", key: "k" }, serves: [], detail: {} }, extra);
}

var GRAPH = {
  format: "routineos.blueprint.v1",
  nodes: [
    node("trigger:schedule", "trigger"),
    node("routine:r", "routine"),
    node("stage:fetch", "stage", { serves: ["fresh"] }),
    node("stage:write", "stage"),
    node("http:web", "http", { state: "docs" }),
    node("output:desk", "output", { serves: ["report"] }),
  ],
  edges: [
    { from: "trigger:schedule", to: "routine:r", type: "starts", label: null },
    { from: "routine:r", to: "stage:fetch", type: "runs", label: null },
    { from: "http:web", to: "stage:fetch", type: "reads", label: null },
    { from: "stage:fetch", to: "stage:write", type: "next", label: null },
    { from: "stage:write", to: "output:desk", type: "shows", label: null },
  ],
  requirements: [
    { id: "fresh", text: "Pages are checked", served_by: ["stage:fetch", "ghost:none"], unresolved: ["ghost:none"], gap: false },
    { id: "report", text: "I get a report", served_by: ["output:desk"], unresolved: [], gap: false },
    { id: "alerts", text: "I get alerts", served_by: [], unresolved: [], gap: true },
  ],
  approval: null, hash: "sha256:x", warnings: [],
};

describe("layout", () => {
  var out = layout(GRAPH);
  var byId = Object.fromEntries(out.nodes.map((n) => [n.id, n]));
  it("puts the schedule trigger leftmost", () => {
    var min = Math.min(...out.nodes.map((n) => n.position.x));
    expect(byId["trigger:schedule"].position.x).toBe(min);
  });
  it("places every edge target to the right of its source", () => {
    expect(out.edges.length).toBe(GRAPH.edges.length);
    out.edges.forEach((e) => expect(byId[e.target].position.x).toBeGreaterThan(byId[e.source].position.x));
  });
  it("gives every node a numeric position and its graph node as data", () => {
    expect(out.nodes.length).toBe(GRAPH.nodes.length);
    out.nodes.forEach((n) => {
      expect(Number.isFinite(n.position.x)).toBe(true);
      expect(Number.isFinite(n.position.y)).toBe(true);
      expect(n.data.id).toBe(n.id);
    });
  });
  it("does not mutate the graph", () => {
    expect(GRAPH.nodes[0].position).toBeUndefined();
  });
});

describe("select", () => {
  it("servingNodes returns the resolved ids only", () => {
    expect(servingNodes(GRAPH, "fresh")).toEqual(["stage:fetch"]);
    expect(servingNodes(GRAPH, "report")).toEqual(["output:desk"]);
    expect(servingNodes(GRAPH, "alerts")).toEqual([]);
    expect(servingNodes(GRAPH, "nope")).toEqual([]);
  });
  it("gaps lists the requirements with gap true", () => {
    expect(gaps(GRAPH)).toEqual(["alerts"]);
  });
  it("requirementsFor returns the requirement ids a node serves", () => {
    expect(requirementsFor(GRAPH, "stage:fetch")).toEqual(["fresh"]);
    expect(requirementsFor(GRAPH, "output:desk")).toEqual(["report"]);
    expect(requirementsFor(GRAPH, "stage:write")).toEqual([]);
    expect(requirementsFor(GRAPH, "nope")).toEqual([]);
  });
});

describe("kinds", () => {
  it("has an icon for every node kind", () => {
    NODE_KINDS.forEach((k) => expect(KIND_ICON[k], k).toBeTruthy());
  });
  it("maps states to colours, conflict red and none gray", () => {
    expect(STATE_COLOR.conflict).toBe("red");
    expect(STATE_COLOR.null).toBe("gray");
    ["verified", "docs", "unverified", "needs-research", "needs-building"].forEach((s) => expect(STATE_COLOR[s], s).toBeTruthy());
  });
});
