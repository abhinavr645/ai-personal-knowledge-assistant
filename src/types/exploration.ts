import type { Knowledge } from "@/lib/exploration/contracts";

export interface GraphNode {
  id: string;
  name: string;
  description: string;
  category: Knowledge["concepts"][number]["category"];
  sourceIds?: readonly string[];
  expandedFrom?: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: "hierarchy" | "connection";
  label: string;
  explanation?: string;
  sourceIds?: readonly string[];
}

export interface GraphData {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
}

export interface TopicGraph extends GraphData {
  rootNodeId: string;
}
