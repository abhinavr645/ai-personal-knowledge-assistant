import { useEffect, useMemo, useRef, useState } from "react";
import { postExploration } from "@/lib/exploration/client";
import {
  maxExpansionNeighbors,
  maxExplorationNodes,
  relatedRequestSchema,
  relatedResponseSchema,
  searchResponseSchema,
  type Knowledge,
} from "@/lib/exploration/contracts";
import {
  createTopicGraph,
  emptyTopicGraph,
  graphNeighbors,
  mergeKnowledge,
} from "@/lib/exploration/graph";
import { exampleExploration } from "@/lib/mock-data/example-exploration";
import {
  maxQueryLength,
  retrievalRequestSchema,
} from "@/lib/retrieval/schemas";
import type { GraphNode, TopicGraph } from "@/types/exploration";

export type Expansion =
  | { status: "loading" }
  | { status: "expanded"; knowledge: Knowledge }
  | { status: "empty" | "failed"; message: string; knowledge?: Knowledge };

interface Exploration {
  topic: string;
  graph: TopicGraph;
  knowledge: Knowledge;
  expansions: Partial<Record<string, Expansion>>;
}

type SearchState =
  | { status: "idle" }
  | { status: "loading"; query: string }
  | { status: "ready"; exploration: Exploration }
  | { status: "insufficient" | "failed"; message: string };

function cancelRequests(requests: {
  search: { query: string; controller: AbortController } | null;
  expansions: Map<string, AbortController>;
}) {
  requests.search?.controller.abort();
  requests.search = null;
  for (const controller of requests.expansions.values()) controller.abort();
  requests.expansions.clear();
}

export function useExploration() {
  const [query, setQuery] = useState("");
  const [inputError, setInputError] = useState("");
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resetRevision, setResetRevision] = useState(0);
  const requests = useRef({
    search: null as { query: string; controller: AbortController } | null,
    expansions: new Map<string, AbortController>(),
  });
  useEffect(() => {
    const active = requests.current;
    return () => cancelRequests(active);
  }, []);

  const exploration = state.status === "ready" ? state.exploration : undefined;
  const graph =
    exploration?.graph ??
    (state.status === "idle" ? exampleExploration : emptyTopicGraph);
  const node = graph.nodes.find(({ id }) => id === selectedId);
  const related = useMemo(
    () => graphNeighbors(graph, selectedId),
    [graph, selectedId],
  );
  const expansions = exploration?.expansions;
  const { loadingNodeIds, expandedNodeIds } = useMemo(() => {
    const loadingNodeIds = new Set<string>();
    const expandedNodeIds = new Set<string>();
    for (const [id, expansion] of Object.entries(expansions ?? {})) {
      if (expansion?.status === "loading") loadingNodeIds.add(id);
      if (expansion?.status === "expanded") expandedNodeIds.add(id);
    }
    return { loadingNodeIds, expandedNodeIds };
  }, [expansions]);

  function reset() {
    cancelRequests(requests.current);
    setState({ status: "idle" });
    setQuery("");
    setInputError("");
    setSelectedId(null);
    setResetRevision((revision) => revision + 1);
  }

  async function search(value: string) {
    const parsed = retrievalRequestSchema.safeParse({ query: value.trim() });
    if (!parsed.success) {
      setInputError(
        value.trim()
          ? `Enter up to ${maxQueryLength} characters.`
          : "Enter a topic or question to search.",
      );
      return;
    }
    const topic = parsed.data.query;
    const active = requests.current;
    if (active.search?.query === topic) return;
    cancelRequests(active);
    const controller = new AbortController();
    active.search = { query: topic, controller };
    setQuery(topic);
    setInputError("");
    setSelectedId(null);
    setState({ status: "loading", query: topic });
    try {
      const result = await postExploration(
        "/api/search",
        parsed.data,
        searchResponseSchema,
        controller.signal,
      );
      if (active.search?.controller !== controller) return;
      if (result.query !== topic)
        throw new Error(
          "Search returned an invalid response. Please try again.",
        );
      if (result.status === "insufficient_evidence") {
        setState({ status: "insufficient", message: result.message });
        return;
      }
      const graph = createTopicGraph(topic, result.knowledge);
      setState({
        status: "ready",
        exploration: {
          topic,
          graph,
          knowledge: result.knowledge,
          expansions: {},
        },
      });
      setSelectedId(graph.rootNodeId || null);
      setResetRevision((revision) => revision + 1);
    } catch (error) {
      if (active.search?.controller !== controller) return;
      setState({ status: "failed", message: (error as Error).message });
    } finally {
      if (active.search?.controller === controller) active.search = null;
    }
  }

  async function expand(concept: GraphNode) {
    const active = requests.current;
    if (!exploration || active.search || active.expansions.has(concept.id))
      return;
    const prior = exploration.expansions[concept.id];
    if (
      prior?.status === "expanded" ||
      prior?.status === "empty" ||
      exploration.graph.nodes.length >= maxExplorationNodes
    )
      return;

    const update = (
      resolve: (current: Exploration) => {
        expansion: Expansion;
        graph?: TopicGraph;
      },
    ) => {
      setState((current) => {
        if (controller.signal.aborted || current.status !== "ready")
          return current;
        const exploration = current.exploration;
        const next = resolve(exploration);
        return {
          status: "ready",
          exploration: {
            ...exploration,
            graph: next.graph ?? exploration.graph,
            expansions: {
              ...exploration.expansions,
              [concept.id]: next.expansion,
            },
          },
        };
      });
    };

    const controller = new AbortController();
    active.expansions.set(concept.id, controller);
    update(() => ({ expansion: { status: "loading" } }));
    try {
      const adjacent = graphNeighbors(exploration.graph, concept.id);
      const parent = exploration.graph.nodes.find(
        ({ id }) => id === concept.expandedFrom,
      );
      const neighbors = parent
        ? [parent, ...adjacent.filter(({ id }) => id !== parent.id)]
        : adjacent;
      const context = relatedRequestSchema.safeParse({
        topic: exploration.topic,
        concept: {
          id: concept.id,
          name: concept.name,
          description: concept.description,
        },
        neighbors: neighbors
          .slice(0, maxExpansionNeighbors)
          .map(({ id, name }) => ({ id, name })),
        existingConceptIds: exploration.graph.nodes.map(({ id }) => id),
      });
      if (!context.success)
        throw new Error("The selected concept could not be expanded.");
      const result = await postExploration(
        "/api/related",
        context.data,
        relatedResponseSchema,
        controller.signal,
      );
      if (active.expansions.get(concept.id) !== controller) return;
      if (result.conceptId !== concept.id || result.query !== exploration.topic)
        throw new Error(
          "Expansion returned an invalid response. Please try again.",
        );
      if (result.status === "insufficient_evidence") {
        update(() => ({
          expansion: { status: "empty", message: result.message },
        }));
        return;
      }
      const knowledge = result.knowledge;
      update((current) => {
        const merged = mergeKnowledge(current.graph, knowledge, concept.id);
        const added = merged.nodes.length - current.graph.nodes.length;
        return {
          graph:
            merged === current.graph
              ? current.graph
              : { ...merged, rootNodeId: current.graph.rootNodeId },
          expansion: added
            ? { status: "expanded", knowledge }
            : {
                status: "empty",
                knowledge,
                message: "No additional concepts found.",
              },
        };
      });
    } catch (error) {
      if (active.expansions.get(concept.id) !== controller) return;
      update(() => ({
        expansion: { status: "failed", message: (error as Error).message },
      }));
    } finally {
      if (active.expansions.get(concept.id) === controller)
        active.expansions.delete(concept.id);
    }
  }

  const expansion = node && expansions?.[node.id];
  // Keep source records available for concept descriptions from every batch.
  const conceptSources = useMemo(() => {
    const sources = new Map(
      exploration?.knowledge.sources.map((source) => [source.id, source]),
    );
    for (const expansion of Object.values(expansions ?? {})) {
      if (expansion && "knowledge" in expansion) {
        for (const source of expansion.knowledge?.sources ?? [])
          sources.set(source.id, source);
      }
    }
    return sources;
  }, [exploration?.knowledge.sources, expansions]);

  return {
    query,
    changeQuery(value: string) {
      setQuery(value);
      setInputError("");
    },
    inputError,
    state,
    graph,
    resetRevision,
    node,
    related,
    selectedId,
    selectNode: setSelectedId,
    expansion,
    conceptSources,
    graphFull: graph.nodes.length >= maxExplorationNodes,
    expandedNodeIds,
    loadingNodeIds,
    reset,
    search,
    expand,
  };
}
