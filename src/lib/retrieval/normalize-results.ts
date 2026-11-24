import "server-only";

import { createHash } from "node:crypto";
import type { ZodType } from "zod";
import { maxEvidenceLength, retrievalResultSchema } from "./schemas";
import { canonicalUrlKey } from "./ranking";
import type { ProviderContext, ProviderResult, RetrievalResult } from "./types";

type ResultDraft = Omit<
  RetrievalResult,
  "id" | "retrievedAt" | "relevanceScore"
>;

export function normalizeResults<T>(
  rows: readonly unknown[],
  schema: ZodType<T>,
  { limit, retrievedAt }: ProviderContext,
  toResult: (row: T) => ResultDraft | undefined,
): ProviderResult {
  const results: RetrievalResult[] = [];
  let malformed = false;

  for (const row of rows.slice(0, limit)) {
    const parsed = schema.safeParse(row);
    if (!parsed.success) {
      malformed = true;
      continue;
    }
    const draft = toResult(parsed.data);
    if (!draft) continue;

    const text = draft.content.text
      .trim()
      .slice(0, maxEvidenceLength)
      .trimEnd();
    if (!text) continue;
    const id = createHash("sha256")
      .update(canonicalUrlKey(draft.source.url))
      .digest("hex");
    const result = retrievalResultSchema.safeParse({
      ...draft,
      id,
      retrievedAt,
      content: { ...draft.content, text },
    });
    if (result.success) results.push(result.data);
    else malformed = true;
  }

  return { results, malformed };
}
