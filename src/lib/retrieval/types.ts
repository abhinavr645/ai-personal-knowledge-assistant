import type { z } from "zod";
import type { QueryAnalysis } from "./query-analyzer";
import type {
  providerIdSchema,
  retrievalErrorSchema,
  retrievalResponseSchema,
  retrievalResultSchema,
  sourceMetadataSchema,
} from "./schemas";

export type ProviderId = z.infer<typeof providerIdSchema>;
export type SourceMetadata = z.infer<typeof sourceMetadataSchema>;
export type RetrievalResult = z.infer<typeof retrievalResultSchema>;
export type RetrievalError = z.infer<typeof retrievalErrorSchema>;
export type RetrievalResponse = z.infer<typeof retrievalResponseSchema>;

export interface ProviderContext {
  analysis: QueryAnalysis;
  limit: number;
  retrievedAt: string;
  signal: AbortSignal;
}

export interface ProviderResult {
  results: RetrievalResult[];
  malformed: boolean;
}

export interface RetrievalProvider {
  id: ProviderId;
  timeoutMs: number;
  retrieve(context: ProviderContext): Promise<ProviderResult>;
}
