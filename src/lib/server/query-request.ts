import "server-only";

import {
  maxQueryLength,
  retrievalRequestSchema,
} from "@/lib/retrieval/schemas";
import {
  BodyTooLargeError,
  readBoundedJson,
} from "@/lib/retrieval/server-http";

const maxBodyBytes = 4_096;

export function queryJson(body: unknown, status: number) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function errorResponse(code: string, message: string, status: number) {
  return { response: queryJson({ error: { code, message } }, status) };
}

export async function parseQueryRequest(
  request: Request,
): Promise<{ query: string } | { response: Response }> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    return errorResponse(
      "unsupported_media_type",
      "Send an application/json request body.",
      415,
    );
  }

  let body: unknown;
  try {
    body = await readBoundedJson(request, maxBodyBytes);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return errorResponse(
        "body_too_large",
        "The request body exceeds 4096 bytes.",
        413,
      );
    }
    return errorResponse(
      "invalid_json",
      "Send a valid JSON request body.",
      400,
    );
  }

  const parsed = retrievalRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      "invalid_query",
      `Provide a query of 1 to ${maxQueryLength} characters.`,
      400,
    );
  }
  return { query: parsed.data.query };
}
