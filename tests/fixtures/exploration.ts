import { createHash } from "node:crypto";
import type {
  Knowledge,
  RelatedResult,
  SearchResult,
} from "@/lib/exploration/contracts";
import { evidenceItem, sourceId } from "./knowledge";

function id(kind: "concept" | "relationship", fields: string[]) {
  return `${kind}-${createHash("sha256").update(JSON.stringify(fields)).digest("hex").slice(0, 24)}`;
}

export function concept(name: string): Knowledge["concepts"][number] {
  return {
    id: id("concept", [name.toLowerCase()]),
    name,
    description: `A concept about ${name}.`,
    category: "Principle",
    sourceIds: [sourceId],
  };
}

export function relationship(
  source: string,
  target: string,
): Knowledge["relationships"][number] {
  const sourceConceptId = concept(source).id;
  const targetConceptId = concept(target).id;
  return {
    id: id("relationship", ["USES", sourceConceptId, targetConceptId]),
    sourceConceptId,
    targetConceptId,
    type: "USES",
    explanation: `${source} uses ${target}.`,
    sourceIds: [sourceId],
  };
}

export function success(
  topic: string,
  title: string,
  names: string[],
  edges: [string, string][],
): Extract<SearchResult, { status: "ok" }> {
  const evidence = evidenceItem();
  const claim = {
    text: `Evidence for ${title}.`,
    kind: "evidence" as const,
    sourceIds: [sourceId],
  };
  return {
    status: "ok",
    query: topic,
    evidenceCount: 1,
    generation: { model: "test", promptVersion: "knowledge-v1" },
    retrieval: {
      status: "ok",
      providers: ["tavily"],
      errors: [],
      resultCount: 1,
    },
    knowledge: {
      evidenceStatus: "sufficient",
      evidenceNote: "",
      explanation: {
        title,
        summary: claim,
        detail: { ...claim, text: `Details about ${title}.` },
        sections: [],
        takeaways: [claim],
      },
      concepts: names.map(concept),
      relationships: edges.map(([source, target]) =>
        relationship(source, target),
      ),
      sources: [
        {
          id: evidence.id,
          title: "Reference documentation",
          url: evidence.source.url,
          provider: evidence.source.provider,
          sourceName: evidence.source.name,
        },
      ],
    },
  };
}

export const javascript = success(
  "JavaScript",
  "JavaScript overview",
  ["React", "JavaScript"],
  [["React", "JavaScript"]],
);

export const reactExpansion = {
  ...success(
    "JavaScript",
    "React details",
    ["Components", "Hooks"],
    [
      ["React", "Components"],
      ["Components", "Hooks"],
    ],
  ),
  conceptId: concept("React").id,
} satisfies RelatedResult;

export const hooksExpansion = {
  ...success(
    "JavaScript",
    "Hooks details",
    ["useState"],
    [["Hooks", "useState"]],
  ),
  conceptId: concept("Hooks").id,
} satisfies RelatedResult;

export function insufficient(query: string): SearchResult {
  return {
    status: "insufficient_evidence",
    query,
    knowledge: null,
    generation: null,
    evidenceCount: 0,
    message: "No usable evidence was retrieved for this topic.",
    retrieval: {
      status: "ok",
      providers: ["tavily"],
      errors: [],
      resultCount: 0,
    },
  };
}
