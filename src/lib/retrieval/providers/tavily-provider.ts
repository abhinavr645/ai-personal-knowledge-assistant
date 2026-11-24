import "server-only";

import { z } from "zod";
import { normalizeResults } from "../normalize-results";
import { httpUrlSchema } from "../schemas";
import { ProviderFailure, requestJson } from "../server-http";
import type { ProviderContext, RetrievalProvider } from "../types";

export const tavilyItemSchema = z.object({
  title: z.string().trim().min(1),
  url: httpUrlSchema,
  content: z.string(),
});

const tavilyResponse = z.object({ results: z.array(z.unknown()) });

export async function searchTavily(
  context: ProviderContext,
  domains?: readonly string[],
) {
  const key = process.env.TAVILY_API_KEY?.trim();
  if (!key) throw new ProviderFailure("unavailable");

  const payload = await requestJson(
    new URL("https://api.tavily.com/search"),
    {
      method: "POST",
      signal: context.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: context.analysis.query,
        search_depth: "basic",
        max_results: context.limit,
        include_answer: false,
        include_raw_content: false,
        ...(domains && {
          include_domains: domains,
          include_domains_mode: "restrict",
        }),
      }),
    },
    (response) => {
      if (response.status === 432) return "rate_limited";
      if (response.status === 401) return "unavailable";
    },
  );

  const parsed = tavilyResponse.safeParse(payload);
  if (!parsed.success) throw new ProviderFailure("malformed_response");
  return parsed.data.results;
}

export const tavilyProvider: RetrievalProvider = {
  id: "tavily",
  timeoutMs: 6_000,
  async retrieve(context) {
    const rows = await searchTavily(context);
    return normalizeResults(rows, tavilyItemSchema, context, (item) => ({
      title: item.title,
      content: { kind: "snippet", text: item.content },
      source: {
        provider: "tavily",
        type: "web",
        name: new URL(item.url).hostname,
        url: item.url,
      },
    }));
  },
};
