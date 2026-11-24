// @vitest-environment node

import { delay, http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { POST } from "@/app/api/retrieve/route";
import { providers } from "./provider-registry";
import { analyzeQuery } from "./query-analyzer";
import { createRetrievalService, retrieve } from "./retrieval-service";
import { retrievalResponseSchema } from "./schemas";
import type { ProviderContext } from "./types";

const wikipedia = "https://en.wikipedia.org/w/api.php";
const tavily = "https://api.tavily.com/search";
const githubSearch = "https://api.github.com/search/repositories";
const githubRepository = "https://api.github.com/repos/vercel/next.js";
const fakeKey = "mock-tavily-secret-should-stay-on-server";

const article = {
  pageid: 233488,
  title: "Machine learning",
  canonicalurl: "https://en.wikipedia.org/wiki/Machine_learning",
  extract: "Machine learning studies how algorithms learn patterns from data.",
};
const wikiMatches = () =>
  HttpResponse.json({ batchcomplete: true, query: { pages: [article] } });

const webMatch = {
  title: "Machine learning from examples",
  url: "https://example.test/machine-learning",
  content:
    "Machine learning models learn from examples and can predict new outcomes.",
};
const tavilyMatches = () => HttpResponse.json({ results: [webMatch] });

const reactDoc = {
  title: "useState",
  url: "https://react.dev/reference/react/useState",
  content:
    "useState is a React Hook that lets you add a state variable to your component.",
};
const repository = {
  full_name: "vercel/next.js",
  description: "The React Framework.",
  html_url: "https://github.com/vercel/next.js",
  owner: { login: "vercel" },
  updated_at: "2025-01-01T12:30:00Z",
  stargazers_count: 100,
  language: "TypeScript",
};

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(() => vi.stubEnv("TAVILY_API_KEY", fakeKey));
afterEach(() => {
  server.resetHandlers();
  vi.unstubAllEnvs();
});
afterAll(() => server.close());

function context(query: string): ProviderContext {
  return {
    analysis: analyzeQuery(query),
    signal: new AbortController().signal,
    limit: 5,
    retrievedAt: "2025-02-01T00:00:00.000Z",
  };
}

function post(query: string) {
  return POST(
    new Request("http://localhost/api/retrieve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    }),
  );
}

describe("provider adapters", () => {
  test("Wikipedia selects plain-text introductions and skips missing and disambiguation pages", async () => {
    vi.stubEnv("WIKIPEDIA_CONTACT", "operator@example.test");
    server.use(
      http.get(wikipedia, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("generator")).toBe("search");
        expect(url.searchParams.get("gsrnamespace")).toBe("0");
        expect(url.searchParams.get("gsrlimit")).toBe("5");
        expect(url.searchParams.get("exintro")).toBe("1");
        expect(url.searchParams.get("explaintext")).toBe("1");
        expect(request.headers.get("User-Agent")).toBe(
          "KnowledgeAssistant/0.1.0 (operator@example.test)",
        );
        return HttpResponse.json({
          batchcomplete: true,
          query: {
            pages: [
              article,
              {
                ...article,
                title: "Machine learning (disambiguation)",
                pageprops: { disambiguation: "" },
              },
              { title: "Missing article", missing: true },
            ],
          },
        });
      }),
    );

    const result = await providers.wikipedia.retrieve(
      context("What is machine learning?"),
    );
    expect(result.malformed).toBe(false);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      title: article.title,
      content: { kind: "extract", text: article.extract },
      source: {
        type: "encyclopedia",
        name: "Wikipedia",
        url: article.canonicalurl,
      },
      retrievedAt: "2025-02-01T00:00:00.000Z",
    });
  });

  test("Wikipedia accepts a successful empty search and rejects a malformed envelope", async () => {
    server.use(
      http.get(wikipedia, () => HttpResponse.json({ batchcomplete: true })),
    );
    await expect(
      providers.wikipedia.retrieve(context("Missing topic")),
    ).resolves.toEqual({ results: [], malformed: false });
    server.use(
      http.get(wikipedia, () => HttpResponse.json({ query: { pages: {} } })),
    );
    await expect(
      providers.wikipedia.retrieve(context("Missing topic")),
    ).rejects.toMatchObject({ code: "malformed_response" });
  });

  test("Tavily sends credentials in the header and returns only bounded search hits", async () => {
    server.use(
      http.post(tavily, async ({ request }) => {
        expect(request.headers.get("Authorization")).toBe(`Bearer ${fakeKey}`);
        const body = await request.json();
        expect(body).toMatchObject({
          query: "Machine learning",
          max_results: 5,
          include_answer: false,
          include_raw_content: false,
        });
        expect(JSON.stringify(body)).not.toContain(fakeKey);
        return HttpResponse.json({
          results: Array.from({ length: 9 }, (_, i) => ({
            ...webMatch,
            url: `https://example.test/resources/${i}`,
            content: "x".repeat(3000),
          })),
        });
      }),
    );

    const result = await providers.tavily.retrieve(context("Machine learning"));
    expect(result.malformed).toBe(false);
    expect(result.results).toHaveLength(5);
    expect(result.results[0].content.text).toHaveLength(2000);
    expect(result.results[0].source).toMatchObject({
      provider: "tavily",
      type: "web",
      name: "example.test",
    });
  });

  test("Tavily handles a missing key and upstream rate limiting", async () => {
    vi.stubEnv("TAVILY_API_KEY", undefined);
    const requestSpy = vi.fn(tavilyMatches);
    server.use(http.post(tavily, requestSpy));
    await expect(
      providers.tavily.retrieve(context("Machine learning")),
    ).rejects.toMatchObject({ code: "unavailable" });
    expect(requestSpy).not.toHaveBeenCalled();

    vi.stubEnv("TAVILY_API_KEY", fakeKey);
    server.use(
      http.post(tavily, () =>
        HttpResponse.json({ error: "Upstream limits" }, { status: 429 }),
      ),
    );
    await expect(
      providers.tavily.retrieve(context("Machine learning")),
    ).rejects.toMatchObject({ code: "rate_limited", upstreamStatus: 429 });
  });

  test("GitHub uses repository metadata for an explicit repository and search for discovery", async () => {
    server.use(
      http.get(githubRepository, ({ request }) => {
        expect(request.headers.has("Authorization")).toBe(false);
        return HttpResponse.json(repository);
      }),
      http.get(githubSearch, ({ request }) => {
        expect(new URL(request.url).searchParams.get("q")).toBe(
          "javascript charting",
        );
        expect(new URL(request.url).searchParams.get("per_page")).toBe("5");
        return HttpResponse.json({ total_count: 1, items: [repository] });
      }),
    );
    const direct = await providers.github.retrieve(context("vercel/next.js"));
    const search = await providers.github.retrieve(
      context("Compare JavaScript charting libraries"),
    );

    expect(direct).toEqual(search);
    expect(direct.results[0]).toMatchObject({
      title: repository.full_name,
      content: { kind: "description", text: repository.description },
      source: {
        url: repository.html_url,
        updatedAt: repository.updated_at,
        repository: {
          fullName: repository.full_name,
          owner: "vercel",
          stars: 100,
          language: "TypeScript",
        },
      },
    });
    expect(direct.results[0].source.publishedAt).toBeUndefined();
  });

  test("GitHub distinguishes unauthenticated limits and secondary limits from forbidden responses", async () => {
    const query = context("Compare JavaScript charting libraries");
    server.use(
      http.get(githubSearch, () =>
        HttpResponse.json(
          {},
          { status: 403, headers: { "X-RateLimit-Remaining": "0" } },
        ),
      ),
    );
    await expect(providers.github.retrieve(query)).rejects.toMatchObject({
      code: "rate_limited",
      upstreamStatus: 403,
    });
    server.use(
      http.get(githubSearch, () =>
        HttpResponse.json(
          { message: "You have exceeded a secondary rate limit." },
          { status: 403 },
        ),
      ),
    );
    await expect(providers.github.retrieve(query)).rejects.toMatchObject({
      code: "rate_limited",
    });
    server.use(
      http.get(githubSearch, () =>
        HttpResponse.json({ message: "Forbidden" }, { status: 403 }),
      ),
    );
    await expect(providers.github.retrieve(query)).rejects.toMatchObject({
      code: "upstream_error",
    });
  });

  test("official docs restrict search domains and verify the actual returned URL", async () => {
    server.use(
      http.post(tavily, async ({ request }) => {
        expect(await request.json()).toMatchObject({
          include_domains: ["react.dev"],
          include_domains_mode: "restrict",
        });
        return HttpResponse.json({
          results: [
            reactDoc,
            {
              ...reactDoc,
              url: "https://react.dev.example.test/reference/react/useState",
            },
            { ...reactDoc, url: "https://react.dev/blog" },
          ],
        });
      }),
    );
    const result = await providers["official-docs"].retrieve(
      context("React useState hook"),
    );
    expect(result.malformed).toBe(false);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].source).toEqual({
      name: "React documentation",
      provider: "official-docs",
      type: "official-documentation",
      url: reactDoc.url,
    });
  });
});

describe("retrieval orchestration", () => {
  test("starts independent providers together", async () => {
    const wikiStarted = Promise.withResolvers<void>();
    const webStarted = Promise.withResolvers<void>();
    server.use(
      http.get(wikipedia, async () => {
        wikiStarted.resolve();
        await webStarted.promise;
        return wikiMatches();
      }),
      http.post(tavily, async () => {
        webStarted.resolve();
        await wikiStarted.promise;
        return tavilyMatches();
      }),
    );

    const result = await retrieve("What is machine learning?");
    expect(retrievalResponseSchema.parse(result)).toEqual(result);
    expect(result.status).toBe("ok");
    expect(result.results).toHaveLength(2);
    expect(result.errors).toEqual([]);
  });

  test("keeps successful results when another provider hits its deadline", async () => {
    const boundedRetrieve = createRetrievalService({
      ...providers,
      wikipedia: { ...providers.wikipedia, timeoutMs: 25 },
    });
    server.use(
      http.get(wikipedia, async () => {
        await delay(100);
        return wikiMatches();
      }),
      http.post(tavily, tavilyMatches),
    );
    const result = await boundedRetrieve("Machine learning");
    expect(result.status).toBe("partial");
    expect(result.results.map(({ source }) => source.url)).toEqual([
      webMatch.url,
    ]);
    expect(result.errors).toEqual([
      expect.objectContaining({ provider: "wikipedia", code: "timeout" }),
    ]);
  });

  test("keeps valid sibling results and records malformed rows", async () => {
    server.use(
      http.get(wikipedia, wikiMatches),
      http.post(tavily, () =>
        HttpResponse.json({
          results: [
            { ...webMatch, url: "javascript:alert(1)" },
            { ...webMatch, url: "https://user:password@example.test/leak" },
            { ...webMatch, title: undefined },
            webMatch,
          ],
        }),
      ),
    );

    const result = await retrieve("Machine learning");
    expect(result.status).toBe("partial");
    expect(result.results).toHaveLength(2);
    expect(result.errors).toEqual([
      expect.objectContaining({
        provider: "tavily",
        code: "malformed_response",
      }),
    ]);
  });

  test("deduplicates canonical URLs, preserves provenance and ranks distinct sources by relevance", async () => {
    const officialUrl = `${reactDoc.url}/?utm_source=docs#usage`;
    server.use(
      http.post(tavily, async ({ request }) => {
        const input = (await request.json()) as { include_domains?: string[] };
        return HttpResponse.json({
          results: input.include_domains
            ? [{ ...reactDoc, url: officialUrl }]
            : [
                reactDoc,
                { ...reactDoc, url: "https://example.test/useState" },
                {
                  title: "Gardening",
                  url: "https://example.test/gardening",
                  content: "Soil and seeds",
                },
              ],
        });
      }),
    );

    const first = await retrieve("React useState hook");
    expect(first.results.map(({ source }) => source.url)).toEqual([
      officialUrl,
      "https://example.test/useState",
      "https://example.test/gardening",
    ]);
    expect(first.results[0].source.provider).toBe("official-docs");
    expect(first.results[0].relevanceScore).toBeGreaterThan(
      first.results[1].relevanceScore!,
    );
    const second = await retrieve("React useState hook");
    expect(second.results.map(({ id }) => id)).toEqual(
      first.results.map(({ id }) => id),
    );
  });

  test("returns an empty result for successful empty searches and rejects invalid inputs", async () => {
    server.use(
      http.get(wikipedia, () => HttpResponse.json({ batchcomplete: true })),
      http.post(tavily, () => HttpResponse.json({ results: [] })),
    );
    await expect(retrieve("  ")).rejects.toThrow();
    await expect(retrieve("x".repeat(301))).rejects.toThrow();
    await expect(
      retrieve("A completely unknown concept"),
    ).resolves.toMatchObject({
      status: "ok",
      results: [],
      errors: [],
    });
  });
});

describe("POST /api/retrieve", () => {
  test("returns normalized JSON for valid input with no-store caching", async () => {
    server.use(
      http.get(wikipedia, wikiMatches),
      http.post(tavily, tavilyMatches),
    );
    const response = await post("  What is machine learning?  ");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = retrievalResponseSchema.parse(await response.json());
    expect(body.query).toBe("What is machine learning?");
    expect(body.results).toHaveLength(2);
  });

  test.each(["   ", "x".repeat(301)])(
    "rejects blank or overlong queries",
    async (query) => {
      const response = await post(query);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "invalid_query" },
      });
    },
  );

  test("rejects malformed, oversized and non-JSON requests before contacting providers", async () => {
    const request = (body: string, contentType = "application/json") =>
      new Request("http://localhost/api/retrieve", {
        method: "POST",
        body,
        headers: { "Content-Type": contentType },
      });
    expect((await POST(request("{"))).status).toBe(400);
    expect((await POST(request("x".repeat(4097)))).status).toBe(413);
    expect(
      (await POST(request('{"query":"hello"}', "text/plain"))).status,
    ).toBe(415);
  });

  test("returns partial evidence and never exposes credentials or an upstream error body", async () => {
    server.use(
      http.get(wikipedia, wikiMatches),
      http.post(tavily, () =>
        HttpResponse.json(
          { error: `key=${fakeKey}; internal stack` },
          { status: 401 },
        ),
      ),
    );
    const response = await post("Machine learning");
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(fakeKey);
    expect(text).not.toContain("internal stack");
    expect(retrievalResponseSchema.parse(JSON.parse(text))).toMatchObject({
      status: "partial",
      results: [expect.objectContaining({ title: article.title })],
      errors: [
        expect.objectContaining({
          provider: "tavily",
          code: "unavailable",
          upstreamStatus: 401,
        }),
      ],
    });
  });

  test("reports complete provider failures with safe status codes", async () => {
    server.use(
      http.get(wikipedia, () =>
        HttpResponse.json(
          { error: "Internal upstream error" },
          { status: 500 },
        ),
      ),
      http.post(tavily, () => HttpResponse.json({}, { status: 429 })),
    );
    const failure = await post("Machine learning");
    expect(failure.status).toBe(502);
    expect(retrievalResponseSchema.parse(await failure.json())).toMatchObject({
      status: "failed",
      results: [],
    });

    vi.stubEnv("TAVILY_API_KEY", undefined);
    const unavailable = await post("React useState hook");
    expect(unavailable.status).toBe(503);
    expect(
      retrievalResponseSchema.parse(await unavailable.json()),
    ).toMatchObject({
      status: "failed",
      results: [],
      errors: [
        expect.objectContaining({
          provider: "official-docs",
          code: "unavailable",
        }),
        expect.objectContaining({ provider: "tavily", code: "unavailable" }),
      ],
    });
  });
});
