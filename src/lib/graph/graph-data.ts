import type { GraphData, GraphEdge, GraphNode } from "@/types/exploration";

/** Keep the first definition of each ID and accept only edges with known endpoints. */
export function mergeGraph(current: GraphData, incoming: GraphData): GraphData {
  const nodes = new Map<string, GraphNode>();
  for (const node of [...current.nodes, ...incoming.nodes]) {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  }

  const edges = new Map<string, GraphEdge>();
  for (const edge of [...current.edges, ...incoming.edges]) {
    if (
      !edges.has(edge.id) &&
      nodes.has(edge.source) &&
      nodes.has(edge.target)
    ) {
      edges.set(edge.id, edge);
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
