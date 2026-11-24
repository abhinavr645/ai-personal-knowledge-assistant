// @vitest-environment node

import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from "vitest";
import { defaultGeminiModel, maxOutputTokens } from "@/lib/ai/gemini-client";
import { modelKnowledge } from "../../../../tests/fixtures/knowledge";
import { POST } from "./route";

const wikipedia = "https://en.wikipedia.org/w/api.php";
const tavily = "https://api.tavily.com/search";
const gemini =
  /https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-3\.8-flash:generateContent$/;
const geminiKey = "test-only-gemini-credential";
const tavilyKey = "test-only-tavily-credential";
const articleUrl = "https://en.wikipedia.org/wiki/Machine_learning";
const query = "What is machine learning?";
const article = {
  title: "Machine learning",
  canonicalurl: articleUrl,
  extract:
    "Machine learning models learn from data. Supervised learning uses labeled examples.",
};
const wikiResult = () =>
  HttpResponse.json({ batchcomplete: true, query: { pages: [article] } });
const noWebResults = () => HttpResponse.json({ results: [] });

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.stubEnv("GEMINI_API_KEY", geminiKey);
  vi.stubEnv("GEMINI_MODEL", undefined);
  vi.stubEnv("TAVILY_API_KEY", tavilyKey);
});
afterEach(() => {
  vi.restoreAllMocks();
  server.resetHandlers();
  vi.unstubAllEnvs();
});
afterAll(() => server.close());

function post(input: string) {
  return POST(
    new Request("http://localhost/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: input }),
    }),
  );
}

function geminiResult(output: unknown) {
  return HttpResponse.json({
    candidates: [
      {
        finishReason: "STOP",
        content: { role: "model", parts: [{ text: JSON.stringify(output) }] },
      },
    ],
  });
}

function generateFromEvidence() {
  return vi.fn(async ({ request }: { request: Request }) => {
    expect(request.headers.get("x-goog-api-key")).toBe(geminiKey);
    const payload = (await request.json()) as {
      contents: { parts: { text: string }[] }[];
      generationConfig: Record<string, unknown>;
    };
    expect(payload.generationConfig).toMatchObject({
      responseMimeType: "application/json",
      maxOutputTokens,
      responseJsonSchema: { type: "object", additionalProperties: false },
    });
    expect(JSON.stringify(payload)).not.toContain(geminiKey);
    const input = JSON.parse(payload.contents[0].parts[0].text);
    expect(input).toMatchObject({
      topic: query,
      evidence: [
        expect.objectContaining({
          provider: "wikipedia",
          url: articleUrl,
          text: article.extract,
        }),
      ],
    });
    return geminiResult(modelKnowledge(input.evidence[0].sourceId));
  });
}

test("runs the actual SDK transport against mocks and returns grounded knowledge with retrieval metadata", async () => {
  const generate = generateFromEvidence();
  server.use(
    http.get(wikipedia, wikiResult),
    http.post(tavily, noWebResults),
    http.post(gemini, generate),
  );

  const response = await post(`  ${query}  `);
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const text = await response.text();
  expect(text).not.toContain(geminiKey);
  expect(text).not.toContain(tavilyKey);
  const body = JSON.parse(text);
  expect(body).toMatchObject({
    status: "ok",
    query,
    evidenceCount: 1,
    generation: { model: defaultGeminiModel, promptVersion: "knowledge-v1" },
    retrieval: {
      status: "ok",
      providers: ["wikipedia", "tavily"],
      errors: [],
      resultCount: 1,
    },
    knowledge: {
      explanation: { title: "Machine learning" },
      sources: [
        {
          id: expect.stringMatching(/^[a-f0-9]{64}$/),
          title: article.title,
          url: articleUrl,
          provider: "wikipedia",
          sourceName: "Wikipedia",
        },
      ],
    },
  });
  expect(body.knowledge.explanation.summary.sourceIds).toEqual([
    body.knowledge.sources[0].id,
  ]);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(
    vi.mocked(console.info).mock.calls.map(([event]) => event.stage),
  ).toEqual([
    "analyzeQuery",
    "routeSources",
    "retrieveEvidence",
    "processEvidence",
    "generateKnowledge",
    "validateKnowledge",
    "finalizeResponse",
  ]);
});

test.each(["   ", "x".repeat(301)])(
  "rejects an invalid query before making provider requests",
  async (input) => {
    const request = vi.fn(wikiResult);
    server.use(http.get(wikipedia, request));
    const response = await post(input);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_query" },
    });
    expect(request).not.toHaveBeenCalled();
  },
);

test("reports missing credentials before retrieval or generation", async () => {
  vi.stubEnv("GEMINI_API_KEY", undefined);
  const request = vi.fn(wikiResult);
  server.use(http.get(wikipedia, request));
  const response = await post(query);
  expect(response.status).toBe(503);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "gemini_missing_credentials" },
  });
  expect(request).not.toHaveBeenCalled();
});

test("distinguishes failed retrieval from a successful empty search and skips Gemini for both", async () => {
  const generate = vi.fn(() => geminiResult(modelKnowledge()));
  server.use(
    http.get(wikipedia, () => HttpResponse.json({ batchcomplete: true })),
    http.post(tavily, noWebResults),
    http.post(gemini, generate),
  );
  const empty = await post(query);
  expect(empty.status).toBe(200);
  await expect(empty.json()).resolves.toMatchObject({
    status: "insufficient_evidence",
    knowledge: null,
    generation: null,
    retrieval: { status: "ok", resultCount: 0 },
  });

  server.use(
    http.get(wikipedia, () => HttpResponse.json({}, { status: 500 })),
    http.post(tavily, () => HttpResponse.json({}, { status: 429 })),
  );
  const failed = await post(query);
  expect(failed.status).toBe(502);
  await expect(failed.json()).resolves.toMatchObject({
    error: { code: "retrieval_failed" },
    retrieval: { status: "failed", resultCount: 0, errors: expect.any(Array) },
  });
  expect(generate).not.toHaveBeenCalled();
});

test("continues with partial retrieval evidence and keeps provider errors separate", async () => {
  server.use(
    http.get(wikipedia, wikiResult),
    http.post(tavily, () => HttpResponse.json({}, { status: 429 })),
    http.post(gemini, generateFromEvidence()),
  );

  const response = await post(query);
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    status: "ok",
    knowledge: { sources: [{ url: articleUrl }] },
    retrieval: {
      status: "partial",
      resultCount: 1,
      errors: [
        expect.objectContaining({ provider: "tavily", code: "rate_limited" }),
      ],
    },
  });
});

test("returns a sanitized Gemini failure and preserves retrieval metadata without retrying", async () => {
  const generate = vi.fn(() =>
    HttpResponse.json(
      {
        error: {
          code: 401,
          status: "UNAUTHENTICATED",
          message: `Upstream stack credentials: ${geminiKey}`,
        },
      },
      { status: 401 },
    ),
  );
  server.use(
    http.get(wikipedia, wikiResult),
    http.post(tavily, noWebResults),
    http.post(gemini, generate),
  );

  const response = await post(query);
  expect(response.status).toBe(502);
  const text = await response.text();
  expect(text).not.toContain(geminiKey);
  expect(text).not.toContain("Upstream stack");
  expect(JSON.parse(text)).toMatchObject({
    error: { code: "gemini_authentication_failed" },
    retrieval: { status: "ok", resultCount: 1 },
  });
  expect(generate).toHaveBeenCalledTimes(1);
});

test("rejects model-authored references outside the supplied evidence", async () => {
  server.use(
    http.get(wikipedia, wikiResult),
    http.post(tavily, noWebResults),
    http.post(gemini, () => geminiResult(modelKnowledge("invented-source"))),
  );

  const response = await post(query);
  expect(response.status).toBe(502);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "invalid_source_references" },
    retrieval: { resultCount: 1 },
  });
});
