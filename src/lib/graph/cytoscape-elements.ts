import type { Core, EdgeDefinition, NodeDefinition } from "cytoscape";
import type { GraphData, GraphEdge, GraphNode } from "@/types/exploration";

export const nodeElementId = (id: string) => `node:${id}`;
const edgeElementId = (id: string) => `edge:${id}`;

export function toCytoscapeNode(node: GraphNode) {
  return {
    group: "nodes",
    data: {
      id: nodeElementId(node.id),
      graphId: node.id,
      label: node.name,
      category: node.category,
      expandedFrom: node.expandedFrom,
    },
  } satisfies NodeDefinition;
}

export function toCytoscapeEdge(edge: GraphEdge) {
  return {
    group: "edges",
    data: {
      id: edgeElementId(edge.id),
      source: nodeElementId(edge.source),
      target: nodeElementId(edge.target),
      relationship: edge.label,
      kind: edge.kind,
    },
  } satisfies EdgeDefinition;
}

export function syncGraphElements(core: Core, graph: GraphData) {
  const nodes = graph.nodes.map(toCytoscapeNode);
  const edges = graph.edges.map(toCytoscapeEdge);
  const nextIds = new Set([...nodes, ...edges].map(({ data }) => data.id));
  const addedNodeIds = new Set<string>();

  core.batch(() => {
    core
      .elements()
      .filter((element) => !nextIds.has(element.id()))
      .remove();

    for (const node of nodes) {
      const current = core.$id(node.data.id);
      if (current.empty()) {
        core.add(node);
        addedNodeIds.add(node.data.id);
      } else if (
        current.data("label") !== node.data.label ||
        current.data("category") !== node.data.category ||
        current.data("expandedFrom") !== node.data.expandedFrom
      ) {
        current.data(node.data);
      }
    }

    for (const edge of edges) {
      const current = core.$id(edge.data.id);
      if (current.empty()) {
        core.add(edge);
        continue;
      }
      if (
        current.data("source") !== edge.data.source ||
        current.data("target") !== edge.data.target
      ) {
        current
          .edges()
          .move({ source: edge.data.source, target: edge.data.target });
      }
      if (
        current.data("relationship") !== edge.data.relationship ||
        current.data("kind") !== edge.data.kind
      ) {
        current.data(edge.data);
      }
    }
  });

  return core.nodes().filter((node) => addedNodeIds.has(node.id()));
}

export interface GraphPresentation {
  rootNodeId: string;
  selectedId: string | null;
  expandedNodeIds?: ReadonlySet<string>;
  loadingNodeIds?: ReadonlySet<string>;
  showLabels: boolean;
}

export function presentGraph(
  core: Core,
  state: GraphPresentation,
  compact: boolean,
) {
  const selected =
    state.selectedId === null
      ? core.collection()
      : core.$id(nodeElementId(state.selectedId));
  const neighbors = selected.neighborhood();
  const focus = selected.union(neighbors);

  core.batch(() => {
    core.nodes().forEach((node) => {
      const id: string = node.data("graphId");
      node.toggleClass("is-root", id === state.rootNodeId);
      node.toggleClass("is-selected", id === state.selectedId);
      node.toggleClass("is-neighbor", neighbors.contains(node));
      node.toggleClass("is-expanded", state.expandedNodeIds?.has(id) ?? false);
      node.toggleClass("is-loading", state.loadingNodeIds?.has(id) ?? false);
      node.toggleClass(
        "is-dimmed",
        selected.nonempty() && !focus.contains(node),
      );
    });

    core.edges().forEach((edge) => {
      const connected = neighbors.contains(edge);
      edge.toggleClass("is-connected", connected);
      edge.toggleClass("is-dimmed", selected.nonempty() && !connected);
      edge.toggleClass("show-label", state.showLabels && !compact);
    });
  });
}
