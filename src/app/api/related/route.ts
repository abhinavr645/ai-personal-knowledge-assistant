import { conceptIdForName } from "@/lib/ai/generation-service";
import {
  maxRelatedBodyBytes,
  relatedRequestSchema,
} from "@/lib/exploration/contracts";
import { runRelated } from "@/lib/exploration/related-service";
import { withApiCapacity } from "@/lib/server/api-capacity";
import { parseJsonRequest, queryJson } from "@/lib/server/query-request";

export async function POST(request: Request) {
  const invalid = {
    code: "invalid_expansion",
    message: "Provide a valid selected concept and exploration context.",
  };
  const parsed = await parseJsonRequest(
    request,
    maxRelatedBodyBytes,
    relatedRequestSchema,
    invalid,
  );
  if ("response" in parsed) return parsed.response;
  const { concept, neighbors } = parsed.data;
  if (
    [concept, ...neighbors].some(
      ({ id, name }) => id !== conceptIdForName(name),
    )
  ) {
    return queryJson({ error: invalid }, 400);
  }
  return withApiCapacity(async () => {
    const { body, status } = await runRelated(parsed.data, request.signal);
    return queryJson(body, status);
  });
}
