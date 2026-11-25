import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
  vi,
} from "vitest";
import {
  createExplorationStorage,
  historyKeyPrefix,
} from "@/lib/exploration/history-storage";
import {
  concept,
  hooksExpansion,
  insufficient,
  javascript,
  reactExpansion,
  relationship,
  success,
} from "../../../tests/fixtures/exploration";
import { DashboardShell } from "./dashboard-shell";

const server = setupServer();
const storage = createExplorationStorage();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(() => window.localStorage.clear());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function setup() {
  const user = userEvent.setup();
  const { unmount } = render(<DashboardShell />);
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
    unmount,
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
  expect(storage.list().entries).toEqual([]);
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
  await waitFor(() =>
    expect(storage.list().entries[0]).toMatchObject({
      title: "JavaScript",
      conceptCount: 2,
    }),
  );
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
    "service capacity",
    () =>
      HttpResponse.json(
        { error: { code: "service_busy", message: "private" } },
        { status: 429 },
      ),
    "The service is busy",
  ],
  [
    "shared rate limit",
    () =>
      HttpResponse.json(
        { error: { code: "rate_limited", message: "private" } },
        { status: 429, headers: { "Retry-After": "4" } },
      ),
    "Try again in 4 seconds",
  ],
  [
    "shared limiter outage",
    () =>
      HttpResponse.json(
        { error: { code: "rate_limit_unavailable", message: "private" } },
        { status: 503 },
      ),
    "The service is temporarily unavailable",
  ],
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

test("merges out-of-order expansions for different concepts and keeps focus through each request", async () => {
  mockJavaScript();
  const react = Promise.withResolvers<void>();
  const root = Promise.withResolvers<void>();
  const received = vi.fn();
  const rootExpansion = {
    ...success(
      "JavaScript",
      "JavaScript details",
      ["Promises"],
      [["JavaScript", "Promises"]],
    ),
    conceptId: concept("JavaScript").id,
  };
  server.use(
    http.post("/api/related", async ({ request }) => {
      const {
        concept: { name },
      } = (await request.json()) as { concept: { name: string } };
      received(name);
      await (name === "React" ? react.promise : root.promise);
      return HttpResponse.json(
        name === "React" ? reactExpansion : rootExpansion,
      );
    }),
  );
  const { user, graph, details, answer, submit, choose } = setup();
  await submit("JavaScript");
  await answer.findByRole("heading", { name: "JavaScript overview" });
  await user.click(graph.getByText("Browse concepts"));
  await choose("React");
  await user.click(details.getByRole("button", { name: "Expand concept" }));
  expect(details.getByRole("button", { name: "Expanding…" })).toHaveFocus();
  await choose("JavaScript");
  await user.click(details.getByRole("button", { name: "Expand concept" }));
  await waitFor(() =>
    expect(received.mock.calls).toEqual([["React"], ["JavaScript"]]),
  );
  root.resolve();
  await graph.findByRole("button", { name: "Promises" });
  expect(
    details.getByRole("button", { name: "Concept expanded." }),
  ).toHaveFocus();
  expect(graph.getByRole("button", { name: "React" })).toHaveAttribute(
    "aria-busy",
    "true",
  );
  react.resolve();
  await graph.findByRole("button", { name: "Hooks" });
  expect(graph.getByText("5 concepts")).toBeVisible();
  expect(graph.getByText("4 relationships")).toBeVisible();
  await waitFor(() => {
    const [entry] = storage.list().entries;
    const content = storage.load(entry.id).content;
    expect(content.expansions.map(({ nodeId }) => nodeId)).toEqual([
      concept("JavaScript").id,
      concept("React").id,
    ]);
  });
});

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
  expect(details.getByRole("button", { name: "Expanding…" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
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
  await waitFor(() => {
    const [saved] = storage.list().entries;
    const content = storage.load(saved.id).content;
    expect(content.expansions).toEqual([
      expect.objectContaining({
        nodeId: concept("React").id,
        status: "expanded",
      }),
    ]);
    expect(content.graph.nodes).toHaveLength(4);
  });
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
  await waitFor(() =>
    expect(storage.list().entries.map(({ title }) => title)).toEqual([
      "Python",
      "JavaScript",
    ]),
  );
  const savedJavaScript = storage
    .list()
    .entries.find(({ title }) => title === "JavaScript");
  expect(storage.load(savedJavaScript!.id).content.expansions).toEqual([]);
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

test("restores validated results after remount and keeps saved explorations isolated while switching", async () => {
  const searches = vi.fn(async ({ request }: { request: Request }) => {
    const { query } = (await request.json()) as { query: string };
    return HttpResponse.json(
      query === "JavaScript"
        ? javascript
        : success(query, "Python overview", ["Python"], []),
    );
  });
  const expand = vi.fn(async ({ request }: { request: Request }) => {
    const { concept, topic } = await request.json();
    expect(topic).toBe("JavaScript");
    return HttpResponse.json(
      concept.name === "React" ? reactExpansion : hooksExpansion,
    );
  });
  server.use(
    http.post("/api/search", searches),
    http.post("/api/related", expand),
  );
  const first = setup();
  expect(await screen.findByText("No saved explorations yet.")).toBeVisible();
  await first.submit("JavaScript");
  await first.answer.findByRole("heading", { name: "JavaScript overview" });
  await first.user.click(first.graph.getByText("Browse concepts"));
  await first.choose("React");
  await first.user.click(
    first.details.getByRole("button", { name: "Expand concept" }),
  );
  await first.graph.findByRole("button", { name: "Hooks" });
  await waitFor(() => {
    const [entry] = storage.list().entries;
    expect(entry.conceptCount).toBe(4);
    expect(storage.load(entry.id).content.selectedId).toBe(concept("React").id);
  });
  await first.submit("Python");
  await first.answer.findByRole("heading", { name: "Python overview" });
  await waitFor(() => expect(storage.list().entries).toHaveLength(2));
  first.unmount();

  localStorage.setItem(historyKeyPrefix + crypto.randomUUID(), "{");
  const restored = setup();
  expect(
    await screen.findByText("Some saved explorations could not be opened."),
  ).toBeVisible();
  const entries = within(
    screen.getByRole("list", { name: "Saved explorations" }),
  );
  await restored.user.click(
    entries.getByRole("button", { name: "JavaScript" }),
  );
  expect(restored.search).toHaveValue("JavaScript");
  expect(
    restored.answer.getByRole("heading", { name: "JavaScript overview" }),
  ).toBeVisible();
  expect(
    restored.answer.getByRole("link", { name: "Reference documentation" }),
  ).toHaveAttribute("href", javascript.knowledge.sources[0].url);
  expect(
    restored.details.getByRole("heading", { name: "React" }),
  ).toBeVisible();
  expect(
    restored.details.getByText("Details about React details."),
  ).toBeVisible();
  expect(restored.details.getByText("Concept expanded.")).toBeVisible();
  expect(restored.graph.getByText("3 relationships")).toBeVisible();
  expect(searches).toHaveBeenCalledTimes(2);
  expect(expand).toHaveBeenCalledTimes(1);

  await restored.user.click(restored.graph.getByText("Browse concepts"));
  await restored.choose("Hooks");
  await restored.user.click(
    restored.details.getByRole("button", { name: "Expand concept" }),
  );
  expect(
    await restored.graph.findByRole("button", { name: "useState" }),
  ).toBeVisible();
  await restored.user.click(entries.getByRole("button", { name: "Python" }));
  expect(
    restored.answer.getByRole("heading", { name: "Python overview" }),
  ).toBeVisible();
  expect(restored.graph.getByRole("button", { name: "Python" })).toBeVisible();
  expect(
    restored.graph.queryByRole("button", { name: "React" }),
  ).not.toBeInTheDocument();
  await restored.user.click(
    entries.getByRole("button", { name: "JavaScript" }),
  );
  expect(
    restored.graph.getByRole("button", { name: "useState" }),
  ).toBeVisible();
  expect(
    entries.getByRole("button", { name: "JavaScript", current: true }),
  ).toBeVisible();
  expect(searches).toHaveBeenCalledTimes(2);
  expect(expand).toHaveBeenCalledTimes(2);
});

test("renames and deletes saved records across remounts after confirmation", async () => {
  mockJavaScript();
  const first = setup();
  await first.submit("JavaScript");
  await first.user.click(
    await screen.findByRole("button", { name: "Actions for JavaScript" }),
  );
  await first.user.click(
    await screen.findByRole("menuitem", { name: "Rename" }),
  );
  const rename = within(
    await screen.findByRole("dialog", { name: "Rename exploration" }),
  );
  const title = rename.getByRole("textbox", { name: "Exploration title" });
  await first.user.clear(title);
  expect(rename.getByRole("button", { name: "Save title" })).toBeDisabled();
  await first.user.type(title, "Front-end guide");
  await first.user.click(rename.getByRole("button", { name: "Save title" }));
  expect(storage.list().entries[0].title).toBe("Front-end guide");
  first.unmount();

  const second = setup();
  const entries = within(
    await screen.findByRole("list", { name: "Saved explorations" }),
  );
  await second.user.click(
    entries.getByRole("button", { name: "Front-end guide" }),
  );
  expect(second.search).toHaveValue("JavaScript");
  await second.user.click(
    entries.getByRole("button", { name: "Actions for Front-end guide" }),
  );
  await second.user.click(
    await screen.findByRole("menuitem", { name: "Delete" }),
  );
  const deletion = within(
    await screen.findByRole("dialog", { name: "Delete exploration?" }),
  );
  expect(storage.list().entries).toHaveLength(1);
  await second.user.click(deletion.getByRole("button", { name: "Cancel" }));
  expect(
    entries.getByRole("button", { name: "Front-end guide" }),
  ).toBeVisible();
  await second.user.click(
    entries.getByRole("button", { name: "Actions for Front-end guide" }),
  );
  await second.user.click(
    await screen.findByRole("menuitem", { name: "Delete" }),
  );
  await second.user.click(
    within(
      await screen.findByRole("dialog", { name: "Delete exploration?" }),
    ).getByRole("button", { name: "Delete exploration" }),
  );
  expect(storage.list().entries).toEqual([]);
  expect(await screen.findByText("No saved explorations yet.")).toBeVisible();
  expect(second.graph.getByText("Example", { exact: true })).toBeVisible();
});

test("keeps the last good snapshot when automatic saving fails and can retry without repeating expansion", async () => {
  mockJavaScript();
  const expand = vi.fn(() => HttpResponse.json(reactExpansion));
  server.use(http.post("/api/related", expand));
  const { user, graph, details, submit, choose } = setup();
  await submit("JavaScript");
  await screen.findByRole("list", { name: "Saved explorations" });
  await user.click(graph.getByText("Browse concepts"));
  await choose("React");
  const [entry] = storage.list().entries;
  await waitFor(() =>
    expect(storage.load(entry.id).content.selectedId).toBe(concept("React").id),
  );
  const previous = storage.load(entry.id);
  const write = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new DOMException("Private browser details", "QuotaExceededError");
    });
  try {
    await user.click(details.getByRole("button", { name: "Expand concept" }));
    expect(await graph.findByRole("button", { name: "Hooks" })).toBeVisible();
    expect(await screen.findByText(/Browser storage is full/)).toBeVisible();
    expect(storage.load(entry.id)).toEqual(previous);
  } finally {
    write.mockRestore();
  }
  await user.click(screen.getByRole("button", { name: "Retry save" }));
  expect(storage.load(entry.id).content.graph.nodes).toHaveLength(4);
  expect(expand).toHaveBeenCalledOnce();
});
