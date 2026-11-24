import { normalizeResults } from "../normalize-results";
import { documentationForUrl } from "../official-sources";
import type { RetrievalProvider } from "../types";
import { searchTavily, tavilyItemSchema } from "./tavily-provider";

export const officialDocsProvider: RetrievalProvider = {
  id: "official-docs",
  timeoutMs: 6_000,
  async retrieve(context) {
    const { documentationSources } = context.analysis;
    if (!documentationSources.length) return { results: [], malformed: false };
    const rows = await searchTavily(
      context,
      documentationSources.map(({ host }) => host),
    );
    return normalizeResults(rows, tavilyItemSchema, context, (item) => {
      const documentation = documentationForUrl(item.url, documentationSources);
      if (!documentation) return;
      return {
        title: item.title,
        content: { kind: "snippet", text: item.content },
        source: {
          provider: "official-docs",
          type: "official-documentation",
          name: documentation.name,
          url: item.url,
        },
      };
    });
  },
};
