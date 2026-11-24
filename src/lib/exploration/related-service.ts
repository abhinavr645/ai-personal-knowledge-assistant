import "server-only";

import { runSearchWorkflow } from "@/lib/langgraph/search-workflow";
import { maxQueryLength } from "@/lib/retrieval/schemas";
import {
  maxExplorationNodes,
  type Knowledge,
  type RelatedRequest,
} from "./contracts";

function focusedQuery({ concept, neighbors, topic }: RelatedRequest) {
  const context = [concept.name, neighbors[0]?.name, topic].filter(
    (value): value is string => Boolean(value),
  );
  return [...new Set(context)].join(" ").slice(0, maxQueryLength).trimEnd();
}

function selectAdditions(
  knowledge: Knowledge,
  request: RelatedRequest,
): Knowledge {
  const existing = new Set(request.existingConceptIds);
  const remaining = maxExplorationNodes - existing.size;
  const byId = new Map(
    knowledge.concepts.map((concept) => [concept.id, concept]),
  );
  const connected = new Set([request.concept.id]);
  const queue = [request.concept.id];
  const concepts: Knowledge["concepts"] = [];

  // Keep an evidence-backed path to the anchor for every admitted concept,
  // even when there are fewer available slots than the model returned.
  for (const id of queue) {
    for (const edge of knowledge.relationships) {
      const neighbor =
        edge.sourceConceptId === id
          ? edge.targetConceptId
          : edge.targetConceptId === id
            ? edge.sourceConceptId
            : undefined;
      if (!neighbor || connected.has(neighbor)) continue;
      if (existing.has(id) && existing.has(neighbor)) continue;
      const concept = byId.get(neighbor);
      if (!concept) continue;
      if (!existing.has(neighbor)) {
        if (concepts.length >= remaining) continue;
        concepts.push(concept);
      }
      connected.add(neighbor);
      queue.push(neighbor);
    }
  }

  const relationships = knowledge.relationships.filter(
    ({ sourceConceptId, targetConceptId }) =>
      connected.has(sourceConceptId) &&
      connected.has(targetConceptId) &&
      (!existing.has(sourceConceptId) || !existing.has(targetConceptId)),
  );
  return { ...knowledge, concepts, relationships };
}

export async function runRelated(request: RelatedRequest, signal: AbortSignal) {
  const result = await runSearchWorkflow(
    focusedQuery(request),
    signal,
    request,
  );
  const { body } = result;
  if ("error" in body) return result;
  return {
    status: result.status,
    body: {
      ...body,
      query: request.topic,
      conceptId: request.concept.id,
      knowledge:
        body.status === "ok" ? selectAdditions(body.knowledge, request) : null,
    },
  };
}
