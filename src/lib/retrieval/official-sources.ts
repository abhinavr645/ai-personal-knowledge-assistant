import { z } from "zod";
import { httpUrlSchema } from "./schemas";

const documentationSources = [
  {
    name: "React documentation",
    url: "https://react.dev/reference/react",
    host: "react.dev",
    paths: /^\/(?:learn|reference)(?:\/|$)/,
    topics:
      /\b(?:react(?:\.js|js)?|jsx|useState|useEffect|useRef|useMemo|useContext|useReducer)\b/i,
  },
  {
    name: "Next.js documentation",
    url: "https://nextjs.org/docs",
    host: "nextjs.org",
    paths: /^\/docs(?:\/|$)/,
    topics: /\b(?:next\.?js|next js|app router)\b/i,
  },
  {
    name: "TypeScript documentation",
    url: "https://www.typescriptlang.org/docs/",
    host: "www.typescriptlang.org",
    paths: /^\/(?:docs|tsconfig)(?:\/|$)/,
    topics: /\b(?:typescript|tsconfig)\b/i,
  },
  {
    name: "MDN Web Docs",
    url: "https://developer.mozilla.org/en-US/docs/Web",
    host: "developer.mozilla.org",
    paths: /^\/[\w-]+\/docs(?:\/|$)/,
    topics: /\b(?:mdn|javascript|ecmascript|css|html|web api|dom api)\b/i,
  },
  {
    name: "Python documentation",
    url: "https://docs.python.org/3/",
    host: "docs.python.org",
    paths: /^\/(?:[\w-]+\/)?3(?:\.\d+)?(?:\/|$)/,
    topics: /\b(?:python|cpython)\b/i,
  },
  {
    name: "Node.js documentation",
    url: "https://nodejs.org/api/",
    host: "nodejs.org",
    paths: /^\/(?:api|docs\/latest[a-z0-9.-]*\/api)(?:\/|$)/,
    topics: /\b(?:node\.?js|node js|node:[\w-]+)\b/i,
  },
] as const;

export const documentationSourceSchema = z.object({
  name: z.string(),
  url: z.url(),
  host: z.string(),
});

export type DocumentationSource = z.infer<typeof documentationSourceSchema>;

export function matchDocumentation(
  query: string,
): readonly DocumentationSource[] {
  return documentationSources
    .filter((source) => source.topics.test(query))
    .map(({ name, url, host }) => ({ name, url, host }));
}

export function documentationForUrl(
  value: string,
  sources: readonly DocumentationSource[],
) {
  const parsed = httpUrlSchema.safeParse(value);
  if (!parsed.success) return;
  const url = new URL(parsed.data);
  if (/%(?:00|25|2f|5c)/i.test(url.pathname)) return;
  return documentationSources.find(
    (source) =>
      url.protocol === "https:" &&
      url.host === source.host &&
      sources.some(({ host }) => host === source.host) &&
      source.paths.test(url.pathname),
  );
}
