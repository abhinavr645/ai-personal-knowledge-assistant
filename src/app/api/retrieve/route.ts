import {
  maxQueryLength,
  retrievalRequestSchema,
} from "@/lib/retrieval/schemas";
import { retrieve } from "@/lib/retrieval/retrieval-service";
import {
  BodyTooLargeError,
  readBoundedJson,
} from "@/lib/retrieval/server-http";

const maxBodyBytes = 4_096;

function json(body: unknown, status: number) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function errorResponse(code: string, message: string, status: number) {
  return json({ error: { code, message } }, status);
}

export async function POST(request: Request) {
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

  try {
    const result = await retrieve(parsed.data.query, request.signal);
    if (result.status !== "failed") return json(result, 200);
    if (result.errors.every(({ code }) => code === "timeout"))
      return json(result, 504);
    if (
      result.errors.every(
        ({ code }) =>
          code === "unavailable" ||
          code === "rate_limited" ||
          code === "timeout",
      )
    )
      return json(result, 503);
    return json(result, 502);
  } catch {
    return errorResponse(
      "retrieval_failed",
      "The retrieval request could not be completed.",
      500,
    );
  }
}
