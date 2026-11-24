import { z } from "zod";
import { conceptIdSchema, knowledgeResultSchema } from "@/lib/ai/schemas";
import {
  retrievalRequestSchema,
  retrievalResponseSchema,
} from "@/lib/retrieval/schemas";

export const maxExplorationNodes = 100;
export const maxExpansionNeighbors = 8;
export const maxRelatedBodyBytes = 16 * 1024;

const conceptContextSchema = z.strictObject({
  id: conceptIdSchema,
  name: z.string().trim().min(1).max(120),
});
export const relatedRequestSchema = z
  .strictObject({
    topic: retrievalRequestSchema.shape.query,
    concept: conceptContextSchema.extend({
      description: z.string().trim().min(1).max(400),
    }),
    neighbors: z.array(conceptContextSchema).max(maxExpansionNeighbors),
    existingConceptIds: z
      .array(conceptIdSchema)
      .min(1)
      .max(maxExplorationNodes),
  })
  .refine(({ concept, neighbors, existingConceptIds }) => {
    const ids = new Set(existingConceptIds);
    return (
      ids.size === existingConceptIds.length &&
      ids.has(concept.id) &&
      new Set(neighbors.map(({ id }) => id)).size === neighbors.length &&
      neighbors.every(({ id }) => id !== concept.id && ids.has(id))
    );
  });

export const retrievalMetadataSchema = retrievalResponseSchema
  .pick({ status: true, providers: true, errors: true })
  .extend({ resultCount: z.number().int().min(0) });

export const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
  retrieval: retrievalMetadataSchema.optional(),
});

export const searchResponseSchema = knowledgeResultSchema.and(
  z.object({
    query: retrievalRequestSchema.shape.query,
    retrieval: retrievalMetadataSchema,
  }),
);
export const relatedResponseSchema = searchResponseSchema.and(
  z.object({ conceptId: conceptIdSchema }),
);

export type RelatedRequest = z.infer<typeof relatedRequestSchema>;
export type SearchResult = z.infer<typeof searchResponseSchema>;
export type RelatedResult = z.infer<typeof relatedResponseSchema>;
export type Knowledge = Extract<SearchResult, { status: "ok" }>["knowledge"];
export type DisplayKnowledge = Pick<
  Knowledge,
  "explanation" | "evidenceNote" | "sources"
>;
