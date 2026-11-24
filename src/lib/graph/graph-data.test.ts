import { expect, test } from "vitest";
import { exampleExploration } from "@/lib/mock-data/example-exploration";
import type { GraphEdge, GraphNode } from "@/types/exploration";
import { mergeGraph } from "./graph-data";
import { toCytoscapeEdge, toCytoscapeNode } from "./cytoscape-elements";

const [learning, intelligence] = exampleExploration.nodes;
const [partOf] = exampleExploration.edges;

test("maps graph identifiers, display labels and relationship endpoints to Cytoscape", () => {
  expect(toCytoscapeNode(learning)).toEqual({
    group: "nodes",
    data: {
      id: "node:machine-learning",
      graphId: "machine-learning",
      label: "Machine Learning",
      category: "Field",
    },
  });
  expect(toCytoscapeEdge(partOf)).toEqual({
    group: "edges",
    data: {
      id: "edge:ml-ai",
      source: "node:machine-learning",
      target: "node:artificial-intelligence",
      relationship: "is a branch of",
      kind: "hierarchy",
    },
  });
});

test("merges valid additions without replacing existing nodes or edges", () => {
  const extra: GraphNode = {
    id: "model",
    name: "Model",
    description: "A learned mapping.",
    category: "Method",
  };
  const connection: GraphEdge = {
    id: "ml-model",
    source: learning.id,
    target: extra.id,
    label: "trains",
    kind: "connection",
  };
  const existing = { nodes: [learning, intelligence], edges: [partOf] };

  const merged = mergeGraph(existing, {
    nodes: [
      { ...learning, name: "Duplicate" },
      extra,
      { ...extra, name: "Repeated" },
    ],
    edges: [
      { ...partOf, label: "Duplicate" },
      { ...connection, id: "missing-source", source: "unknown" },
      { ...connection, id: "missing-target", target: "unknown" },
      connection,
      { ...connection, label: "Repeated" },
    ],
  });

  expect(merged.nodes).toEqual([learning, intelligence, extra]);
  expect(merged.nodes[0]).toBe(learning);
  expect(merged.edges).toEqual([partOf, connection]);
  expect(merged.edges[0]).toBe(partOf);
  expect(existing.nodes).toHaveLength(2);
  expect(existing.edges).toHaveLength(1);
  expect(mergeGraph(merged, { nodes: [extra], edges: [connection] })).toBe(
    merged,
  );
});

test("normalizes duplicates and dangling edges in the starting graph", () => {
  expect(
    mergeGraph(
      {
        nodes: [learning, learning, intelligence],
        edges: [
          partOf,
          partOf,
          { ...partOf, id: "dangling", target: "unknown" },
        ],
      },
      { nodes: [], edges: [] },
    ),
  ).toEqual({ nodes: [learning, intelligence], edges: [partOf] });
});
