import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import {
  concept,
  insufficient,
  javascript,
  reactExpansion,
  relationship,
  success,
} from "../../../tests/fixtures/exploration";
import { DashboardShell } from "./dashboard-shell";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function setup() {
  const user = userEvent.setup();
  render(<DashboardShell />);
  const search = screen.getByRole("searchbox", { name: "Search for a topic" });
  const graph = within(screen.getByRole("region", { name: "Knowledge graph" }));
  const details = within(
    screen.getByRole("region", { name: "Concept details" }),
  );
  const answer = within(
    screen.getByRole("region", { name: "Topic explanation" }),
  );
  return {
    user,
    search,
    graph,
    details,
    answer,
    async submit(topic: string) {
      await user.clear(search);
      await user.type(search, `${topic}{Enter}`);
    },
    async choose(name: string) {
      await user.click(graph.getByRole("button", { name }));
    },
  };
}

function mockJavaScript() {
  server.use(http.post("/api/search", () => HttpResponse.json(javascript)));
}

test("keeps an interactive example preview and validates invalid search input", async () => {
  const { user, search, graph, details, submit } = setup();
  await user.click(graph.getByText("Browse concepts"));
  expect(
    within(graph.getByRole("list", { name: "Graph concepts" })).getAllByRole(
      "button",
    ),
  ).toHaveLength(7);
  await user.click(graph.getByRole("button", { name: "Neural Networks" }));
  expect(
    details.getByRole("heading", { name: "Neural Networks" }),
  ).toBeVisible();
  expect(
    details.queryByRole("button", { name: "Expand concept" }),
  ).not.toBeInTheDocument();
  await submit("   ");
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Enter a topic or question",
  );
  expect(search).toHaveAttribute("aria-invalid", "true");
  expect(search).toHaveFocus();
  await user.type(search, "L");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("validates, loads and displays the initial API graph, root, explanation, and source links", async () => {
  const requestSeen = vi.fn();
  const release = Promise.withResolvers<void>();
  server.use(
    http.post("/api/search", async ({ request }) => {
      requestSeen(await request.json());
      await release.promise;
      return HttpResponse.json(javascript);
    }),
  );
  const { user, search, graph, details, answer, submit, choose } = setup();
  await submit(" JavaScript ");
  expect(search).toHaveValue("JavaScript");
  expect(screen.getByRole("button", { name: "Searching…" })).toBeDisabled();
  expect(
    answer.getByText("Retrieving sources and generating an explanation…"),
  ).toBeVisible();
  release.resolve();
  expect(
    await answer.findByRole("heading", { name: "JavaScript overview" }),
  ).toBeVisible();
  expect(requestSeen).toHaveBeenCalledExactlyOnceWith({ query: "JavaScript" });
  expect(
    answer.getByRole("link", { name: "Reference documentation" }),
  ).toHaveAttribute("href", javascript.knowledge.sources[0].url);
  expect(details.getByRole("heading", { name: "JavaScript" })).toBeVisible();
  expect(graph.getByText("2 concepts")).toBeVisible();
  await user.click(graph.getByText("Browse concepts"));
  await choose("React");
  expect(
    graph.getByRole("button", { name: "React", pressed: true }),
  ).toBeVisible();
  expect(details.getByText("A concept about React.")).toBeVisible();
  expect(
    details.getByRole("link", { name: "Reference documentation" }),
  ).toBeVisible();
  await user.click(details.getByRole("button", { name: "JavaScript" }));
  expect(details.getByRole("heading", { name: "JavaScript" })).toBeVisible();
});

test.each([
  [
    "insufficient evidence",
    () => HttpResponse.json(insufficient("JavaScript")),
    "No usable evidence was retrieved",
  ],
  [
    "server failure",
    () =>
      HttpResponse.json(
        { error: { code: "search_failed", message: "private" } },
        { status: 500 },
      ),
    "Search failed on the server",
  ],
  ["network failure", () => HttpResponse.error(), "Could not connect"],
  ["timeout", () => HttpResponse.json({}, { status: 504 }), "Search timed out"],
  [
    "invalid response",
    () => HttpResponse.json({ ...javascript, knowledge: null }),
    "Search returned an invalid response",
  ],
  [
    "unrecognized source reference",
    () =>
      HttpResponse.json({
        ...javascript,
        knowledge: { ...javascript.knowledge, sources: [] },
      }),
    "Search returned an invalid response",
  ],
])(
  "handles %s without rendering a fabricated graph",
  async (_name, reply, message) => {
    server.use(http.post("/api/search", reply));
    const { answer, graph, submit } = setup();
    await submit("JavaScript");
    expect(await answer.findByText(new RegExp(message))).toBeVisible();
    expect(graph.getByText("0 concepts")).toBeVisible();
    expect(screen.queryByText("private")).not.toBeInTheDocument();
  },
);

test("tracks only the requested node, deduplicates requests and merges stable additions without losing existing graph data", async () => {
  mockJavaScript();
  const release = Promise.withResolvers<void>();
  const requestSeen = vi.fn();
  server.use(
    http.post("/api/related", async ({ request }) => {
      requestSeen(await request.json());
      await release.promise;
      const original = javascript.knowledge.relationships[0];
      const duplicate = {
        ...reactExpansion.knowledge.relationships[0],
        id: `relationship-${"e".repeat(24)}`,
      };
      return HttpResponse.json({
        ...reactExpansion,
        knowledge: {
          ...reactExpansion.knowledge,
          concepts: [
            ...reactExpansion.knowledge.concepts,
            concept("React"),
            concept("Hooks"),
          ],
          relationships: [
            ...reactExpansion.knowledge.relationships,
            original,
            duplicate,
            relationship("Hooks", "Missing"),
            relationship("Hooks", "Hooks"),
          ],
        },
      });
    }),
  );
  const { user, graph, details, answer, submit, choose } = setup();
  await submit("JavaScript");
  await answer.findByRole("heading", { name: "JavaScript overview" });
  await user.click(graph.getByText("Browse concepts"));
  await choose("React");
  await user.dblClick(details.getByRole("button", { name: "Expand concept" }));
  expect(details.getByRole("button", { name: "Expanding…" })).toBeDisabled();
  expect(graph.getByRole("button", { name: "React" })).toHaveAttribute(
    "aria-busy",
    "true",
  );
  await choose("JavaScript");
  expect(details.getByRole("button", { name: "Expand concept" })).toBeEnabled();
  expect(graph.getByRole("button", { name: "JavaScript" })).not.toHaveAttribute(
    "aria-busy",
  );
  await waitFor(() =>
    expect(requestSeen).toHaveBeenCalledExactlyOnceWith({
      topic: "JavaScript",
      concept: {
        id: concept("React").id,
        name: "React",
        description: concept("React").description,
      },
      neighbors: [{ id: concept("JavaScript").id, name: "JavaScript" }],
      existingConceptIds: [concept("React").id, concept("JavaScript").id],
    }),
  );
  release.resolve();
  expect(await graph.findByRole("button", { name: "Hooks" })).toBeVisible();
  expect(graph.getByText("4 concepts")).toBeVisible();
  expect(graph.getByText("3 relationships")).toBeVisible();
  expect(details.getByRole("heading", { name: "JavaScript" })).toBeVisible();
  await choose("React");
  expect(details.getByText("Concept expanded.")).toBeVisible();
  expect(details.getByText("Details about React details.")).toBeVisible();
  expect(
    answer.getByRole("heading", { name: "JavaScript overview" }),
  ).toBeVisible();
});

test("keeps the original graph on failure, then supports retry and an empty successful expansion", async () => {
  mockJavaScript();
  let attempts = 0;
  server.use(
    http.post("/api/related", () => {
      attempts += 1;
      return attempts === 1
        ? HttpResponse.json({}, { status: 504 })
        : HttpResponse.json({
            ...reactExpansion,
            knowledge: {
              ...reactExpansion.knowledge,
              concepts: [],
              relationships: [],
            },
          });
    }),
  );
  const { user, graph, details, answer, submit, choose } = setup();
  await submit("JavaScript");
  await answer.findByRole("heading", { name: "JavaScript overview" });
  await user.click(graph.getByText("Browse concepts"));
  await choose("React");
  await user.click(details.getByRole("button", { name: "Expand concept" }));
  expect(await details.findByRole("alert")).toHaveTextContent(
    "Expansion timed out",
  );
  expect(graph.getByText("2 concepts")).toBeVisible();
  await user.click(details.getByRole("button", { name: "Retry expansion" }));
  expect(
    await details.findByText("No additional concepts found."),
  ).toBeVisible();
  expect(details.queryByText("Concept expanded.")).not.toBeInTheDocument();
  expect(graph.getByText("2 concepts")).toBeVisible();
  expect(attempts).toBe(2);
});

test("replaces the current exploration and ignores stale search and expansion responses", async () => {
  const slowSearch = Promise.withResolvers<void>();
  const slowExpansion = Promise.withResolvers<void>();
  const requests = vi.fn();
  server.use(
    http.post("/api/search", async ({ request }) => {
      const { query } = (await request.json()) as { query: string };
      requests(query);
      if (query === "Slow") await slowSearch.promise;
      return HttpResponse.json(
        query === "JavaScript"
          ? javascript
          : success(query, `${query} overview`, [query], []),
      );
    }),
    http.post("/api/related", async () => {
      requests("expand");
      await slowExpansion.promise;
      return HttpResponse.json(reactExpansion);
    }),
  );
  const { user, graph, details, answer, submit, choose } = setup();
  await submit("Slow");
  await waitFor(() => expect(requests).toHaveBeenCalledWith("Slow"));
  await submit("JavaScript");
  await answer.findByRole("heading", { name: "JavaScript overview" });
  slowSearch.resolve();
  await user.click(graph.getByText("Browse concepts"));
  await choose("React");
  await user.click(details.getByRole("button", { name: "Expand concept" }));
  await waitFor(() => expect(requests).toHaveBeenCalledWith("expand"));
  await submit("Python");
  await answer.findByRole("heading", { name: "Python overview" });
  slowExpansion.resolve();
  expect(graph.getByRole("button", { name: "Python" })).toBeVisible();
  expect(
    graph.queryByRole("button", { name: "React" }),
  ).not.toBeInTheDocument();
  expect(
    graph.queryByRole("button", { name: "Hooks" }),
  ).not.toBeInTheDocument();
  expect(
    answer.queryByRole("heading", { name: "Slow overview" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "New exploration" }));
  expect(screen.getByRole("searchbox")).toHaveFocus();
  expect(screen.getByRole("searchbox")).toHaveValue("");
  expect(graph.getByText("Example", { exact: true })).toBeVisible();
});
