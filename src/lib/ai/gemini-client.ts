import "server-only";

import {
  ApiError,
  FinishReason,
  GoogleGenAI,
  ThinkingLevel,
  type GenerateContentParameters,
  type GenerateContentResponse,
} from "@google/genai";
import { GenerationFailure } from "./errors";

export const defaultGeminiModel = "gemini-3.8-flash";
export const maxOutputTokens = 6_144;
export const maxModelResponseBytes = 32_768;

type GenerateContent = (
  request: GenerateContentParameters,
) => Promise<Pick<GenerateContentResponse, "candidates" | "promptFeedback">>;

interface GeminiClientOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  createSdk?: (apiKey: string) => GenerateContent;
}

export interface GeminiClient {
  model: string;
  generateJson(
    input: {
      systemInstruction: string;
      contents: string;
      responseJsonSchema: unknown;
    },
    signal?: AbortSignal,
  ): Promise<unknown>;
}

function classifyError(error: unknown): GenerationFailure {
  if (error instanceof ApiError) {
    if (
      error.status === 401 ||
      error.status === 403 ||
      (error.status === 400 &&
        /API_KEY_(?:INVALID|EXPIRED|SERVICE_BLOCKED)|api key not valid|invalid api key/i.test(
          error.message,
        ))
    ) {
      return new GenerationFailure("gemini_authentication_failed");
    }
    if (error.status === 429)
      return new GenerationFailure("gemini_rate_limited");
    if (error.status === 408 || error.status === 504)
      return new GenerationFailure("gemini_timeout");
  }
  if (error instanceof SyntaxError)
    return new GenerationFailure("gemini_invalid_response");
  return new GenerationFailure("gemini_unavailable");
}

export function createGeminiClient({
  apiKey = process.env.GEMINI_API_KEY,
  model = process.env.GEMINI_MODEL?.trim() || defaultGeminiModel,
  timeoutMs = 20_000,
  createSdk = (key) =>
    new GoogleGenAI({
      apiKey: key,
      enterprise: false,
      vertexai: false,
      apiVersion: "v1beta",
    }).models.generateContent,
}: GeminiClientOptions = {}): GeminiClient {
  const key = apiKey?.trim();
  if (!key) throw new GenerationFailure("gemini_missing_credentials");
  if (!/^gemini-[a-z0-9][a-z0-9.-]{0,95}$/.test(model))
    throw new GenerationFailure("gemini_unavailable");

  return {
    model,
    async generateJson(input, requestSignal) {
      const deadline = AbortSignal.timeout(timeoutMs);
      const signal = requestSignal
        ? AbortSignal.any([deadline, requestSignal])
        : deadline;
      const aborted = () =>
        new GenerationFailure(
          requestSignal?.aborted ? "gemini_cancelled" : "gemini_timeout",
        );
      let onAbort: (() => void) | undefined;
      let response: Awaited<ReturnType<GenerateContent>>;

      try {
        if (signal.aborted) throw aborted();
        const stop = new Promise<never>((_, reject) => {
          onAbort = () => reject(aborted());
          signal.addEventListener("abort", onAbort, { once: true });
        });
        response = await Promise.race([
          createSdk(key)({
            model,
            contents: input.contents,
            config: {
              systemInstruction: input.systemInstruction,
              responseMimeType: "application/json",
              responseJsonSchema: input.responseJsonSchema,
              candidateCount: 1,
              maxOutputTokens,
              httpOptions: {
                timeout: timeoutMs,
                retryOptions: { attempts: 1 },
              },
              abortSignal: signal,
              ...(model === defaultGeminiModel && {
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              }),
            },
          }),
          stop,
        ]);
      } catch (error) {
        throw signal.aborted ? aborted() : classifyError(error);
      } finally {
        if (onAbort) signal.removeEventListener("abort", onAbort);
      }

      const candidate = response?.candidates?.[0];
      if (candidate?.finishReason === FinishReason.MAX_TOKENS) {
        throw new GenerationFailure("gemini_token_limit");
      }
      if (
        response?.promptFeedback?.blockReason ||
        (candidate?.finishReason &&
          candidate.finishReason !== FinishReason.STOP &&
          candidate.finishReason !== FinishReason.FINISH_REASON_UNSPECIFIED)
      ) {
        throw new GenerationFailure("gemini_blocked");
      }

      // Read text parts directly so SDK text getters do not log unexpected parts.
      const parts = candidate?.content?.parts ?? [];
      if (!Array.isArray(parts))
        throw new GenerationFailure("gemini_invalid_response");
      const text = parts
        .filter((part) => !part?.thought && typeof part?.text === "string")
        .map((part) => part.text)
        .join("");
      if (Buffer.byteLength(text) > maxModelResponseBytes)
        throw new GenerationFailure("gemini_invalid_response");
      if (!text.trim()) throw new GenerationFailure("gemini_empty_response");
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new GenerationFailure("gemini_invalid_json");
      }
    },
  };
}
