export interface GraphNode {
  id: string;
  name: string;
  description: string;
  category: "Field" | "Method" | "Learning approach";
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: "hierarchy" | "connection";
  label: string;
}

export interface SourceReference {
  id: string;
  label: string;
  status: "placeholder";
}

export interface TopicAnswer {
  title: string;
  introduction: string;
  sections: { title: string; text: string }[];
  takeaways: string[];
  sources: SourceReference[];
}

export interface GraphData {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
}

export interface Exploration extends GraphData {
  query: string;
  rootNodeId: string;
  answer: TopicAnswer;
}
