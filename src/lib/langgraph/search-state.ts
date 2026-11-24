import "server-only";

import { StateSchema } from "@langchain/langgraph";
import { z } from "zod";
import { preparedEvidenceSchema } from "@/lib/ai/evidence-builder";
import { generationDraftSchema, knowledgeResultSchema } from "@/lib/ai/schemas";
import {
  retrievalMetadataSchema,
  type SearchResult,
} from "@/lib/exploration/contracts";
import {
  queryClassificationSchema,
  selectedProvidersSchema,
} from "@/lib/retrieval/query-analyzer";
import {
  maxRetrievalResults,
  retrievalRequestSchema,
} from "@/lib/retrieval/schemas";

const failureSchema = z.object({
  status: z.number().int().min(400).max(599),
  code: z.string(),
  message: z.string(),
});

export type WorkflowFailure = z.infer<typeof failureSchema>;
type RetrievalMetadata = z.infer<typeof retrievalMetadataSchema>;

type SearchResponseBody =
  | SearchResult
  | {
      error: { code: string; message: string };
      retrieval?: RetrievalMetadata;
    };

export interface SearchResponse {
  status: number;
  body: SearchResponseBody;
}

export const SearchInput = new StateSchema({
  query: retrievalRequestSchema.shape.query,
});
export const SearchOutput = new StateSchema({
  response: z.object({
    status: z.number().int().min(200).max(599),
    // The success and error bodies are already validated state values.
    body: z.custom<SearchResponseBody>(
      (body) =>
        !!body &&
        typeof body === "object" &&
        ("knowledge" in body || "error" in body),
    ),
  }),
});

export const SearchState = new StateSchema({
  ...SearchInput.fields,
  classification: queryClassificationSchema.optional(),
  providers: selectedProvidersSchema.optional(),
  retrieval: retrievalMetadataSchema.optional(),
  results: z
    .array(z.unknown())
    .max(maxRetrievalResults)
    .nullable()
    .default(null),
  evidence: preparedEvidenceSchema.nullable().default(null),
  draft: generationDraftSchema.nullable().default(null),
  validation: knowledgeResultSchema.nullable().default(null),
  failure: failureSchema.optional(),
  ...SearchOutput.fields,
});
