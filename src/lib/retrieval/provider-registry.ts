import "server-only";

import { githubProvider } from "./providers/github-provider";
import { officialDocsProvider } from "./providers/official-docs-provider";
import { tavilyProvider } from "./providers/tavily-provider";
import { wikipediaProvider } from "./providers/wikipedia-provider";
import type { ProviderId, RetrievalProvider } from "./types";

export const providers: Readonly<Record<ProviderId, RetrievalProvider>> = {
  github: githubProvider,
  "official-docs": officialDocsProvider,
  tavily: tavilyProvider,
  wikipedia: wikipediaProvider,
};
