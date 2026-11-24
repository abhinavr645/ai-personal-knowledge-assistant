import { z } from "zod";
import { normalizeResults } from "../normalize-results";
import { httpUrlSchema } from "../schemas";
import { readBoundedJson } from "@/lib/bounded-json";
import { ProviderFailure, requestJson } from "../server-http";
import type { RetrievalProvider } from "../types";

const repositories = z.object({ items: z.array(z.unknown()) });

const repositoryItem = z.object({
  full_name: z.string().trim().min(1),
  description: z.string().nullable(),
  html_url: httpUrlSchema.refine((value) => {
    const url = URL.parse(value);
    return url?.protocol === "https:" && url.host === "github.com";
  }),
  owner: z.object({ login: z.string().trim().min(1) }),
  stargazers_count: z.number().int().nonnegative().optional(),
  language: z.string().trim().min(1).nullish(),
  updated_at: z.iso.datetime({ offset: true }).optional(),
});

const errorBody = z.object({ message: z.string() });

async function classifyGitHubError(response: Response) {
  if (response.status !== 403) return;
  if (
    response.headers.get("x-ratelimit-remaining") === "0" ||
    response.headers.has("retry-after")
  )
    return "rate_limited";
  const body = errorBody.safeParse(
    await readBoundedJson(response, 8 * 1024).catch(() => null),
  );
  if (body.success && /rate limit/i.test(body.data.message))
    return "rate_limited";
}

export const githubProvider: RetrievalProvider = {
  id: "github",
  timeoutMs: 4_000,
  async retrieve(context) {
    const { repository, repositoryQuery } = context.analysis;
    if (!repository && !repositoryQuery)
      return { results: [], malformed: false };
    const url = new URL("https://api.github.com");
    if (repository) {
      url.pathname = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;
    } else {
      url.pathname = "/search/repositories";
      url.search = new URLSearchParams({
        q: repositoryQuery ?? "",
        per_page: String(context.limit),
      }).toString();
    }

    let data: unknown;
    try {
      data = await requestJson(
        url,
        {
          signal: context.signal,
          headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2026-03-10",
            "User-Agent": "KnowledgeAssistant/0.1.0",
          },
        },
        classifyGitHubError,
      );
    } catch (error) {
      if (
        repository &&
        error instanceof ProviderFailure &&
        error.upstreamStatus === 404
      ) {
        return { results: [], malformed: false };
      }
      throw error;
    }

    const response = repositories.safeParse(
      repository ? { items: [data] } : data,
    );
    if (!response.success) throw new ProviderFailure("malformed_response");
    return normalizeResults(
      response.data.items,
      repositoryItem,
      context,
      (item) => {
        if (!item.description) return;
        return {
          title: item.full_name,
          content: { kind: "description", text: item.description },
          source: {
            provider: "github",
            type: "repository",
            name: "GitHub",
            url: item.html_url,
            updatedAt: item.updated_at,
            repository: {
              fullName: item.full_name,
              owner: item.owner.login,
              stars: item.stargazers_count,
              language: item.language ?? undefined,
            },
          },
        };
      },
    );
  },
};
