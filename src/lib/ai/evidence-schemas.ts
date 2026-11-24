import { z } from "zod";
import {
  retrievalResultSchema,
  sourceMetadataSchema,
} from "@/lib/retrieval/schemas";

export const maxEvidenceItems = 6;

export const knowledgeSourceSchema = z.object({
  id: retrievalResultSchema.shape.id,
  title: retrievalResultSchema.shape.title,
  url: sourceMetadataSchema.shape.url,
  provider: sourceMetadataSchema.shape.provider,
  sourceName: sourceMetadataSchema.shape.name,
  publishedAt: sourceMetadataSchema.shape.publishedAt,
  updatedAt: sourceMetadataSchema.shape.updatedAt,
});

export type KnowledgeSource = z.infer<typeof knowledgeSourceSchema>;
