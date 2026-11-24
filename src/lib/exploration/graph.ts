import { mergeGraph } from "@/lib/graph/graph-data";
import type { GraphData, TopicGraph } from "@/types/exploration";
import { maxExplorationNodes, type Knowledge } from "./contracts";

export const emptyTopicGraph: TopicGraph = {
  rootNodeId: "",
  nodes: [],
  edges: [],
};

const labels = {
  IS_A: "is a",
  PART_OF: "is part of",
  USES: "uses",
  DEPENDS_ON: "depends on",
  RELATED_TO: "relates to",
  IMPLEMENTS: "implements",
  EXTENDS: "extends",
};

export function mergeKnowledge(
  graph: GraphData,
  knowledge: Knowledge,
  anchor?: string,
) {
  const known = new Set(graph.nodes.map(({ id }) => id));
  const nodes = [];
  for (const concept of knowledge.concepts) {
    if (known.size === maxExplorationNodes) break;
    if (known.has(concept.id)) continue;
    known.add(concept.id);
    nodes.push(anchor ? { ...concept, expandedFrom: anchor } : concept);
  }
  return mergeGraph(graph, {
    nodes,
    edges: knowledge.relationships.map((relationship) => ({
      id: relationship.id,
      source: relationship.sourceConceptId,
      target: relationship.targetConceptId,
      kind:
        relationship.type === "IS_A" || relationship.type === "PART_OF"
          ? "hierarchy"
          : "connection",
      label: labels[relationship.type],
      explanation: relationship.explanation,
      sourceIds: relationship.sourceIds,
    })),
  });
}

const comparable = (text: string) =>
  text.normalize("NFKC").toLowerCase().trim().replace(/\s+/gu, " ");

export function createTopicGraph(
  topic: string,
  knowledge: Knowledge,
): TopicGraph {
  const graph = mergeKnowledge(emptyTopicGraph, knowledge);
  const root =
    graph.nodes.find(({ name }) => comparable(name) === comparable(topic)) ??
    graph.nodes.find(
      ({ name }) =>
        comparable(name) === comparable(knowledge.explanation.title),
    ) ??
    graph.nodes[0];
  return { ...graph, rootNodeId: root?.id ?? "" };
}

export function graphNeighbors(graph: GraphData, selectedId: string | null) {
  const ids = new Set<string>();
  for (const { source, target } of graph.edges) {
    if (source === selectedId) ids.add(target);
    if (target === selectedId) ids.add(source);
  }
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  return [...ids].flatMap((id) => {
    const node = byId.get(id);
    return node ? [node] : [];
  });
}
