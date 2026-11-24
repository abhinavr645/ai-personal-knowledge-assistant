import { beforeEach, expect, test, vi } from "vitest";
import {
  concept,
  javascript,
  reactExpansion,
} from "../../../tests/fixtures/exploration";
import { createTopicGraph, mergeKnowledge } from "./graph";
import {
  historyVersion,
  restoreExploration,
  snapshotContent,
} from "./history-snapshot";
import {
  createExplorationStorage,
  historyKeyPrefix,
  maxSavedExplorations,
  maxSnapshotLength,
} from "./history-storage";

beforeEach(() => window.localStorage.clear());

const store = createExplorationStorage();
const createdAt = "2026-11-25T00:00:00.000Z";
const topic = javascript.query;
const graph = createTopicGraph(topic, javascript.knowledge);
const reactId = concept("React").id;

function originalContent() {
  return snapshotContent(
    {
      topic,
      graph,
      knowledge: javascript.knowledge,
      expansions: {},
    },
    graph.rootNodeId,
  );
}

function expandedContent() {
  return snapshotContent(
    {
      topic,
      graph: {
        ...mergeKnowledge(graph, reactExpansion.knowledge, reactId),
        rootNodeId: graph.rootNodeId,
      },
      knowledge: javascript.knowledge,
      expansions: {
        [reactId]: { status: "expanded", knowledge: reactExpansion.knowledge },
      },
    },
    reactId,
    { [reactId]: { x: 258.25, y: 81.5 } },
  );
}

test("creates, loads, updates, renames, lists, and removes versioned records", () => {
  const id = crypto.randomUUID();
  expect(store.list()).toEqual({ entries: [], skipped: 0 });
  expect(() => store.load(id)).toThrow(
    expect.objectContaining({ code: "missing" }),
  );
  const initial = store.create(id, topic, createdAt, originalContent());
  expect(initial).toMatchObject({
    id,
    title: topic,
    createdAt,
    version: historyVersion,
  });
  expect(store.load(id)).toEqual(initial);
  expect(store.list().entries).toEqual([
    { id, title: topic, updatedAt: initial.updatedAt, conceptCount: 2 },
  ]);

  const renamed = store.rename(id, "  Web concepts  ");
  expect(renamed.title).toBe("Web concepts");
  const expanded = store.update(id, expandedContent());
  expect(expanded).toMatchObject({
    title: "Web concepts",
    createdAt,
    content: { selectedId: reactId },
  });
  expect(store.load(id)).toEqual(expanded);
  expect(store.list().entries[0]).toMatchObject({
    title: "Web concepts",
    conceptCount: 4,
  });
  expect(expanded.content.sources).toHaveLength(1);
  expect(expanded.content.overview).not.toHaveProperty("concepts");
  expect(expanded.content.positions?.[reactId]).toEqual({ x: 258.25, y: 81.5 });
  const restored = restoreExploration(expanded.content);
  expect(restored.expansions[reactId]).toMatchObject({
    status: "expanded",
    knowledge: {
      explanation: reactExpansion.knowledge.explanation,
      sources: reactExpansion.knowledge.sources,
    },
  });

  store.remove(id);
  expect(store.list().entries).toEqual([]);
  expect(() => store.update(id, expandedContent())).toThrow(
    expect.objectContaining({ code: "missing" }),
  );
});

test("skips unchanged updates and orders saved entries by newest timestamp", () => {
  vi.useFakeTimers();
  const write = vi.spyOn(Storage.prototype, "setItem");
  try {
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    vi.setSystemTime(new Date("2026-11-25T01:00:00Z"));
    store.create(first, topic, createdAt, originalContent());
    vi.setSystemTime(new Date("2026-11-25T02:00:00Z"));
    store.create(second, topic, createdAt, originalContent());
    expect(store.list().entries.map(({ id }) => id)).toEqual([second, first]);
    expect(store.update(first, originalContent()).updatedAt).toBe(
      "2026-11-25T01:00:00.000Z",
    );
    expect(write).toHaveBeenCalledTimes(2);
    vi.setSystemTime(new Date("2026-11-25T03:00:00Z"));
    store.rename(first, "Newest");
    expect(store.list().entries[0]).toMatchObject({ title: "Newest" });
  } finally {
    write.mockRestore();
    vi.useRealTimers();
  }
});

test("isolates malformed JSON and unsupported versions from readable history", () => {
  const id = crypto.randomUUID();
  const later = crypto.randomUUID();
  const malformed = crypto.randomUUID();
  const valid = store.create(id, topic, createdAt, originalContent());
  const unknownVersion = JSON.stringify({
    ...valid,
    id: later,
    version: historyVersion + 1,
  });
  localStorage.setItem(historyKeyPrefix + later, unknownVersion);
  localStorage.setItem(historyKeyPrefix + malformed, "{");
  expect(store.list()).toMatchObject({ entries: [{ id }], skipped: 2 });
  expect(() => store.load(later)).toThrow(
    expect.objectContaining({ code: "invalid" }),
  );
  expect(() => store.load(malformed)).toThrow(
    expect.objectContaining({ code: "invalid" }),
  );
  expect(() => store.update(later, expandedContent())).toThrow(
    expect.objectContaining({ code: "invalid" }),
  );
  store.update(id, expandedContent());
  expect(localStorage.getItem(historyKeyPrefix + later)).toBe(unknownVersion);
  expect(localStorage.getItem(historyKeyPrefix + malformed)).toBe("{");
});

test.each([
  ["a dangling edge", { ...graph, nodes: graph.nodes.slice(0, 1) }],
  [
    "a self-loop",
    { ...graph, edges: [{ ...graph.edges[0], target: graph.edges[0].source }] },
  ],
  [
    "duplicate concept IDs",
    { ...graph, nodes: [...graph.nodes, graph.nodes[0]] },
  ],
  [
    "duplicate relationships",
    { ...graph, edges: [...graph.edges, graph.edges[0]] },
  ],
  [
    "an unknown expansion parent",
    {
      ...graph,
      nodes: [
        { ...graph.nodes[0], expandedFrom: concept("Unknown").id },
        graph.nodes[1],
      ],
    },
  ],
  [
    "a graph beyond 100 concepts",
    {
      ...graph,
      nodes: [
        ...graph.nodes,
        ...Array.from({ length: 99 }, (_, number) =>
          concept(`Concept ${number}`),
        ),
      ],
    },
  ],
])("rejects %s and keeps the previously saved graph", (_name, invalidGraph) => {
  const id = crypto.randomUUID();
  const previous = store.create(id, topic, createdAt, originalContent());
  expect(() =>
    store.update(id, { ...originalContent(), graph: invalidGraph }),
  ).toThrow(expect.objectContaining({ code: "invalid" }));
  expect(store.load(id)).toEqual(previous);
});

test("rejects unknown fields, unsafe citation URLs, and missing citation references", () => {
  const id = crypto.randomUUID();
  const content = originalContent();
  for (const invalid of [
    { ...content, apiKey: "test-secret" },
    {
      ...content,
      sources: [{ ...content.sources[0], url: "javascript:alert(1)" }],
    },
    { ...content, sources: [] },
  ]) {
    expect(() => store.create(id, topic, createdAt, invalid)).toThrow(
      expect.objectContaining({ code: "invalid" }),
    );
  }
  expect(store.list().entries).toEqual([]);
});

test("normalizes storage access failures and remains lazy until an operation", () => {
  const unavailable = vi.fn(() => undefined);
  const lazy = createExplorationStorage(unavailable);
  expect(unavailable).not.toHaveBeenCalled();
  expect(() => lazy.list()).toThrow(
    expect.objectContaining({ code: "unavailable" }),
  );
  const blocked = createExplorationStorage(() => {
    throw new DOMException("Browser details", "SecurityError");
  });
  expect(() => blocked.list()).toThrow(
    expect.objectContaining({ code: "unavailable" }),
  );
  const readFailure = vi
    .spyOn(Storage.prototype, "getItem")
    .mockImplementation(() => {
      throw new Error("internal");
    });
  try {
    expect(() => store.load(crypto.randomUUID())).toThrow(
      expect.objectContaining({ code: "unavailable" }),
    );
  } finally {
    readFailure.mockRestore();
  }
});

test("preserves valid data when setItem fails because of browser quota or another exception", () => {
  const id = crypto.randomUUID();
  const previous = store.create(id, topic, createdAt, originalContent());
  const write = vi.spyOn(Storage.prototype, "setItem");
  try {
    write.mockImplementation(() => {
      throw new DOMException("private", "QuotaExceededError");
    });
    expect(() => store.update(id, expandedContent())).toThrow(
      expect.objectContaining({ code: "quota" }),
    );
    expect(store.load(id)).toEqual(previous);
    write.mockImplementation(() => {
      throw new Error("private");
    });
    expect(() => store.rename(id, "New title")).toThrow(
      expect.objectContaining({ code: "unavailable" }),
    );
    expect(store.load(id)).toEqual(previous);
  } finally {
    write.mockRestore();
  }
});

test("enforces the exploration count without evicting records and allows updates at capacity", () => {
  const ids = Array.from({ length: maxSavedExplorations }, () =>
    crypto.randomUUID(),
  );
  for (const id of ids) store.create(id, topic, createdAt, originalContent());
  const extra = crypto.randomUUID();
  expect(() =>
    store.create(extra, topic, createdAt, originalContent()),
  ).toThrow(expect.objectContaining({ code: "count" }));
  expect(
    store
      .list()
      .entries.map(({ id }) => id)
      .sort(),
  ).toEqual([...ids].sort());
  expect(
    store.update(ids[0], expandedContent()).content.graph.nodes,
  ).toHaveLength(4);
  store.remove(ids[1]);
  expect(store.create(extra, topic, createdAt, originalContent()).id).toBe(
    extra,
  );
});

test("refuses a valid snapshot beyond the per-record size budget without losing the prior save", () => {
  const id = crypto.randomUUID();
  const previous = store.create(id, topic, createdAt, originalContent());
  const nodes = Array.from({ length: 92 }, (_, number) =>
    concept(`Extended ${number}`),
  );
  const original = javascript.knowledge;
  const expanded = {
    ...original,
    explanation: {
      ...original.explanation,
      detail: { ...original.explanation.detail, text: "A".repeat(3_000) },
    },
  };
  const large = snapshotContent(
    {
      topic,
      graph: { ...graph, nodes: [...graph.nodes, ...nodes] },
      knowledge: original,
      expansions: Object.fromEntries(
        nodes.map(({ id }) => [
          id,
          { status: "expanded", knowledge: expanded },
        ]),
      ),
    },
    reactId,
  );
  expect(JSON.stringify(large).length).toBeGreaterThan(maxSnapshotLength);
  expect(() => store.update(id, large)).toThrow(
    expect.objectContaining({ code: "size" }),
  );
  expect(store.load(id)).toEqual(previous);
});
