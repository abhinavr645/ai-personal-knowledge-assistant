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

export interface Exploration {
  query: string;
  rootNodeId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  answer: TopicAnswer;
}
