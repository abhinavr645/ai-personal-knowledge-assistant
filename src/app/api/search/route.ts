import { GenerationFailure } from "@/lib/ai/errors";
import { createGeminiClient } from "@/lib/ai/gemini-client";
import { generateKnowledge } from "@/lib/ai/generation-service";
import { retrieve } from "@/lib/retrieval/retrieval-service";
import type { RetrievalResponse } from "@/lib/retrieval/types";
import { parseQueryRequest, queryJson } from "@/lib/server/query-request";

function retrievalMetadata(result: RetrievalResponse) {
  const { status, providers, errors, results } = result;
  return { status, providers, errors, resultCount: results.length };
}

function errorResponse(
  code: string,
  message: string,
  status: number,
  retrieval?: ReturnType<typeof retrievalMetadata>,
) {
  return queryJson(
    { error: { code, message }, ...(retrieval && { retrieval }) },
    status,
  );
}

export async function POST(request: Request) {
  const parsed = await parseQueryRequest(request);
  if ("response" in parsed) return parsed.response;
  const { query } = parsed;
  let retrieval: ReturnType<typeof retrievalMetadata> | undefined;

  try {
    // Validate configuration before sending the query to providers.
    const client = createGeminiClient();
    let result: RetrievalResponse;
    try {
      result = await retrieve(query, request.signal);
    } catch {
      return errorResponse(
        "retrieval_failed",
        "Evidence retrieval could not be completed.",
        502,
      );
    }
    retrieval = retrievalMetadata(result);
    if (result.status === "failed") {
      const status = result.errors.every(({ code }) => code === "timeout")
        ? 504
        : 502;
      return errorResponse(
        "retrieval_failed",
        "The selected providers could not retrieve evidence.",
        status,
        retrieval,
      );
    }

    const generated = await generateKnowledge(
      query,
      result.results,
      client,
      request.signal,
    );
    return queryJson({ query, ...generated, retrieval }, 200);
  } catch (error) {
    if (error instanceof GenerationFailure)
      return errorResponse(error.code, error.message, error.status, retrieval);
    return errorResponse(
      "search_failed",
      "The search request could not be completed.",
      500,
      retrieval,
    );
  }
}
