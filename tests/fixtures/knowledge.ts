import type { ModelKnowledge } from "@/lib/ai/schemas";
import type { RetrievalResult } from "@/lib/retrieval/types";

export const sourceId = "a".repeat(64);

export function evidenceItem(
  id = sourceId,
  text = "Machine learning models learn from examples. Supervised learning uses labeled examples.",
): RetrievalResult {
  return {
    id,
    title: "Machine learning overview",
    content: { kind: "snippet", text },
    source: {
      provider: "tavily",
      type: "web",
      name: "Example documentation",
      url: `https://example.test/articles/${id}?edition=1#overview`,
      publishedAt: "2025-01-01T12:00:00Z",
      updatedAt: "2025-02-03T13:00:00Z",
    },
    retrievedAt: "2026-11-25T00:00:00.000Z",
  };
}

export function modelKnowledge(id = sourceId): ModelKnowledge {
  return {
    evidenceStatus: "sufficient",
    evidenceNote: "",
    explanation: {
      title: "Machine learning",
      summary: {
        text: "Machine learning models learn from data.",
        kind: "evidence",
        sourceIds: [id],
      },
      detail: {
        text: "Training adjusts a model based on examples so it can generalize to new data.",
        kind: "synthesis",
        sourceIds: [id],
      },
      sections: [
        {
          heading: "Learning from examples",
          text: "Supervised learning uses labeled examples.",
          kind: "evidence",
          sourceIds: [id],
        },
      ],
      takeaways: [
        {
          text: "Training uses examples to fit a model.",
          kind: "synthesis",
          sourceIds: [id],
        },
      ],
    },
    concepts: [
      {
        id: "machine-learning",
        name: "Machine Learning",
        description: "Models learn from data.",
        category: "Field",
        sourceIds: [id],
      },
      {
        id: "supervised-learning",
        name: "Supervised Learning",
        description: "Learning from labeled examples.",
        category: "Learning approach",
        sourceIds: [id],
      },
    ],
    relationships: [
      {
        id: "supervised-part-of-machine",
        sourceConceptId: "supervised-learning",
        targetConceptId: "machine-learning",
        type: "PART_OF",
        explanation: "Supervised learning is a category of machine learning.",
        sourceIds: [id],
      },
    ],
  };
}
