// @vitest-environment node

import { setupServer } from "msw/node";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import {
  evidenceItem,
  modelKnowledge,
} from "../../../tests/fixtures/knowledge";
import { GenerationFailure } from "@/lib/ai/errors";
import type { GeminiClient } from "@/lib/ai/gemini-client";
import {
  requestKnowledge,
  validateKnowledge,
} from "@/lib/ai/generation-service";
import { providers } from "@/lib/retrieval/provider-registry";
import {
  createAnalyzedRetrievalService,
  type retrieveAnalyzed,
} from "@/lib/retrieval/retrieval-service";
import { ProviderFailure } from "@/lib/retrieval/server-http";
import type { RetrievalError } from "@/lib/retrieval/types";
import { SearchState } from "./search-state";
import { createSearchWorkflow, type StageLog } from "./search-workflow";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterAll(() => server.close());

const query = "How does machine learning work?";
const evidence = evidenceItem();
const rateLimited: RetrievalError = {
  provider: "tavily",
  code: "rate_limited",
  message: "The provider has reached its request or usage limit.",
};

function setup(overrides: Parameters<typeof createSearchWorkflow>[0] = {}) {
  const retrieve = vi
    .fn<typeof retrieveAnalyzed>()
    .mockImplementation(async (analysis) => ({
      query: analysis.query,
      providers: [...analysis.providers],
      status: "ok",
      results: [evidence],
      errors: [],
    }));
  const generateJson = vi
    .fn<GeminiClient["generateJson"]>()
    .mockResolvedValue(modelKnowledge());
  const createClient = vi.fn(() => ({
    model: "gemini-3.8-flash",
    generateJson,
  }));
  const request = vi.fn(requestKnowledge);
  const validate = vi.fn(validateKnowledge);
  const log = vi.fn<(event: StageLog) => void>();
  return {
    run: createSearchWorkflow({
      retrieve,
      createClient,
      request,
      validate,
      log,
      ...overrides,
    }),
    retrieve,
    generateJson,
    createClient,
    request,
    validate,
    log,
  };
}

test.each([
  ["What is a neural network?", "general", ["wikipedia", "tavily"]],
  ["React useState hook", "technical", ["official-docs", "tavily"]],
  [
    "Compare popular JavaScript charting libraries",
    "software_discovery",
    ["tavily", "github"],
  ],
  [
    "https://github.com/vercel/next.js",
    "direct_repository",
    ["tavily", "github"],
  ],
])(
  "passes the Phase 4 classification and selected providers for %s to retrieval",
  async (input, category, providerIds) => {
    const { run, retrieve } = setup();
    await run(input, new AbortController().signal);
    expect(retrieve).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        query: input,
        category,
        providers: providerIds,
      }),
      expect.any(AbortSignal),
    );
  },
);

test("executes all seven stages and sends only the finalized API response", async () => {
  const { run, retrieve, request, validate, log } = setup();
  const result = await run(`  ${query}  `);

  expect(result).toMatchObject({
    status: 200,
    body: {
      query,
      status: "ok",
      evidenceCount: 1,
      generation: { model: "gemini-3.8-flash", promptVersion: "knowledge-v1" },
      knowledge: { sources: [{ id: evidence.id, url: evidence.source.url }] },
      retrieval: { status: "ok", resultCount: 1 },
    },
  });
  expect(Object.keys(result.body).sort()).toEqual([
    "evidenceCount",
    "generation",
    "knowledge",
    "query",
    "retrieval",
    "status",
  ]);
  expect(retrieve).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledTimes(1);
  expect(validate).toHaveBeenCalledTimes(1);
  expect(log.mock.calls.map(([event]) => event.stage)).toEqual([
    "analyzeQuery",
    "routeSources",
    "retrieveEvidence",
    "processEvidence",
    "generateKnowledge",
    "validateKnowledge",
    "finalizeResponse",
  ]);
});

test("reuses the service's parallel provider calls and retains partial retrieval", async () => {
  const wikipediaStarted = Promise.withResolvers<void>();
  const tavilyStarted = Promise.withResolvers<void>();
  const wikipedia = vi.fn(async () => {
    wikipediaStarted.resolve();
    await tavilyStarted.promise;
    return { results: [evidence], malformed: false };
  });
  const tavily = vi.fn(async () => {
    tavilyStarted.resolve();
    await wikipediaStarted.promise;
    throw new ProviderFailure("rate_limited", 429);
  });
  const retrieve = vi.fn(
    createAnalyzedRetrievalService({
      ...providers,
      wikipedia: { ...providers.wikipedia, retrieve: wikipedia },
      tavily: { ...providers.tavily, retrieve: tavily },
    }),
  );
  const { run, generateJson } = setup({ retrieve });
  const result = await run(query);

  expect(result).toMatchObject({
    status: 200,
    body: {
      status: "ok",
      retrieval: {
        status: "partial",
        resultCount: 1,
        errors: [
          expect.objectContaining({ code: "rate_limited", provider: "tavily" }),
        ],
      },
    },
  });
  expect(retrieve).toHaveBeenCalledTimes(1);
  expect(wikipedia).toHaveBeenCalledTimes(1);
  expect(tavily).toHaveBeenCalledTimes(1);
  expect(generateJson).toHaveBeenCalledTimes(1);
});

test("short-circuits a complete retrieval failure and retains provider diagnostics", async () => {
  const { run, retrieve, request, log } = setup();
  retrieve.mockResolvedValue({
    query,
    status: "failed",
    providers: ["wikipedia", "tavily"],
    results: [],
    errors: [rateLimited],
  });

  expect(await run(query)).toMatchObject({
    status: 502,
    body: {
      error: { code: "retrieval_failed" },
      retrieval: { status: "failed", errors: [rateLimited], resultCount: 0 },
    },
  });
  expect(request).not.toHaveBeenCalled();
  expect(log.mock.calls.map(([event]) => event.stage)).toEqual([
    "analyzeQuery",
    "routeSources",
    "retrieveEvidence",
    "finalizeResponse",
  ]);
});

test("returns insufficient evidence before calling Gemini when there are no results", async () => {
  const { run, retrieve, request } = setup();
  retrieve.mockResolvedValue({
    query,
    status: "ok",
    providers: ["wikipedia", "tavily"],
    results: [],
    errors: [],
  });
  expect(await run(query)).toMatchObject({
    status: 200,
    body: {
      status: "insufficient_evidence",
      generation: null,
      knowledge: null,
      evidenceCount: 0,
    },
  });
  expect(request).not.toHaveBeenCalled();
});

test("retains retrieval metadata when Gemini reports insufficient evidence", async () => {
  const { run, generateJson, validate } = setup();
  generateJson.mockResolvedValue({
    evidenceStatus: "insufficient",
    evidenceNote: "The source does not address the question.",
    explanation: null,
    concepts: [],
    relationships: [],
  });
  expect(await run(query)).toMatchObject({
    status: 200,
    body: {
      status: "insufficient_evidence",
      knowledge: null,
      evidenceCount: 1,
      retrieval: { status: "ok", resultCount: 1 },
    },
  });
  expect(validate).toHaveBeenCalledTimes(1);
});

test.each([
  ["gemini_authentication_failed", 502],
  ["gemini_rate_limited", 429],
  ["gemini_timeout", 504],
  ["gemini_empty_response", 502],
  ["gemini_invalid_json", 502],
] as const)(
  "finalizes %s without retrying retrieval or generation",
  async (code, status) => {
    const { run, retrieve, generateJson, validate, log } = setup();
    generateJson.mockRejectedValue(new GenerationFailure(code));

    expect(await run(query)).toMatchObject({
      status,
      body: { error: { code }, retrieval: { resultCount: 1 } },
    });
    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(generateJson).toHaveBeenCalledTimes(1);
    expect(validate).not.toHaveBeenCalled();
    expect(log.mock.calls.every(([event]) => event.retryCount === 0)).toBe(
      true,
    );
  },
);

test.each([
  [{ concepts: [] }, "invalid_generated_schema"],
  [modelKnowledge("unknown-id"), "invalid_source_references"],
])(
  "routes invalid output to a safe terminal response (%#)",
  async (output, code) => {
    const { run, retrieve, generateJson, validate } = setup();
    generateJson.mockResolvedValue(output);

    expect(await run(query)).toMatchObject({
      status: 502,
      body: { error: { code }, retrieval: { resultCount: 1 } },
    });
    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(generateJson).toHaveBeenCalledTimes(1);
    expect(validate).toHaveBeenCalledTimes(1);
  },
);

test("validates the state and rejects invalid input before executing a provider", async () => {
  await expect(
    SearchState.validateInput({ providers: ["invalid-provider"] }),
  ).rejects.toThrow();
  await expect(
    SearchState.validateInput({ providers: ["tavily", "tavily"] }),
  ).rejects.toThrow();
  const { run, retrieve } = setup();
  expect(await run("   ")).toMatchObject({
    status: 500,
    body: { error: { code: "search_failed" } },
  });
  expect(retrieve).not.toHaveBeenCalled();
});

test("stops before any query or evidence can reach enabled LangSmith tracing", async () => {
  const network = vi.fn();
  server.events.on("request:start", network);
  vi.stubEnv("LANGSMITH_TRACING", "true");
  vi.stubEnv("LANGSMITH_API_KEY", "mock-tracing-key");
  const { run, retrieve } = setup();
  try {
    expect(await run(query)).toMatchObject({
      status: 500,
      body: { error: { code: "search_failed" } },
    });
    expect(retrieve).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllEnvs();
    server.events.removeListener("request:start", network);
  }
});

test("preserves metadata and excludes user content, secrets, and stack traces from logs and unexpected failures", async () => {
  const secret = "secret-in-upstream-exception";
  const { run, log, generateJson } = setup({
    validate: () => {
      throw new Error(secret);
    },
  });
  const result = await run(query);

  expect(result).toMatchObject({
    status: 500,
    body: {
      error: { code: "search_failed" },
      retrieval: { status: "ok", resultCount: 1 },
    },
  });
  const logs = JSON.stringify(log.mock.calls);
  for (const value of [
    secret,
    query,
    evidence.content.text,
    evidence.source.url,
    "systemInstruction",
  ]) {
    expect(logs).not.toContain(value);
    expect(JSON.stringify(result)).not.toContain(value);
  }
  expect(
    log.mock.calls.some(
      ([event]) =>
        event.stage === "validateKnowledge" &&
        event.errorCode === "search_failed",
    ),
  ).toBe(true);
  expect(generateJson).toHaveBeenCalledTimes(1);
});
