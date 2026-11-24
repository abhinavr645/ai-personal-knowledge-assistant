import { z } from "zod";
import {
  documentationSourceSchema,
  matchDocumentation,
} from "./official-sources";
import { providerIdSchema, retrievalRequestSchema } from "./schemas";
import type { ProviderId } from "./types";

const queryStopWords = new Set(
  "a an and are as at be by can do does for from how i in is it of on or that the this to use what when where which who with".split(
    " ",
  ),
);
const repositoryStopWords = new Set(
  "best code compare find github libraries library list open popular project projects repo repositories repository search source top tools packages frameworks alternatives".split(
    " ",
  ),
);

export function queryTerms(text: string): string[] {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(words.filter((word) => !queryStopWords.has(word)))];
}

export const queryClassificationSchema = z.object({
  query: retrievalRequestSchema.shape.query,
  category: z.enum([
    "general",
    "technical",
    "software_discovery",
    "direct_repository",
  ]),
  documentationSources: z.array(documentationSourceSchema).readonly(),
  repository: z.object({ owner: z.string(), name: z.string() }).optional(),
  repositoryQuery: z.string().optional(),
});

export const selectedProvidersSchema = z
  .array(providerIdSchema)
  .min(1)
  .max(3)
  .refine((providers) => new Set(providers).size === providers.length);
type QueryClassification = z.infer<typeof queryClassificationSchema>;
export type QueryAnalysis = QueryClassification & {
  providers: readonly ProviderId[];
};

const repositoryPattern =
  /^(?:https:\/\/github\.com\/)?([a-z0-9][a-z0-9-]{0,38})\/([a-z0-9_.-]{1,100})\/?$/i;
const projectTerms =
  /\b(?:repositories|repository|repos?|libraries|library|packages?|frameworks?|alternatives|open.source)\b/i;
const discoveryTerms =
  /\b(?:best|popular|compare|find|list|top|alternatives|open.source)\b/i;
const softwareTerms =
  /\b(?:npm|pip|sdk|programming|code|software|developer|frameworks?|github)\b/i;
const documentationTerms = /\b(?:docs|documentation|official reference)\b/i;

export function classifyQuery(query: string): QueryClassification {
  const trimmed = query.trim();
  const [, owner, name] = repositoryPattern.exec(trimmed) ?? [];
  const repository =
    owner && name && name !== "." && name !== ".."
      ? { owner, name }
      : undefined;
  const candidates = matchDocumentation(trimmed);
  const technology = candidates.length > 0;
  const technical = technology || softwareTerms.test(trimmed);
  const discoveringProjects =
    projectTerms.test(trimmed) &&
    (discoveryTerms.test(trimmed) ||
      /\b(?:github|repos?|repositories|repository)\b/i.test(trimmed)) &&
    technical;
  const repositoryQuery =
    discoveringProjects && !repository
      ? queryTerms(trimmed)
          .filter((word) => !repositoryStopWords.has(word))
          .slice(0, 12)
          .join(" ") || undefined
      : undefined;
  const documentationSources =
    (!discoveringProjects && !repository) || documentationTerms.test(trimmed)
      ? candidates
      : [];
  const category = repository
    ? "direct_repository"
    : repositoryQuery
      ? "software_discovery"
      : technical
        ? "technical"
        : "general";
  return {
    query: trimmed,
    category,
    documentationSources,
    repository,
    repositoryQuery,
  };
}

export function routeSources(analysis: QueryClassification): ProviderId[] {
  const providers: ProviderId[] = ["tavily"];

  if (analysis.documentationSources.length) providers.unshift("official-docs");
  else if (analysis.category === "general") providers.unshift("wikipedia");
  if (
    analysis.category === "direct_repository" ||
    analysis.category === "software_discovery"
  )
    providers.push("github");
  return providers;
}

export function analyzeQuery(query: string): QueryAnalysis {
  const analysis = classifyQuery(query);
  return { ...analysis, providers: routeSources(analysis) };
}
