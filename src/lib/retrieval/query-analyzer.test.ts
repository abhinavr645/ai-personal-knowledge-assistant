import { expect, test } from "vitest";
import { analyzeQuery } from "./query-analyzer";

test.each(["What is machine learning?", "What is a neural network?"])(
  "routes %s to general sources",
  (query) => {
    expect(analyzeQuery(query).providers).toEqual(["wikipedia", "tavily"]);
  },
);

test("routes programming API queries to the matching documentation and the web", () => {
  const react = analyzeQuery("  React useState hook  ");
  expect(react.query).toBe("React useState hook");
  expect(react.providers).toEqual(["official-docs", "tavily"]);
  expect(react.documentationSources.map(({ host }) => host)).toEqual([
    "react.dev",
  ]);
  expect(
    analyzeQuery(
      "Next.js application routing with TypeScript",
    ).documentationSources.map(({ host }) => host),
  ).toEqual(["nextjs.org", "www.typescriptlang.org"]);
  expect(
    analyzeQuery("How does the Python standard library work?").providers,
  ).not.toContain("github");
});

test("routes project discovery to repository search and direct identifiers to repository metadata", () => {
  const comparison = analyzeQuery(
    "Compare popular JavaScript charting libraries",
  );
  expect(comparison.providers).toEqual(["tavily", "github"]);
  expect(comparison.repositoryQuery).toBe("javascript charting");
  expect(comparison.documentationSources).toEqual([]);

  expect(analyzeQuery("https://github.com/vercel/next.js")).toMatchObject({
    providers: ["tavily", "github"],
    repository: { owner: "vercel", name: "next.js" },
  });
});

test("keeps unrelated comparisons and standalone platform questions out of GitHub search", () => {
  expect(
    analyzeQuery("Compare popular libraries in London").providers,
  ).not.toContain("github");
  expect(analyzeQuery("What is GitHub?").providers).not.toContain("github");
});
