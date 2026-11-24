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

Use `.env.example` as the template for a local `.env.local` file when provider
integrations are added. The dashboard demo runs without credentials.

| Variable         | Planned use                  |
| ---------------- | ---------------------------- |
| `GEMINI_API_KEY` | Gemini knowledge generation. |
| `TAVILY_API_KEY` | Tavily retrieval.            |

Git ignores `.env.local`. Keep both keys in server-side code and omit the
`NEXT_PUBLIC_` prefix for credentials.

## Status and planned phases

Phase 2 adds the responsive Knowledge Explorer dashboard. Search opens a local
machine learning example with a selectable graph, sample explanation, and concept
details. The sidebar contains example explorations, and preferences apply to the
current page session. Vitest and Chromium tests cover these interactions.

The proposed ten-phase roadmap is:

1. Audit and stabilize the project foundation.
2. Set up the application shell and topic search UI.
3. Define and validate graph and search data contracts.
4. Render concepts and relationships with Cytoscape.js.
5. Generate topic explanations and related concepts with Gemini.
6. Retrieve supporting sources and show citations.
7. Orchestrate search and concept expansion with LangGraph.js.
8. Save and restore recent explorations locally.
9. Improve accessibility, error handling, and feature test coverage.
10. Verify production readiness and deploy to Vercel.
