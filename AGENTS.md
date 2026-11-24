<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AI Personal Knowledge Assistant — Dynamic Knowledge Graph Explorer

The project will help users search for a topic, read an AI-generated explanation,
explore related concepts and their relationships, and reopen previous explorations.

## Architecture

- Use the Next.js App Router for the frontend and backend.
- Keep React state as the canonical graph state and use Cytoscape.js to render it.
- Use LangGraph.js for server-side AI orchestration, Gemini for knowledge generation,
  and external retrieval providers for supporting sources.
- Use browser `localStorage` for initial exploration persistence.

## Development

- Inspect the repository and relevant installed Next.js guides before modifying code.
- Use pnpm exclusively and preserve the lockfile and existing architecture.
- Keep TypeScript strict. Validate external data at the boundary using Zod.
- Keep credentials on the server and out of version control and public environment variables.
- Write tests for implemented functionality. Use Playwright Test for repeatable
  end-to-end checks and Playwright MCP for interactive browser verification.
- Use real sources and URLs for citations. Never invent them.
- Avoid adding databases, authentication, or unnecessary services.
- Implement only the requested phase and run the relevant checks after changes.
