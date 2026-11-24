import type { z } from "zod";
import { readBoundedJson } from "@/lib/bounded-json";
import { apiErrorSchema } from "./contracts";

const maxResponseBytes = 128 * 1024;
const timeoutMs = 32_000;

export async function postExploration<T>(
  path: "/api/search" | "/api/related",
  body: unknown,
  schema: z.ZodType<T>,
  signal: AbortSignal,
): Promise<T> {
  const deadline = AbortSignal.timeout(timeoutMs);
  const requestSignal = AbortSignal.any([signal, deadline]);
  const operation = path === "/api/search" ? "Search" : "Expansion";
  const timeoutMessage = `${operation} timed out. Please try again.`;
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: requestSignal,
    });
  } catch {
    throw new Error(
      deadline.aborted
        ? timeoutMessage
        : "Could not connect. Check your connection and try again.",
    );
  }

  let data: unknown;
  try {
    data = await readBoundedJson(response, maxResponseBytes, requestSignal);
  } catch {
    if (deadline.aborted || response.status === 504)
      throw new Error(timeoutMessage);
    if (!response.ok)
      throw new Error(`${operation} failed on the server. Please try again.`);
    throw new Error(
      `${operation} returned an invalid response. Please try again.`,
    );
  }
  if (!response.ok) {
    if (response.status === 504) throw new Error(timeoutMessage);
    const parsed = apiErrorSchema.safeParse(data);
    const code = parsed.success ? parsed.data.error.code : "";
    if (response.status === 429) {
      throw new Error(
        code === "service_busy"
          ? "The service is busy. Please try again shortly."
          : "AI generation is temporarily rate limited. Please try again later.",
      );
    }
    if (code === "retrieval_failed")
      throw new Error("Could not retrieve evidence. Please try again.");
    if (code === "gemini_missing_credentials")
      throw new Error(
        "AI generation is unavailable. Check the server configuration.",
      );
    throw new Error(`${operation} failed on the server. Please try again.`);
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success)
    throw new Error(
      `${operation} returned an invalid response. Please try again.`,
    );
  return parsed.data;
}
