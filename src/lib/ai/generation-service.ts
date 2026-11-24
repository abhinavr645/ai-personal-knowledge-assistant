import "server-only";

import { createHash } from "node:crypto";
import type { RelatedRequest } from "@/lib/exploration/contracts";
import { retrievalRequestSchema } from "@/lib/retrieval/schemas";
import { z } from "zod";
import {
  buildEvidence,
  type KnowledgeSource,
  type PreparedEvidence,
} from "./evidence-builder";
import { GenerationFailure } from "./errors";
import type { GeminiClient } from "./gemini-client";
import {
  expansionInstructions,
  expansionPromptVersion,
  knowledgeInput,
  knowledgeInstructions,
  promptVersion,
} from "./prompts";
import {
  modelKnowledgeSchema,
  type generationDraftSchema,
  type knowledgeResultSchema,
  type ModelKnowledge,
} from "./schemas";

type Explanation = NonNullable<ModelKnowledge["explanation"]>;

export type GenerationResult = z.infer<typeof knowledgeResultSchema>;
export type GenerationDraft = z.infer<typeof generationDraftSchema>;

// Send Gemini the supported JSON Schema subset. Zod enforces the local rules.
const knowledgeJsonSchema = z.toJSONSchema(modelKnowledgeSchema, {
  override: ({ jsonSchema }) => {
    delete jsonSchema.minLength;
    delete jsonSchema.maxLength;
    delete jsonSchema.pattern;
  },
});
delete knowledgeJsonSchema.$schema;

function stableId(kind: "concept" | "relationship", fields: string[]) {
  return `${kind}-${createHash("sha256").update(JSON.stringify(fields)).digest("hex").slice(0, 24)}`;
}

export function conceptIdForName(name: string) {
  return stableId("concept", [
    name.normalize("NFKC").toLowerCase().trim().replace(/\s+/gu, " "),
  ]);
}

function normalizeGraph(
  concepts: ModelKnowledge["concepts"],
  relationships: ModelKnowledge["relationships"],
  expansion: boolean,
) {
  const conceptIds = new Map<string, string>();
  const generatedIds = new Set<string>();
  const normalizedConcepts: ModelKnowledge["concepts"] = [];
  for (const concept of concepts) {
    const id = conceptIdForName(concept.name);
    if (!expansion && (conceptIds.has(concept.id) || generatedIds.has(id))) {
      throw new GenerationFailure("invalid_generated_schema");
    }
    if (conceptIds.has(concept.id)) continue;
    conceptIds.set(concept.id, id);
    if (generatedIds.has(id)) continue;
    generatedIds.add(id);
    normalizedConcepts.push({ ...concept, id });
  }

  const localRelationshipIds = new Set<string>();
  const normalizedRelationships: ModelKnowledge["relationships"] = [];
  for (const relationship of relationships) {
    const sourceConceptId = conceptIds.get(relationship.sourceConceptId);
    const targetConceptId = conceptIds.get(relationship.targetConceptId);
    if (
      !sourceConceptId ||
      !targetConceptId ||
      sourceConceptId === targetConceptId
    ) {
      if (expansion) continue;
      throw new GenerationFailure("invalid_relationship_endpoints");
    }
    const endpoints = [sourceConceptId, targetConceptId];
    if (relationship.type === "RELATED_TO") endpoints.sort();
    const id = stableId("relationship", [relationship.type, ...endpoints]);
    if (localRelationshipIds.has(relationship.id) || generatedIds.has(id)) {
      if (expansion) continue;
      throw new GenerationFailure("invalid_generated_schema");
    }
    localRelationshipIds.add(relationship.id);
    generatedIds.add(id);
    normalizedRelationships.push({
      ...relationship,
      id,
      sourceConceptId,
      targetConceptId,
    });
  }

  return {
    concepts: normalizedConcepts,
    relationships: normalizedRelationships,
  };
}

function citedSources(
  explanation: Explanation,
  model: ModelKnowledge,
  known: PreparedEvidence["sources"],
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
      if (!Object.hasOwn(known, id))
        throw new GenerationFailure("invalid_source_references");
      cited.set(id, known[id]);
    }
  }
  return [...cited.values()];
}

export function noEvidenceResult(): GenerationResult {
  return {
    status: "insufficient_evidence",
    knowledge: null,
    generation: null,
    evidenceCount: 0,
    message: "No usable evidence was retrieved for this topic.",
  };
}

export async function requestKnowledge(
  query: string,
  evidence: PreparedEvidence,
  client: GeminiClient,
  signal?: AbortSignal,
  expansion?: RelatedRequest,
): Promise<GenerationDraft> {
  const raw = await client.generateJson(
    {
      systemInstruction: expansion
        ? knowledgeInstructions + expansionInstructions
        : knowledgeInstructions,
      contents: knowledgeInput(query, evidence.items, expansion),
      responseJsonSchema: knowledgeJsonSchema,
    },
    signal,
  );
  return {
    raw,
    generation: {
      model: client.model,
      promptVersion: expansion ? expansionPromptVersion : promptVersion,
    },
  };
}

export function validateKnowledge(
  { raw, generation }: GenerationDraft,
  evidence: PreparedEvidence,
  expansion = false,
): GenerationResult {
  const evidenceCount = evidence.items.length;
  const parsed = modelKnowledgeSchema.safeParse(raw);
  if (!parsed.success) throw new GenerationFailure("invalid_generated_schema");
  const model = parsed.data;

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

  const knowledge = {
    evidenceStatus: model.evidenceStatus,
    evidenceNote: model.evidenceNote,
    explanation: model.explanation,
    ...normalizeGraph(model.concepts, model.relationships, expansion),
    sources: citedSources(model.explanation, model, evidence.sources),
  };
  return { status: "ok" as const, knowledge, generation, evidenceCount };
}

export async function generateKnowledge(
  topic: string,
  results: readonly unknown[],
  client: GeminiClient,
  signal?: AbortSignal,
): Promise<GenerationResult> {
  const query = retrievalRequestSchema.shape.query.parse(topic);
  const evidence = buildEvidence(results);
  if (!evidence.items.length) return noEvidenceResult();
  return validateKnowledge(
    await requestKnowledge(query, evidence, client, signal),
    evidence,
  );
}
