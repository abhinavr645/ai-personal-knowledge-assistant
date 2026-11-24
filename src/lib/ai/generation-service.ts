import "server-only";

import { createHash } from "node:crypto";
import { retrievalRequestSchema } from "@/lib/retrieval/schemas";
import { buildEvidence, type KnowledgeSource } from "./evidence-builder";
import { GenerationFailure } from "./errors";
import type { GeminiClient } from "./gemini-client";
import {
  knowledgeInput,
  knowledgeInstructions,
  promptVersion,
} from "./prompts";
import {
  knowledgeJsonSchema,
  modelKnowledgeSchema,
  type ModelKnowledge,
} from "./schemas";

type Explanation = NonNullable<ModelKnowledge["explanation"]>;

export interface GeneratedKnowledge {
  evidenceStatus: Exclude<ModelKnowledge["evidenceStatus"], "insufficient">;
  evidenceNote: string;
  explanation: Explanation;
  concepts: ModelKnowledge["concepts"];
  relationships: ModelKnowledge["relationships"];
  sources: KnowledgeSource[];
}

function stableId(kind: "concept" | "relationship", fields: string[]) {
  return `${kind}-${createHash("sha256").update(JSON.stringify(fields)).digest("hex").slice(0, 24)}`;
}

function normalizeGraph(
  concepts: ModelKnowledge["concepts"],
  relationships: ModelKnowledge["relationships"],
) {
  const conceptIds = new Map<string, string>();
  const generatedIds = new Set<string>();
  const normalizedConcepts = concepts.map((concept) => {
    const name = concept.name
      .normalize("NFKC")
      .toLowerCase()
      .trim()
      .replace(/\s+/gu, " ");
    const id = stableId("concept", [name]);
    if (conceptIds.has(concept.id) || generatedIds.has(id)) {
      throw new GenerationFailure("invalid_generated_schema");
    }
    conceptIds.set(concept.id, id);
    generatedIds.add(id);
    return { ...concept, id };
  });

  const localRelationshipIds = new Set<string>();
  const normalizedRelationships = relationships.map((relationship) => {
    const sourceConceptId = conceptIds.get(relationship.sourceConceptId);
    const targetConceptId = conceptIds.get(relationship.targetConceptId);
    if (
      !sourceConceptId ||
      !targetConceptId ||
      sourceConceptId === targetConceptId
    ) {
      throw new GenerationFailure("invalid_relationship_endpoints");
    }
    const endpoints = [sourceConceptId, targetConceptId];
    if (relationship.type === "RELATED_TO") endpoints.sort();
    const id = stableId("relationship", [relationship.type, ...endpoints]);
    if (localRelationshipIds.has(relationship.id) || generatedIds.has(id)) {
      throw new GenerationFailure("invalid_generated_schema");
    }
    localRelationshipIds.add(relationship.id);
    generatedIds.add(id);
    return { ...relationship, id, sourceConceptId, targetConceptId };
  });

  return {
    concepts: normalizedConcepts,
    relationships: normalizedRelationships,
  };
}

function citedSources(
  explanation: Explanation,
  model: ModelKnowledge,
  known: ReadonlyMap<string, KnowledgeSource>,
) {
  const statements = [
    explanation.summary,
    explanation.detail,
    ...explanation.sections,
    ...explanation.takeaways,
    ...model.concepts,
    ...model.relationships,
  ];
  const cited = new Map<string, KnowledgeSource>();
  for (const { sourceIds } of statements) {
    for (const id of sourceIds) {
      const source = known.get(id);
      if (!source) throw new GenerationFailure("invalid_source_references");
      cited.set(id, source);
    }
  }
  return [...cited.values()];
}

export async function generateKnowledge(
  topic: string,
  results: readonly unknown[],
  client: GeminiClient,
  signal?: AbortSignal,
) {
  const query = retrievalRequestSchema.shape.query.parse(topic);
  const evidence = buildEvidence(results);
  const evidenceCount = evidence.items.length;
  if (!evidenceCount) {
    return {
      status: "insufficient_evidence" as const,
      knowledge: null,
      generation: null,
      evidenceCount,
      message: "No usable evidence was retrieved for this topic.",
    };
  }

  const raw = await client.generateJson(
    {
      systemInstruction: knowledgeInstructions,
      contents: knowledgeInput(query, evidence.items),
      responseJsonSchema: knowledgeJsonSchema,
    },
    signal,
  );
  const parsed = modelKnowledgeSchema.safeParse(raw);
  if (!parsed.success) throw new GenerationFailure("invalid_generated_schema");
  const model = parsed.data;
  const generation = { model: client.model, promptVersion };

  if (model.evidenceStatus === "insufficient") {
    if (
      model.explanation ||
      model.concepts.length ||
      model.relationships.length
    ) {
      throw new GenerationFailure("invalid_generated_schema");
    }
    return {
      status: "insufficient_evidence" as const,
      knowledge: null,
      generation,
      evidenceCount,
      message: "The retrieved evidence is insufficient to explain this topic.",
    };
  }

  if (
    !model.explanation ||
    (model.evidenceStatus === "limited" && !model.evidenceNote)
  ) {
    throw new GenerationFailure("invalid_generated_schema");
  }

  const knowledge: GeneratedKnowledge = {
    evidenceStatus: model.evidenceStatus,
    evidenceNote: model.evidenceNote,
    explanation: model.explanation,
    ...normalizeGraph(model.concepts, model.relationships),
    sources: citedSources(model.explanation, model, evidence.sources),
  };
  return { status: "ok" as const, knowledge, generation, evidenceCount };
}
