import { retrieve } from "@/lib/retrieval/retrieval-service";
import { withApiCapacity } from "@/lib/server/api-capacity";
import { parseQueryRequest, queryJson } from "@/lib/server/query-request";

export async function POST(request: Request) {
  const parsed = await parseQueryRequest(request);
  if ("response" in parsed) return parsed.response;

  return withApiCapacity(() => retrieveResponse(parsed.query, request.signal));
}

async function retrieveResponse(query: string, signal: AbortSignal) {
  try {
    const result = await retrieve(query, signal);
    if (result.status !== "failed") return queryJson(result, 200);
    if (result.errors.every(({ code }) => code === "timeout"))
      return queryJson(result, 504);
    if (
      result.errors.every(
        ({ code }) =>
          code === "unavailable" ||
          code === "rate_limited" ||
          code === "timeout",
      )
    )
      return queryJson(result, 503);
    return queryJson(result, 502);
  } catch {
    return queryJson(
      {
        error: {
          code: "retrieval_failed",
          message: "The retrieval request could not be completed.",
        },
      },
      500,
    );
  }
}
