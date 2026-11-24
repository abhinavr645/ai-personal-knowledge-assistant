import { z } from "zod";
import {
  knowledgeSourceSchema,
  maxEvidenceItems,
} from "@/lib/ai/evidence-schemas";
import {
  conceptIdSchema,
  knowledgeExplanationSchema,
  maxGeneratedRelationships,
  modelKnowledgeSchema,
  relationshipIdSchema,
} from "@/lib/ai/schemas";
import type { GraphLayoutPositions } from "@/lib/graph/cytoscape-layout";
import { mergeGraph } from "@/lib/graph/graph-data";
import { retrievalRequestSchema } from "@/lib/retrieval/schemas";
import type { TopicGraph } from "@/types/exploration";
import { maxExplorationNodes, type DisplayKnowledge } from "./contracts";
import { emptyTopicGraph } from "./graph";

export const historyVersion = 1;
export const maxHistoryTitleLength = 120;
export const historyTitleSchema = z
  .string()
  .trim()
  .min(1)
  .max(maxHistoryTitleLength);
export const historyIdSchema = z.uuid();
const sourceId = knowledgeSourceSchema.shape.id;
const graphSourceIds = z.array(sourceId).max(4).optional();
const coordinate = z.number().min(-1_000_000).max(1_000_000);

const graphSchema = z.strictObject({
  rootNodeId: z.union([conceptIdSchema, z.literal("")]),
  nodes: z
    .array(
      modelKnowledgeSchema.shape.concepts.element.extend({
        id: conceptIdSchema,
        sourceIds: graphSourceIds,
        expandedFrom: conceptIdSchema.optional(),
      }),
    )
    .max(maxExplorationNodes),
  edges: z
    .array(
      z.strictObject({
        id: relationshipIdSchema,
        source: conceptIdSchema,
        target: conceptIdSchema,
        kind: z.enum(["hierarchy", "connection"]),
        label: z.string().min(1).max(32),
        explanation: z.string().min(1).max(360).optional(),
        sourceIds: graphSourceIds,
      }),
    )
    .max((maxExplorationNodes + 1) * maxGeneratedRelationships),
});

const explanationRecord = z.strictObject({
  explanation: knowledgeExplanationSchema,
  evidenceNote: modelKnowledgeSchema.shape.evidenceNote,
  sourceIds: z.array(sourceId).max(maxEvidenceItems),
});
const finishedExpansion = z.discriminatedUnion("status", [
  z.strictObject({
    nodeId: conceptIdSchema,
    status: z.literal("expanded"),
    knowledge: explanationRecord,
  }),
  z.strictObject({
    nodeId: conceptIdSchema,
    status: z.literal("empty"),
    knowledge: explanationRecord.optional(),
  }),
]);

const snapshotContentSchema = z
  .strictObject({
    topic: retrievalRequestSchema.shape.query,
    graph: graphSchema,
    selectedId: conceptIdSchema.nullable(),
    positions: z
      .record(conceptIdSchema, z.strictObject({ x: coordinate, y: coordinate }))
      .optional(),
    overview: explanationRecord,
    expansions: z.array(finishedExpansion).max(maxExplorationNodes),
    sources: z
      .array(knowledgeSourceSchema.strict())
      .max((maxExplorationNodes + 1) * maxEvidenceItems),
  })
  .refine(({ graph, positions, expansions, sources, overview }) => {
    const merged = mergeGraph(emptyTopicGraph, graph);
    if (
      merged.nodes.length !== graph.nodes.length ||
      merged.edges.length !== graph.edges.length
    )
      return false;
    const nodes = new Set(graph.nodes.map(({ id }) => id));
    if (nodes.size ? !nodes.has(graph.rootNodeId) : graph.rootNodeId !== "")
      return false;
    if (
      graph.nodes.some(
        ({ id, expandedFrom }) =>
          expandedFrom && (id === expandedFrom || !nodes.has(expandedFrom)),
      )
    )
      return false;
    if (Object.keys(positions ?? {}).some((id) => !nodes.has(id))) return false;

    const expanded = new Set(expansions.map(({ nodeId }) => nodeId));
    if (
      expanded.size !== expansions.length ||
      expansions.some(({ nodeId }) => !nodes.has(nodeId))
    )
      return false;
    const sourceIds = new Set(sources.map(({ id }) => id));
    if (sourceIds.size !== sources.length) return false;
    if (
      [...graph.nodes, ...graph.edges].some((item) =>
        item.sourceIds?.some((id) => !sourceIds.has(id)),
      )
    )
      return false;
    return [
      overview,
      ...expansions.flatMap((entry) =>
        entry.knowledge ? [entry.knowledge] : [],
      ),
    ].every((record) => {
      const ownSources = new Set(record.sourceIds);
      const { summary, detail, sections, takeaways } = record.explanation;
      return (
        ownSources.size === record.sourceIds.length &&
        record.sourceIds.every((id) => sourceIds.has(id)) &&
        [summary, detail, ...sections, ...takeaways].every((claim) =>
          claim.sourceIds.every((id) => ownSources.has(id)),
        )
      );
    });
  }, "Expected a consistent graph and citation references");

const snapshotV1 = z
  .strictObject({
    version: z.literal(historyVersion),
    id: historyIdSchema,
    title: historyTitleSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    content: snapshotContentSchema,
  })
  .refine(
    ({ createdAt, updatedAt }) =>
      Date.parse(createdAt) <= Date.parse(updatedAt),
  );

export type HistorySnapshot = z.infer<typeof snapshotV1>;
export type HistoryContent = HistorySnapshot["content"];
export type HistorySummary = Pick<
  HistorySnapshot,
  "id" | "title" | "updatedAt"
> & { conceptCount: number };

export type CompletedExpansion =
  | { status: "expanded"; knowledge: DisplayKnowledge }
  | { status: "empty"; knowledge?: DisplayKnowledge };

export interface ExplorationContent {
  topic: string;
  graph: TopicGraph;
  knowledge: DisplayKnowledge;
  expansions: Readonly<Partial<Record<string, CompletedExpansion>>>;
}

export function summarize(snapshot: HistorySnapshot): HistorySummary {
  const { id, title, updatedAt, content } = snapshot;
  return { id, title, updatedAt, conceptCount: content.graph.nodes.length };
}

// Future versions can migrate older records here and validate the result.
// Unknown versions are left untouched in storage.
export function decodeSnapshot(value: unknown) {
  return snapshotV1.safeParse(value);
}

export function snapshotContent(
  exploration: ExplorationContent,
  selectedId: string | null,
  positions?: GraphLayoutPositions,
) {
  const sources = new Map<string, DisplayKnowledge["sources"][number]>();
  function record({
    explanation,
    evidenceNote,
    sources: citations,
  }: DisplayKnowledge) {
    for (const source of citations) {
      if (!sources.has(source.id)) sources.set(source.id, source);
    }
    return {
      explanation,
      evidenceNote,
      sourceIds: citations.map(({ id }) => id),
    };
  }
  const { topic, graph, knowledge, expansions } = exploration;
  const overview = record(knowledge);
  const completed = Object.entries(expansions).flatMap(([nodeId, expansion]) =>
    expansion
      ? [
          {
            nodeId,
            status: expansion.status,
            knowledge: expansion.knowledge && record(expansion.knowledge),
          },
        ]
      : [],
  );
  return {
    topic,
    graph,
    selectedId,
    positions:
      positions &&
      Object.fromEntries(
        graph.nodes.flatMap(({ id }) => {
          const position = positions[id];
          return position ? [[id, position]] : [];
        }),
      ),
    overview,
    expansions: completed,
    sources: [...sources.values()],
  };
}

export function restoreExploration(
  content: HistoryContent,
): ExplorationContent {
  const sources = new Map(content.sources.map((source) => [source.id, source]));
  function knowledge({
    explanation,
    evidenceNote,
    sourceIds,
  }: z.infer<typeof explanationRecord>): DisplayKnowledge {
    return {
      explanation,
      evidenceNote,
      sources: sourceIds.flatMap((id) => {
        const source = sources.get(id);
        return source ? [source] : [];
      }),
    };
  }
  const expansions: Record<string, CompletedExpansion> = {};
  for (const record of content.expansions) {
    expansions[record.nodeId] =
      record.status === "expanded"
        ? { status: "expanded", knowledge: knowledge(record.knowledge) }
        : {
            status: "empty",
            knowledge: record.knowledge && knowledge(record.knowledge),
          };
  }
  return {
    topic: content.topic,
    graph: content.graph,
    knowledge: knowledge(content.overview),
    expansions,
  };
}
