import "server-only";

import { retrievalResultSchema } from "@/lib/retrieval/schemas";
import type { ProviderId } from "@/lib/retrieval/types";

export const maxEvidenceItems = 6;
export const maxEvidenceBytes = 12_000;
const maxExcerptLength = 1_600;

export interface KnowledgeSource {
  id: string;
  title: string;
  url: string;
  provider: ProviderId;
  sourceName: string;
  publishedAt?: string;
  updatedAt?: string;
}

interface EvidenceItem {
  sourceId: string;
  title: string;
  url: string;
  provider: ProviderId;
  sourceName: string;
  text: string;
}

export function buildEvidence(results: readonly unknown[]) {
  const items: EvidenceItem[] = [];
  const sources = new Map<string, KnowledgeSource>();
  let bytes = 2; // The evidence array's brackets.

  for (const candidate of results) {
    if (items.length === maxEvidenceItems) break;
    const parsed = retrievalResultSchema.safeParse(candidate);
    if (!parsed.success) continue;
    const { id, title, content, source } = parsed.data;
    if (sources.has(id)) continue;

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
    sources.set(id, {
      id,
      title,
      url: source.url,
      provider: source.provider,
      sourceName: source.name,
      publishedAt: source.publishedAt,
      updatedAt: source.updatedAt,
    });
    bytes += itemBytes;
  }

  return { items, sources };
}
