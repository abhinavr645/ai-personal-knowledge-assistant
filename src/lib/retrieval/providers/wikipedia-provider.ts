import { z } from "zod";
import { normalizeResults } from "../normalize-results";
import { httpUrlSchema } from "../schemas";
import { ProviderFailure, requestJson } from "../server-http";
import type { RetrievalProvider } from "../types";

const wikipediaResponse = z.object({
  batchcomplete: z.literal(true).optional(),
  query: z.object({ pages: z.array(z.unknown()) }).optional(),
  error: z.object({ code: z.string() }).optional(),
});

const pageSchema = z.union([
  z.object({ missing: z.literal(true) }),
  z.object({ invalid: z.literal(true) }),
  z.object({ pageprops: z.object({ disambiguation: z.string() }) }),
  z.object({
    title: z.string().trim().min(1),
    canonicalurl: httpUrlSchema.refine((value) => {
      const url = URL.parse(value);
      return url?.protocol === "https:" && url.host === "en.wikipedia.org";
    }),
    extract: z.string().optional(),
    pageprops: z.object({ disambiguation: z.string().optional() }).optional(),
  }),
]);

export const wikipediaProvider: RetrievalProvider = {
  id: "wikipedia",
  timeoutMs: 4_000,
  async retrieve(context) {
    const url = new URL("https://en.wikipedia.org/w/api.php");
    url.search = new URLSearchParams({
      action: "query",
      generator: "search",
      gsrsearch: context.analysis.query,
      gsrnamespace: "0",
      gsrlimit: String(context.limit),
      prop: "extracts|info|pageprops",
      inprop: "url",
      ppprop: "disambiguation",
      exintro: "1",
      explaintext: "1",
      exchars: "1200",
      exlimit: String(context.limit),
      redirects: "1",
      format: "json",
      formatversion: "2",
    }).toString();

    const contact = process.env.WIKIPEDIA_CONTACT?.trim();
    const agent =
      contact && /^[\x20-\x7e]{1,200}$/.test(contact)
        ? `KnowledgeAssistant/0.1.0 (${contact})`
        : "KnowledgeAssistant/0.1.0 (local knowledge retrieval)";
    const response = wikipediaResponse.safeParse(
      await requestJson(url, {
        signal: context.signal,
        headers: { "User-Agent": agent, Accept: "application/json" },
      }),
    );

    if (!response.success) throw new ProviderFailure("malformed_response");
    const { error, query, batchcomplete } = response.data;
    if (error)
      throw new ProviderFailure(
        error.code === "ratelimited" ? "rate_limited" : "upstream_error",
      );
    if (!query && !batchcomplete)
      throw new ProviderFailure("malformed_response");

    return normalizeResults(query?.pages ?? [], pageSchema, context, (page) => {
      if (!("canonicalurl" in page) || !page.extract) return;
      return {
        title: page.title,
        content: { kind: "extract", text: page.extract },
        source: {
          provider: "wikipedia",
          type: "encyclopedia",
          name: "Wikipedia",
          url: page.canonicalurl,
        },
      };
    });
  },
};
