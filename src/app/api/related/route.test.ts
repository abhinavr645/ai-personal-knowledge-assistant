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
import {
  maxRelatedBodyBytes,
  relatedResponseSchema,
} from "@/lib/exploration/contracts";
import { concept } from "../../../../tests/fixtures/exploration";
import { modelKnowledge } from "../../../../tests/fixtures/knowledge";
import { POST } from "./route";

const wiki = "https://en.wikipedia.org/w/api.php";
const tavily = "https://api.tavily.com/search";
const gemini =
  /https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-3\.8-flash:generateContent$/;
const geminiKey = "expansion-test-only-gemini";
const tavilyKey = "expansion-test-only-tavily";
const { id, name, description } = concept("Supervised Learning");
const context = {
  topic: "Machine Learning",
  concept: { id, name, description },
  neighbors: [{ id: concept("Machine Learning").id, name: "Machine Learning" }],
  existingConceptIds: [id, concept("Machine Learning").id],
};
const article = {
  title: "Supervised learning",
  canonicalurl: "https://en.wikipedia.org/wiki/Supervised_learning",
  extract:
    "Supervised learning uses labeled data for classification and regression.",
};
const wikiResult = () =>
  HttpResponse.json({ batchcomplete: true, query: { pages: [article] } });
const noWebResults = () => HttpResponse.json({ results: [] });
const failedProvider = () =>
  HttpResponse.json({ details: tavilyKey }, { status: 500 });
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.stubEnv("GEMINI_API_KEY", geminiKey);
  vi.stubEnv("GEMINI_MODEL", undefined);
  vi.stubEnv("TAVILY_API_KEY", tavilyKey);
});
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
afterAll(() => server.close());

function post(input: unknown = context, contentType = "application/json") {
  return POST(
    new Request("http://localhost/api/related", {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: typeof input === "string" ? input : JSON.stringify(input),
    }),
  );
}

type Model = ReturnType<typeof modelKnowledge>;

function generation(
  change: (model: Model, sourceId: string) => void = () => {},
) {
  return vi.fn(async ({ request }: { request: Request }) => {
    expect(request.headers.get("x-goog-api-key")).toBe(geminiKey);
    const payload = (await request.json()) as {
      contents: { parts: { text: string }[] }[];
      systemInstruction: { parts: { text: string }[] };
    };
    const input = JSON.parse(payload.contents[0].parts[0].text);
    expect(input).toMatchObject({
      topic: context.topic,
      expansion: {
        ...context,
        existingConceptIds: expect.arrayContaining(context.existingConceptIds),
      },
      evidence: [{ url: article.canonicalurl, text: article.extract }],
    });
    expect(payload.systemInstruction.parts[0].text).toContain(
      "exact supplied name as the anchor",
    );
    const sourceId = input.evidence[0].sourceId as string;
    const model = modelKnowledge(sourceId);
    const template = model.concepts[0];
    model.concepts.push({
      ...template,
      id: "classification",
      name: "Classification",
    });
    model.relationships.push({
      ...model.relationships[0],
      id: "anchor-classification",
      sourceConceptId: "supervised-learning",
      targetConceptId: "classification",
      type: "USES",
    });
    change(model, sourceId);
    return HttpResponse.json({
      candidates: [
        {
          finishReason: "STOP",
          content: { role: "model", parts: [{ text: JSON.stringify(model) }] },
        },
      ],
    });
  });
}

test("reuses retrieval, LangGraph and Gemini, preserving context and returning only connected additions with citations", async () => {
  const searchWeb = vi.fn(async ({ request }: { request: Request }) => {
    expect(await request.json()).toMatchObject({
      query: "Supervised Learning Machine Learning",
    });
    return noWebResults();
  });
  const generate = generation((model) => {
    const classifier = model.concepts[2];
    const edge = model.relationships[1];
    model.concepts.push(
      { ...classifier, id: "duplicate", name: "CLASSIFICATION" },
      { ...classifier, id: "unconnected", name: "Unconnected" },
    );
    model.relationships.push(
      { ...edge, id: "duplicate-edge", targetConceptId: "duplicate" },
      { ...edge, id: "self-loop", targetConceptId: edge.sourceConceptId },
      { ...edge, id: "dangling", targetConceptId: "missing" },
    );
  });
  server.use(
    http.get(wiki, wikiResult),
    http.post(tavily, searchWeb),
    http.post(gemini, generate),
  );

  const response = await post();
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const text = await response.text();
  expect(text).not.toContain(geminiKey);
  expect(text).not.toContain(tavilyKey);
  const data = relatedResponseSchema.parse(JSON.parse(text));
  expect(data).toMatchObject({
    query: context.topic,
    conceptId: id,
    status: "ok",
    generation: { promptVersion: "knowledge-expansion-v1" },
    knowledge: {
      concepts: [expect.objectContaining({ id: concept("Classification").id })],
      relationships: [
        expect.objectContaining({
          sourceConceptId: id,
          targetConceptId: concept("Classification").id,
        }),
      ],
      sources: [expect.objectContaining({ url: article.canonicalurl })],
    },
  });
  expect(generate).toHaveBeenCalledOnce();
  expect(searchWeb).toHaveBeenCalledOnce();
  const logs = vi.mocked(console.info).mock.calls.flat();
  expect(logs.map((log) => log.stage)).toEqual([
    "analyzeQuery",
    "routeSources",
    "retrieveEvidence",
    "processEvidence",
    "generateKnowledge",
    "validateKnowledge",
    "finalizeResponse",
  ]);
  expect(JSON.stringify(logs)).not.toContain("Supervised Learning");
});

test.each([
  [
    "missing concept",
    { ...context, concept: undefined },
    "application/json",
    400,
    "invalid_expansion",
  ],
  [
    "invalid ID",
    {
      ...context,
      concept: { ...context.concept, id: context.neighbors[0].id },
    },
    "application/json",
    400,
    "invalid_expansion",
  ],
  [
    "mismatched name",
    { ...context, concept: { ...context.concept, name: "Other" } },
    "application/json",
    400,
    "invalid_expansion",
  ],
  [
    "too many neighbors",
    { ...context, neighbors: Array(9).fill(context.neighbors[0]) },
    "application/json",
    400,
    "invalid_expansion",
  ],
  [
    "too many IDs",
    { ...context, existingConceptIds: Array(101).fill(id) },
    "application/json",
    400,
    "invalid_expansion",
  ],
  [
    "oversized JSON",
    "x".repeat(maxRelatedBodyBytes + 1),
    "application/json",
    413,
    "body_too_large",
  ],
  ["malformed JSON", "{", "application/json", 400, "invalid_json"],
  [
    "unsupported content type",
    context,
    "text/plain",
    415,
    "unsupported_media_type",
  ],
])(
  "rejects %s before contacting providers",
  async (_name, body, contentType, status, code) => {
    const provider = vi.fn(wikiResult);
    server.use(http.get(wiki, provider));
    const response = await post(body, contentType);
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ error: { code } });
    expect(provider).not.toHaveBeenCalled();
  },
);

test("skips generation when retrieval is empty or fails", async () => {
  const generate = generation();
  server.use(
    http.get(wiki, () => HttpResponse.json({ batchcomplete: true })),
    http.post(tavily, noWebResults),
    http.post(gemini, generate),
  );
  const empty = await post();
  expect(empty.status).toBe(200);
  await expect(empty.json()).resolves.toMatchObject({
    status: "insufficient_evidence",
    conceptId: id,
    knowledge: null,
    evidenceCount: 0,
  });
  server.use(http.get(wiki, failedProvider), http.post(tavily, failedProvider));
  const failed = await post();
  expect(failed.status).toBe(502);
  await expect(failed.json()).resolves.toMatchObject({
    error: { code: "retrieval_failed" },
    retrieval: { status: "failed" },
  });
  expect(generate).not.toHaveBeenCalled();
});

test("returns bounded additions with partial evidence", async () => {
  server.use(
    http.get(wiki, wikiResult),
    http.post(tavily, failedProvider),
    http.post(
      gemini,
      generation((model) => {
        for (let number = 0; number < 5; number += 1) {
          const localId = `example-${number}`;
          model.concepts.push({
            ...model.concepts[2],
            id: localId,
            name: `Example ${number}`,
          });
          model.relationships.push({
            ...model.relationships[1],
            id: `edge-${number}`,
            targetConceptId: localId,
          });
        }
      }),
    ),
  );
  const response = await post();
  const body = relatedResponseSchema.parse(await response.json());
  expect(body.retrieval).toMatchObject({ status: "partial", resultCount: 1 });
  expect(body.knowledge?.concepts).toHaveLength(6);
  const existingConceptIds = [
    ...context.existingConceptIds,
    ...Array.from({ length: 97 }, (_, index) => concept(`Known ${index}`).id),
  ];
  const capped = await post({ ...context, existingConceptIds });
  expect(existingConceptIds).toHaveLength(99);
  expect(capped.status).toBe(200);
  const cappedBody = relatedResponseSchema.parse(await capped.json());
  expect(cappedBody.knowledge?.concepts).toHaveLength(1);
});

test.each([
  [
    "invented source",
    (model: Model) => {
      model.relationships[1].sourceIds = ["missing-source"];
    },
    "invalid_source_references",
  ],
  [
    "oversized generation",
    (model: Model) => {
      model.concepts.push(...Array(6).fill(model.concepts[2]));
    },
    "invalid_generated_schema",
  ],
])("rejects an %s", async (_name, change, code) => {
  server.use(
    http.get(wiki, wikiResult),
    http.post(tavily, noWebResults),
    http.post(gemini, generation(change)),
  );
  const response = await post();
  expect(response.status).toBe(502);
  await expect(response.json()).resolves.toMatchObject({ error: { code } });
});

test("returns safe errors when the generation provider rejects credentials", async () => {
  server.use(
    http.get(wiki, wikiResult),
    http.post(tavily, noWebResults),
    http.post(gemini, () =>
      HttpResponse.json(
        {
          error: {
            code: 401,
            status: "UNAUTHENTICATED",
            message: `Upstream credentials: ${geminiKey}`,
          },
        },
        { status: 401 },
      ),
    ),
  );
  const response = await post();
  expect(response.status).toBe(502);
  const body = await response.text();
  expect(JSON.parse(body)).toMatchObject({
    error: { code: "gemini_authentication_failed" },
  });
  expect(body).not.toContain(geminiKey);
  expect(body).not.toContain("Upstream credentials");
});
