import "server-only";

import type { z } from "zod";
import {
  maxQueryLength,
  retrievalRequestSchema,
} from "@/lib/retrieval/schemas";
import { BodyTooLargeError, readBoundedJson } from "@/lib/bounded-json";

const maxBodyBytes = 4_096;
export const bodyReadTimeoutMs = 6_000;

export function queryJson(
  body: unknown,
  status: number,
  headers?: Record<string, string>,
) {
  return Response.json(body, {
    status,
    headers: { ...headers, "Cache-Control": "no-store" },
  });
}

function errorResponse(code: string, message: string, status: number) {
  return { response: queryJson({ error: { code, message } }, status) };
}

export async function parseJsonRequest<T>(
  request: Request,
  limit: number,
  schema: z.ZodType<T>,
  invalid: { code: string; message: string },
): Promise<{ data: T } | { response: Response }> {
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
  const deadline = AbortSignal.timeout(bodyReadTimeoutMs);
  const signal = AbortSignal.any([request.signal, deadline]);
  try {
    body = await readBoundedJson(request, limit, signal);
  } catch (error) {
    if (signal.aborted)
      return errorResponse(
        "request_timeout",
        "The request body could not be read in time.",
        408,
      );
    if (error instanceof BodyTooLargeError) {
      return errorResponse(
        "body_too_large",
        `The request body exceeds ${limit} bytes.`,
        413,
      );
    }
    return errorResponse(
      "invalid_json",
      "Send a valid JSON request body.",
      400,
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(invalid.code, invalid.message, 400);
  }
  return { data: parsed.data };
}

export async function parseQueryRequest(
  request: Request,
): Promise<{ query: string } | { response: Response }> {
  const parsed = await parseJsonRequest(
    request,
    maxBodyBytes,
    retrievalRequestSchema,
    {
      code: "invalid_query",
      message: `Provide a query of 1 to ${maxQueryLength} characters.`,
    },
  );
  return "response" in parsed ? parsed : parsed.data;
}
