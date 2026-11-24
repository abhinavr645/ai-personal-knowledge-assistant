import "server-only";

import type { RetrievalError } from "./types";

import { readBoundedJson } from "@/lib/bounded-json";

export class ProviderFailure extends Error {
  constructor(
    readonly code: RetrievalError["code"],
    readonly upstreamStatus?: number,
  ) {
    super(code);
  }
}

export async function requestJson(
  url: URL,
  init: RequestInit & { signal: AbortSignal },
  classifyError?: (
    response: Response,
  ) =>
    | RetrievalError["code"]
    | undefined
    | Promise<RetrievalError["code"] | undefined>,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    throw new ProviderFailure("network");
  }

  if (!response.ok) {
    const code =
      response.status === 429
        ? "rate_limited"
        : ((await classifyError?.(response)) ?? "upstream_error");
    if (response.body && !response.bodyUsed)
      void response.body.cancel().catch(() => undefined);
    throw new ProviderFailure(code, response.status);
  }

  try {
    return await readBoundedJson(response, 256 * 1024);
  } catch {
    throw new ProviderFailure("malformed_response");
  }
}
