import {
  matchDocumentation,
  type DocumentationSource,
} from "./official-sources";
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

export interface QueryAnalysis {
  query: string;
  providers: readonly ProviderId[];
  documentationSources: readonly DocumentationSource[];
  repository?: { owner: string; name: string };
  repositoryQuery?: string;
}

const repositoryPattern =
  /^(?:https:\/\/github\.com\/)?([a-z0-9][a-z0-9-]{0,38})\/([a-z0-9_.-]{1,100})\/?$/i;
const projectTerms =
  /\b(?:repositories|repository|repos?|libraries|library|packages?|frameworks?|alternatives|open.source)\b/i;
const discoveryTerms =
  /\b(?:best|popular|compare|find|list|top|alternatives|open.source)\b/i;
const softwareTerms =
  /\b(?:npm|pip|sdk|programming|code|software|developer|frameworks?|github)\b/i;
const documentationTerms = /\b(?:docs|documentation|official reference)\b/i;

export function analyzeQuery(query: string): QueryAnalysis {
  const trimmed = query.trim();
  const [, owner, name] = repositoryPattern.exec(trimmed) ?? [];
  const repository =
    owner && name && name !== "." && name !== ".."
      ? { owner, name }
      : undefined;
  const candidates = matchDocumentation(trimmed);
  const technology = candidates.length > 0;
  const discoveringProjects =
    projectTerms.test(trimmed) &&
    (discoveryTerms.test(trimmed) ||
      /\b(?:github|repos?|repositories|repository)\b/i.test(trimmed)) &&
    (technology || softwareTerms.test(trimmed));
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
  const providers: ProviderId[] = ["tavily"];

  if (documentationSources.length) providers.unshift("official-docs");
  else if (
    !repository &&
    !repositoryQuery &&
    !technology &&
    !softwareTerms.test(trimmed)
  )
    providers.unshift("wikipedia");
  if (repository || repositoryQuery) providers.push("github");

  return {
    query: trimmed,
    providers,
    documentationSources,
    repository,
    repositoryQuery,
  };
}
