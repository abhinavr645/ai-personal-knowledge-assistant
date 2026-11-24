# AI Personal Knowledge Assistant

The Dynamic Knowledge Graph Explorer will help users search for a topic, read an
AI-generated explanation, and explore related concepts in an interactive graph.
Users will be able to follow labeled relationships, expand concepts recursively,
and save and restore explorations in their browser.

## Stack

- Next.js 16 App Router, React 19, strict TypeScript, and Tailwind CSS 4
- shadcn/ui with Base UI and the Nova preset, plus Lucide React icons
- Cytoscape.js for rendering the graph, with React state as its source of truth
- LangGraph.js and LangChain Core for orchestration, the Google Gemini SDK for
  generation, external retrieval providers for sources, and Zod for validation
- Browser `localStorage` for initial persistence
- Vitest, jsdom, React Testing Library, jest-dom, MSW, Playwright Test, and
  axe-core for automated checks, plus Playwright MCP for interactive inspection
- ESLint and Prettier for code quality, Git and GitHub for version control, and
  Vercel for eventual deployment

## Getting started

Use [Node.js 26 LTS](https://github.com/nodejs/Release#release-schedule),
pnpm 12.23.0 (pinned in `package.json`), and Git.

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm dev
```

The dashboard is available at [localhost:3000](http://localhost:3000).
On Linux CI, use `pnpm exec playwright install --with-deps chromium` when
Chromium's system dependencies also need to be installed.

## Checks and scripts

| Command             | Purpose                                                        |
| ------------------- | -------------------------------------------------------------- |
| `pnpm peers check`  | Check the resolved dependency peer ranges.                     |
| `pnpm typecheck`    | Generate Next.js route types and run strict TypeScript checks. |
| `pnpm lint`         | Apply the Next.js ESLint rules.                                |
| `pnpm format`       | Format supported project files with Prettier.                  |
| `pnpm format:check` | Check formatting.                                              |
| `pnpm test`         | Run Vitest unit and component tests once.                      |
| `pnpm test:watch`   | Watch for changes with Vitest.                                 |
| `pnpm test:e2e`     | Test the dashboard in Chromium.                                |
| `pnpm build`        | Create a production build.                                     |
| `pnpm start`        | Serve the production build on port 3000.                       |

Playwright Test starts the local development server when needed and retains a
screenshot and trace on failure. The HTML report is written to `playwright-report/`.
Playwright MCP provides a separate browser for interactive inspection.

## Environment variables

Use `.env.example` as the template for a local `.env.local` file. The dashboard
demo runs without credentials.

| Variable            | Use                                                                   |
| ------------------- | --------------------------------------------------------------------- |
| `GEMINI_API_KEY`    | Required on the server for `POST /api/search`.                        |
| `GEMINI_MODEL`      | Optional Gemini model override. Defaults to `gemini-3.8-flash`.       |
| `TAVILY_API_KEY`    | Required for Tavily web search and domain-restricted official docs.   |
| `WIKIPEDIA_CONTACT` | Optional public operator email or project URL sent in the User-Agent. |

Git ignores `.env.local`. Keep keys in server-side code and omit the
`NEXT_PUBLIC_` prefix for credentials.

## Retrieval API

The server-side retrieval engine can be tested independently of the dashboard.
Send a JSON request with a query of 1 to 300 characters to the local server.

```http
POST /api/retrieve
Content-Type: application/json

{"query":"What is machine learning?"}
```

The response contains the normalized query, overall status, selected providers,
ranked results, and provider errors. Each result carries a stable URL-based ID,
source metadata, text evidence, and a retrieval timestamp.

- General knowledge queries use Wikipedia and Tavily. Recognized technology
  questions use the relevant official documentation registry and Tavily.
- Software project discovery also uses GitHub repository search. A direct
  GitHub repository identifier uses the repository metadata endpoint.
- Official documentation search restricts Tavily to the registry's domains
  and checks the returned HTTPS host and documentation path. The registry
  covers React, Next.js, TypeScript, MDN, Python, and Node.js.
- Each selected provider runs one timed request concurrently, with at most three
  requests per retrieval. The service considers up to five results per provider
  and returns up to twelve. A missing key disables both Tavily-backed providers.

Duplicate detection ignores URL fragments, trailing slashes, tracking
parameters, and query parameter order. It retains the winning provider's URL
and metadata, preferring the stronger source type and then the longer snippet.
Distinct URLs can remain even when their titles match. Ranking uses a 0–1
heuristic score based on query-term coverage (68%, with title matches weighted
more heavily), source type (22%), and bounded evidence length (10%).

HTTP `200` includes successful empty searches and partial results. Invalid JSON
or queries return `400`, oversized bodies return `413`, and other content types
return `415`. Complete failures return `502` for upstream failures, `503` for
unavailable or rate-limited retrieval, or `504` when all selected providers time out.

## Structured knowledge API

`POST /api/search` accepts the same JSON query as `/api/retrieve`. The server
checks its Gemini configuration, runs the selected retrieval providers, and
passes usable evidence to the Google GenAI SDK (3.6.1). The default model is
[Gemini 3.8 Flash](https://aistudio.google.com/docs/models/gemini-3.8-flash).
Choose a model that supports structured JSON when setting `GEMINI_MODEL`.

- The evidence builder revalidates provider records and sends up to six sources,
  with at most 1,600 characters per excerpt and 12,000 UTF-8 bytes for the
  serialized evidence array. The versioned system instruction treats the query
  and retrieved text as untrusted data.
- Gemini gets one attempt, a 20-second deadline, and an output budget of 6,144
  tokens. The service caps decoded model text at 32 KiB, parses the JSON and
  validates it with Zod.
- A successful response includes a title, summary, detail, sections, takeaways,
  concepts, relationships, and citations. Claims distinguish evidence from
  synthesis. The service checks relationship endpoints and source IDs,
  assigns stable graph IDs, and builds citations from the supplied retrieval
  records. It retains the original canonical URLs and available source metadata.

Successful and insufficient-evidence responses use HTTP `200`. The latter
returns `status: "insufficient_evidence"` and `knowledge: null`. Successful
generation includes the model and prompt version. The response reports
retrieval status and provider errors separately from generated knowledge.

Both endpoints share request validation. Search returns fixed error codes and
messages for retrieval failure, credential errors, quotas, timeouts, and
invalid generated data. Generation is skipped when configuration is missing
or retrieval finds no usable evidence. Source validation verifies the identity
of each citation. The accuracy and interpretation of generated claims still
require review.

## Status and planned phases

Phase 5 adds server-side Gemini generation over retrieved evidence. The
interactive Cytoscape dashboard still uses the local machine learning example.
Vitest uses mocked provider and Gemini responses, and Chromium tests cover the
dashboard and graph.

The proposed ten-phase roadmap is:

1. Audit and stabilize the project foundation.
2. Set up the application shell and topic search UI.
3. Render, navigate, and select concepts with Cytoscape.js.
4. Retrieve, normalize, deduplicate, and rank evidence from multiple sources.
5. Generate topic explanations and related concepts with Gemini.
6. Show supporting sources and citations.
7. Orchestrate search and concept expansion with LangGraph.js.
8. Save and restore recent explorations locally.
9. Improve accessibility, error handling, and feature test coverage.
10. Verify production readiness and deploy to Vercel.
