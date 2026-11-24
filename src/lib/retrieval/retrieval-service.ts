import "server-only";

import { providers as defaultProviders } from "./provider-registry";
import { analyzeQuery, type QueryAnalysis } from "./query-analyzer";
import { rankResults } from "./ranking";
import { retrievalRequestSchema } from "./schemas";
import { ProviderFailure } from "./server-http";
import type {
  ProviderId,
  RetrievalError,
  RetrievalProvider,
  RetrievalResponse,
  RetrievalResult,
} from "./types";

const resultsPerProvider = 5;
const maxResults = 12;

const errorMessages: Record<RetrievalError["code"], string> = {
  unavailable: "The provider is unavailable or has no valid credentials.",
  rate_limited: "The provider has reached its request or usage limit.",
  timeout: "The provider did not respond in time.",
  network: "The provider could not be reached.",
  upstream_error: "The provider could not complete the request.",
  malformed_response: "The provider returned invalid evidence.",
  cancelled: "The retrieval request was cancelled.",
};

function providerError(
  provider: ProviderId,
  failure: ProviderFailure,
): RetrievalError {
  const { code, upstreamStatus } = failure;
  return {
    provider,
    code,
    message: errorMessages[code],
    ...(upstreamStatus && upstreamStatus >= 400 && upstreamStatus <= 599
      ? { upstreamStatus }
      : {}),
  };
}

interface ProviderRun {
  results: RetrievalResult[];
  error?: RetrievalError;
  completed: boolean;
}

async function runProvider(
  provider: RetrievalProvider,
  analysis: QueryAnalysis,
  retrievedAt: string,
  requestSignal?: AbortSignal,
): Promise<ProviderRun> {
  const deadline = AbortSignal.timeout(provider.timeoutMs);
  const signal = requestSignal
    ? AbortSignal.any([deadline, requestSignal])
    : deadline;
  const aborted = () =>
    new ProviderFailure(requestSignal?.aborted ? "cancelled" : "timeout");
  let onAbort: (() => void) | undefined;

  try {
    if (signal.aborted) throw aborted();
    const stop = new Promise<never>((_, reject) => {
      onAbort = () => reject(aborted());
      signal.addEventListener("abort", onAbort, { once: true });
    });
    const { results, malformed } = await Promise.race([
      provider.retrieve({
        analysis,
        retrievedAt,
        limit: resultsPerProvider,
        signal,
      }),
      stop,
    ]);
    return {
      results: results.slice(0, resultsPerProvider),
      completed: !malformed || results.length > 0,
      error: malformed
        ? providerError(provider.id, new ProviderFailure("malformed_response"))
        : undefined,
    };
  } catch (error) {
    const failure = signal.aborted
      ? aborted()
      : error instanceof ProviderFailure
        ? error
        : new ProviderFailure("upstream_error");
    return {
      results: [],
      completed: false,
      error: providerError(provider.id, failure),
    };
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

export function createRetrievalService(
  registry: Readonly<Record<ProviderId, RetrievalProvider>> = defaultProviders,
) {
  return async function retrieve(
    input: unknown,
    signal?: AbortSignal,
  ): Promise<RetrievalResponse> {
    const { query } = retrievalRequestSchema.parse({ query: input });
    const analysis = analyzeQuery(query);
    const retrievedAt = new Date().toISOString();

    // The router selects at most three providers, each with one bounded request.
    const runs = await Promise.all(
      analysis.providers.map((id) =>
        runProvider(registry[id], analysis, retrievedAt, signal),
      ),
    );
    const errors = runs.flatMap(({ error }) => (error ? [error] : []));
    const results = rankResults(
      query,
      runs.flatMap((run) => run.results),
    ).slice(0, maxResults);

    return {
      query,
      status:
        errors.length === 0
          ? "ok"
          : runs.some(({ completed }) => completed)
            ? "partial"
            : "failed",
      providers: [...analysis.providers],
      results,
      errors,
    };
  };
}

export const retrieve = createRetrievalService();
