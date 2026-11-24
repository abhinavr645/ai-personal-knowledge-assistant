import "server-only";

import { AsyncLocalStorageProviderSingleton } from "@langchain/core/singletons";
import { END, START, StateGraph, type Runtime } from "@langchain/langgraph";
import { z } from "zod";
import { buildEvidence } from "@/lib/ai/evidence-builder";
import { GenerationFailure } from "@/lib/ai/errors";
import { createGeminiClient, type GeminiClient } from "@/lib/ai/gemini-client";
import {
  noEvidenceResult,
  requestKnowledge,
  validateKnowledge,
} from "@/lib/ai/generation-service";
import {
  relatedRequestSchema,
  type RelatedRequest,
} from "@/lib/exploration/contracts";
import { classifyQuery, routeSources } from "@/lib/retrieval/query-analyzer";
import { retrieveAnalyzed } from "@/lib/retrieval/retrieval-service";
import type { ProviderId } from "@/lib/retrieval/types";
import {
  SearchInput,
  SearchOutput,
  SearchState,
  type SearchResponse,
  type WorkflowFailure,
} from "./search-state";

const contextSchema = z.object({
  expansion: relatedRequestSchema.optional(),
  client: z.custom<GeminiClient>(
    (value) =>
      !!value &&
      typeof value === "object" &&
      "model" in value &&
      typeof value.model === "string" &&
      "generateJson" in value &&
      typeof value.generateJson === "function",
  ),
});
type Context = z.infer<typeof contextSchema>;
type State = typeof SearchState.State;
type Update = typeof SearchState.Update;
type Stage =
  | "analyzeQuery"
  | "routeSources"
  | "retrieveEvidence"
  | "processEvidence"
  | "generateKnowledge"
  | "validateKnowledge"
  | "finalizeResponse"
  | "workflow";
type Node = (
  state: State,
  runtime: Runtime<Context>,
) => Update | Promise<Update>;

export interface StageLog {
  stage: Stage;
  durationMs: number;
  status: "ok" | "partial" | "insufficient_evidence" | "failed";
  retryCount: 0;
  providers?: ProviderId[];
  evidenceCount?: number;
  errorCode?: string;
}

interface Dependencies {
  retrieve?: typeof retrieveAnalyzed;
  createClient?: () => GeminiClient;
  request?: typeof requestKnowledge;
  validate?: typeof validateKnowledge;
  log?: (event: StageLog) => void;
}

const unexpected: WorkflowFailure = {
  status: 500,
  code: "search_failed",
  message: "The search request could not be completed.",
};

const payloadDiagnostics = [
  "LANGSMITH_TRACING",
  "LANGSMITH_TRACING_V2",
  "LANGCHAIN_TRACING",
  "LANGCHAIN_TRACING_V2",
  "LANGCHAIN_VERBOSE",
] as const;

function generationFailure(error: unknown): WorkflowFailure {
  if (!(error instanceof GenerationFailure)) return unexpected;
  const safe = new GenerationFailure(error.code);
  return { code: safe.code, message: safe.message, status: safe.status };
}

function failureResponse(
  failure: WorkflowFailure,
  retrieval?: State["retrieval"],
): SearchResponse {
  return {
    status: failure.status,
    body: {
      error: { code: failure.code, message: failure.message },
      ...(retrieval && { retrieval }),
    },
  };
}

export function createSearchWorkflow({
  retrieve = retrieveAnalyzed,
  createClient = createGeminiClient,
  request = requestKnowledge,
  validate = validateKnowledge,
  log = (event) => console.info({ event: "search_workflow_stage", ...event }),
}: Dependencies = {}) {
  function track(stage: Stage, node: Node): Node {
    return async (state, runtime) => {
      const started = performance.now();
      let update: Update;
      try {
        update = await node(state, runtime);
      } catch (error) {
        update = { failure: generationFailure(error) };
      }

      const failure = update.failure ?? state.failure;
      const count =
        update.validation?.evidenceCount ??
        update.evidence?.items.length ??
        state.evidence?.items.length;
      const providers = update.providers ?? state.providers;
      log({
        stage,
        durationMs: Math.round(performance.now() - started),
        status: failure
          ? "failed"
          : (update.validation ?? state.validation)?.status ===
              "insufficient_evidence"
            ? "insufficient_evidence"
            : (update.retrieval ?? state.retrieval)?.status === "partial"
              ? "partial"
              : "ok",
        retryCount: 0,
        ...(providers && { providers }),
        ...(count !== undefined && { evidenceCount: count }),
        ...(failure && { errorCode: failure.code }),
      });
      return update;
    };
  }

  const graph = new StateGraph({
    state: SearchState,
    input: SearchInput,
    output: SearchOutput,
    context: contextSchema,
  })
    .addNode(
      "analyzeQuery",
      track("analyzeQuery", ({ query }) => ({
        classification: classifyQuery(query),
      })),
    )
    .addNode(
      "routeSources",
      track("routeSources", ({ classification }) => {
        if (!classification) return { failure: unexpected };
        return { providers: routeSources(classification) };
      }),
    )
    .addNode(
      "retrieveEvidence",
      track(
        "retrieveEvidence",
        async ({ classification, providers }, { signal }) => {
          if (!classification || !providers) return { failure: unexpected };
          try {
            const {
              status,
              errors,
              results,
              providers: attempted,
            } = await retrieve({ ...classification, providers }, signal);
            const retrieval = {
              status,
              errors,
              providers: attempted,
              resultCount: results.length,
            };
            if (status === "failed") {
              return {
                retrieval,
                failure: {
                  status: errors.every(({ code }) => code === "timeout")
                    ? 504
                    : 502,
                  code: "retrieval_failed",
                  message:
                    "The selected providers could not retrieve evidence.",
                },
              };
            }
            return { retrieval, results };
          } catch {
            return {
              failure: {
                status: 502,
                code: "retrieval_failed",
                message: "Evidence retrieval could not be completed.",
              },
            };
          }
        },
      ),
    )
    .addNode(
      "processEvidence",
      track("processEvidence", ({ results }) => {
        // Phase 4 already normalizes, deduplicates and ranks these results.
        const evidence = buildEvidence(results ?? []);
        return evidence.items.length
          ? { evidence, results: null }
          : { results: null, validation: noEvidenceResult() };
      }),
    )
    .addNode(
      "generateKnowledge",
      track(
        "generateKnowledge",
        async ({ classification, evidence }, { context, signal }) => {
          if (!classification || !evidence || !context)
            return { failure: unexpected };
          return {
            draft: context.expansion
              ? await request(
                  classification.query,
                  evidence,
                  context.client,
                  signal,
                  context.expansion,
                )
              : await request(
                  classification.query,
                  evidence,
                  context.client,
                  signal,
                ),
          };
        },
      ),
    )
    .addNode(
      "validateKnowledge",
      track("validateKnowledge", ({ draft, evidence }, { context }) => {
        if (!draft || !evidence) return { failure: unexpected };
        return {
          validation: context?.expansion
            ? validate(draft, evidence, true)
            : validate(draft, evidence),
          draft: null,
          evidence: null,
        };
      }),
    )
    .addNode(
      "finalizeResponse",
      track(
        "finalizeResponse",
        ({ failure, classification, retrieval, validation }) => {
          const cleared = {
            results: null,
            evidence: null,
            draft: null,
            validation: null,
          };
          if (failure || !classification || !retrieval || !validation) {
            const cause = failure ?? unexpected;
            return {
              ...cleared,
              failure: cause,
              response: failureResponse(cause, retrieval),
            };
          }
          return {
            ...cleared,
            response: {
              status: 200,
              body: { query: classification.query, ...validation, retrieval },
            },
          };
        },
      ),
    )
    .addEdge(START, "analyzeQuery")
    .addConditionalEdges("analyzeQuery", ({ failure }) =>
      failure ? "finalizeResponse" : "routeSources",
    )
    .addConditionalEdges("routeSources", ({ failure }) =>
      failure ? "finalizeResponse" : "retrieveEvidence",
    )
    .addConditionalEdges("retrieveEvidence", ({ failure }) =>
      failure ? "finalizeResponse" : "processEvidence",
    )
    .addConditionalEdges("processEvidence", ({ failure, evidence }) =>
      failure || !evidence ? "finalizeResponse" : "generateKnowledge",
    )
    .addConditionalEdges("generateKnowledge", ({ failure }) =>
      failure ? "finalizeResponse" : "validateKnowledge",
    )
    .addEdge("validateKnowledge", "finalizeResponse")
    .addEdge("finalizeResponse", END)
    .compile();

  return async function runSearch(
    query: string,
    signal?: AbortSignal,
    expansion?: RelatedRequest,
  ): Promise<SearchResponse> {
    const started = performance.now();
    try {
      // LangChain re-reads these flags inside graph iteration. Block the run
      // before any query or evidence reaches its payload callbacks.
      if (payloadDiagnostics.some((flag) => process.env[flag] === "true")) {
        throw new Error("Payload diagnostics are enabled.");
      }
      // Preflight server credentials before dispatching retrieval. The client is
      // request context; it is never placed in a graph state channel.
      const client = createClient();
      // Set the request-local tracing policy before LangChain configures callbacks.
      const result = await AsyncLocalStorageProviderSingleton.getInstance().run(
        { tracingEnabled: false },
        () =>
          graph.invoke(
            { query },
            {
              callbacks: [],
              context: { client, expansion },
              signal,
              recursionLimit: 10,
            },
          ),
      );
      return result.response ?? failureResponse(unexpected);
    } catch (error) {
      const failure = generationFailure(
        signal?.aborted ? new GenerationFailure("gemini_cancelled") : error,
      );
      log({
        stage: "workflow",
        durationMs: Math.round(performance.now() - started),
        status: "failed",
        retryCount: 0,
        errorCode: failure.code,
      });
      return failureResponse(failure);
    }
  };
}

export const runSearchWorkflow = createSearchWorkflow();
