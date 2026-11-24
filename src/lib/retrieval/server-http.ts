import "server-only";

import type { RetrievalError } from "./types";

export class BodyTooLargeError extends Error {}

export async function readBoundedJson(
  input: Request | Response,
  limit: number,
): Promise<unknown> {
  if (!input.body) throw new SyntaxError("Missing JSON body");
  const reader = input.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";

  try {
    if (Number(input.headers.get("content-length")) > limit)
      throw new BodyTooLargeError();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new BodyTooLargeError();
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

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
