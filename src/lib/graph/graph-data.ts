import type { GraphData, GraphEdge, GraphNode } from "@/types/exploration";

/** Keep the first definition of each ID and accept only edges with known endpoints. */
export function mergeGraph(current: GraphData, incoming: GraphData): GraphData {
  const nodes = new Map<string, GraphNode>();
  for (const node of [...current.nodes, ...incoming.nodes]) {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  }

  const edges = new Map<string, GraphEdge>();
  const relationships = new Set<string>();
  for (const edge of [...current.edges, ...incoming.edges]) {
    const endpoints = [edge.source, edge.target];
    if (edge.label === "relates to") endpoints.sort();
    const key = JSON.stringify([edge.kind, edge.label, ...endpoints]);
    if (
      !edges.has(edge.id) &&
      !relationships.has(key) &&
      edge.source !== edge.target &&
      nodes.has(edge.source) &&
      nodes.has(edge.target)
    ) {
      edges.set(edge.id, edge);
      relationships.add(key);
    }
  }

  if (
    nodes.size === current.nodes.length &&
    edges.size === current.edges.length &&
    current.nodes.every((node) => nodes.get(node.id) === node) &&
    current.edges.every((edge) => edges.get(edge.id) === edge)
  ) {
    return current;
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
