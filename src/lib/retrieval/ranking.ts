import { queryTerms } from "./query-analyzer";
import type { RetrievalResult, SourceMetadata } from "./types";

const reliability: Record<SourceMetadata["type"], number> = {
  "official-documentation": 1,
  encyclopedia: 0.85,
  repository: 0.72,
  web: 0.55,
};

export function canonicalUrlKey(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.pathname = url.pathname.replace(/\/$/, "") || "/";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:utm_.+|gclid|fbclid|msclkid)$/i.test(key))
      url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.href;
}

function deduplicate(results: readonly RetrievalResult[]): RetrievalResult[] {
  const byUrl = new Map<string, RetrievalResult>();
  for (const candidate of results) {
    const key = canonicalUrlKey(candidate.source.url);
    const stored = byUrl.get(key);
    const preference =
      stored &&
      reliability[candidate.source.type] - reliability[stored.source.type];
    if (
      !stored ||
      (preference ?? 0) > 0 ||
      (preference === 0 &&
        candidate.content.text.length > stored.content.text.length)
    ) {
      byUrl.set(key, candidate);
    }
  }
  return [...byUrl.values()];
}

export function rankResults(
  query: string,
  results: readonly RetrievalResult[],
): RetrievalResult[] {
  const terms = queryTerms(query);
  const denominator = Math.max(1, terms.length);
  const coverage = (text: string) => {
    const tokens = new Set(queryTerms(text));
    return terms.filter((term) => tokens.has(term)).length / denominator;
  };

  return deduplicate(results)
    .map((result) => {
      const relevance =
        0.65 * coverage(result.title) + 0.35 * coverage(result.content.text);
      const usefulness = Math.min(result.content.text.length / 400, 1);
      const score =
        0.68 * relevance +
        0.22 * reliability[result.source.type] +
        0.1 * usefulness;
      return { ...result, relevanceScore: Math.round(score * 10_000) / 10_000 };
    })
    .sort(
      (left, right) =>
        right.relevanceScore - left.relevanceScore ||
        left.id.localeCompare(right.id, "en"),
    );
}
