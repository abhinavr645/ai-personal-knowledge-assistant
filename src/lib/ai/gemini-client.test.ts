// @vitest-environment node

import {
  ApiError,
  FinishReason,
  type GenerateContentParameters,
} from "@google/genai";
import { expect, test, vi } from "vitest";
import {
  createGeminiClient,
  defaultGeminiModel,
  maxModelResponseBytes,
  maxOutputTokens,
} from "./gemini-client";

const key = "test-only-credential";
const input = {
  contents: '{"topic":"test"}',
  systemInstruction: "Return JSON.",
  responseJsonSchema: { type: "object" },
};

function responseWith(text: string, finishReason = FinishReason.STOP) {
  return {
    candidates: [
      { finishReason, content: { role: "model", parts: [{ text }] } },
    ],
  };
}

test("requests one bounded structured response using the documented default model", async () => {
  const send = vi.fn().mockResolvedValue(responseWith('{"result":"ok"}'));
  const createSdk = vi.fn(() => send);
  const client = createGeminiClient({
    apiKey: key,
    model: defaultGeminiModel,
    createSdk,
  });

  await expect(client.generateJson(input)).resolves.toEqual({ result: "ok" });
  expect(createSdk).toHaveBeenCalledExactlyOnceWith(key);
  expect(send).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      model: defaultGeminiModel,
      contents: input.contents,
      config: expect.objectContaining({
        responseMimeType: "application/json",
        responseJsonSchema: input.responseJsonSchema,
        maxOutputTokens,
        candidateCount: 1,
        httpOptions: { timeout: 20_000, retryOptions: { attempts: 1 } },
      }),
    }),
  );
});

test("requires credentials before creating the SDK", () => {
  const createSdk = vi.fn();
  expect(() => createGeminiClient({ apiKey: "  ", createSdk })).toThrow(
    expect.objectContaining({ code: "gemini_missing_credentials" }),
  );
  expect(createSdk).not.toHaveBeenCalled();
});

test.each([
  [400, "API_KEY_INVALID", "gemini_authentication_failed"],
  [403, "permission denied", "gemini_authentication_failed"],
  [429, "quota", "gemini_rate_limited"],
  [503, "unavailable", "gemini_unavailable"],
  [504, "gateway timeout", "gemini_timeout"],
])(
  "normalizes Gemini HTTP %i without exposing upstream content",
  async (status, message, code) => {
    const send = vi
      .fn()
      .mockRejectedValue(
        new ApiError({ status, message: `${message} ${key} internal stack` }),
      );
    const client = createGeminiClient({ apiKey: key, createSdk: () => send });
    const error = await client
      .generateJson(input)
      .catch((error: unknown) => error);
    expect(error).toMatchObject({ code });
    expect(String(error)).not.toContain(key);
    expect(String(error)).not.toContain("internal stack");
  },
);

test("times out a pending request and signals the SDK to abort", async () => {
  let sdkSignal: AbortSignal | undefined;
  const send = vi.fn(({ config }: GenerateContentParameters) => {
    sdkSignal = config?.abortSignal;
    return new Promise<ReturnType<typeof responseWith>>(() => undefined);
  });
  const client = createGeminiClient({
    apiKey: key,
    timeoutMs: 25,
    createSdk: () => send,
  });
  await expect(client.generateJson(input)).rejects.toMatchObject({
    code: "gemini_timeout",
  });
  expect(sdkSignal?.aborted).toBe(true);
  expect(send).toHaveBeenCalledTimes(1);
});

test.each([
  [{ candidates: [] }, "gemini_empty_response"],
  [responseWith("  "), "gemini_empty_response"],
  [responseWith("{broken"), "gemini_invalid_json"],
  [
    responseWith("x".repeat(maxModelResponseBytes + 1)),
    "gemini_invalid_response",
  ],
  [responseWith("{}", FinishReason.MAX_TOKENS), "gemini_token_limit"],
  [responseWith("", FinishReason.SAFETY), "gemini_blocked"],
])("rejects unusable candidate responses (%#)", async (response, code) => {
  const send = vi.fn().mockResolvedValue(response);
  const client = createGeminiClient({ apiKey: key, createSdk: () => send });
  await expect(client.generateJson(input)).rejects.toMatchObject({ code });
});
