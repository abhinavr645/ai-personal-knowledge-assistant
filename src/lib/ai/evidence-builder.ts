import "server-only";

import { z } from "zod";
import {
  retrievalResultSchema,
  sourceMetadataSchema,
} from "@/lib/retrieval/schemas";

export const maxEvidenceItems = 6;
export const maxEvidenceBytes = 12_000;
const maxExcerptLength = 1_600;

const sourceFields = {
  title: retrievalResultSchema.shape.title,
  url: sourceMetadataSchema.shape.url,
  provider: sourceMetadataSchema.shape.provider,
  sourceName: sourceMetadataSchema.shape.name,
};

export const knowledgeSourceSchema = z.object({
  ...sourceFields,
  id: retrievalResultSchema.shape.id,
  publishedAt: sourceMetadataSchema.shape.publishedAt,
  updatedAt: sourceMetadataSchema.shape.updatedAt,
});
const evidenceItemSchema = z.object({
  ...sourceFields,
  sourceId: retrievalResultSchema.shape.id,
  text: z.string().min(1).max(maxExcerptLength),
});
export const preparedEvidenceSchema = z.object({
  items: z.array(evidenceItemSchema).max(maxEvidenceItems),
  sources: z.record(retrievalResultSchema.shape.id, knowledgeSourceSchema),
});

export type KnowledgeSource = z.infer<typeof knowledgeSourceSchema>;
export type PreparedEvidence = z.infer<typeof preparedEvidenceSchema>;

export function buildEvidence(results: readonly unknown[]): PreparedEvidence {
  const items: PreparedEvidence["items"] = [];
  const sources: PreparedEvidence["sources"] = {};
  let bytes = 2; // The evidence array's brackets.

  for (const candidate of results) {
    if (items.length === maxEvidenceItems) break;
    const parsed = retrievalResultSchema.safeParse(candidate);
    if (!parsed.success) continue;
    const { id, title, content, source } = parsed.data;
    if (Object.hasOwn(sources, id)) continue;

    const item = {
      sourceId: id,
      title,
      url: source.url,
      provider: source.provider,
      sourceName: source.name,
      text: content.text.slice(0, maxExcerptLength).trimEnd(),
    };
    const itemBytes =
      Buffer.byteLength(JSON.stringify(item)) + (items.length > 0 ? 1 : 0);
    if (bytes + itemBytes > maxEvidenceBytes) continue;

    items.push(item);
    sources[id] = {
      id,
      title,
      url: source.url,
      provider: source.provider,
      sourceName: source.name,
      publishedAt: source.publishedAt,
      updatedAt: source.updatedAt,
    };
    bytes += itemBytes;
  }

  return { items, sources };
}
