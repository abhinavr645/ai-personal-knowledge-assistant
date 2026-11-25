# AI Personal Knowledge Assistant

Search for a topic, read an AI-generated explanation with source links, and
follow related concepts in an interactive graph. Expand a concept to add new
branches to the current workspace, then reopen saved work from your browser.

## Stack

- Next.js 16 App Router, React 19, strict TypeScript, and Tailwind CSS 4
- shadcn/ui with Base UI and the Nova preset, plus Lucide React icons
- Cytoscape.js for rendering the graph, with React state as its source of truth
- Browser `localStorage` for exploration history
- LangGraph.js and LangChain Core for orchestration, the Google Gemini SDK for
  generation, external retrieval providers for sources, and Zod for validation
- Vitest, jsdom, React Testing Library, jest-dom, MSW, Playwright Test, and
  axe-core for automated checks, plus Playwright MCP for interactive inspection
- ESLint and Prettier for code quality, Git and GitHub for version control, and
  Vercel for protected staging and production hosting
- Upstash Redis REST for shared admission budgets on hosted requests

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
After dependency and browser installation, the build and mocked suites use
local assets. The pinned Geist package supplies the dashboard fonts.

## Checks and scripts

| Command             | Purpose                                                         |
| ------------------- | --------------------------------------------------------------- |
| `pnpm peers check`  | Check the resolved dependency peer ranges.                      |
| `pnpm audit`        | Check the resolved dependency tree against registry advisories. |
| `pnpm typecheck`    | Generate Next.js route types and run strict TypeScript checks.  |
| `pnpm lint`         | Apply the Next.js ESLint rules.                                 |
| `pnpm format`       | Format supported project files with Prettier.                   |
| `pnpm format:check` | Check formatting.                                               |
| `pnpm test`         | Run Vitest unit and component tests once.                       |
| `pnpm test:watch`   | Watch for changes with Vitest.                                  |
| `pnpm test:e2e`     | Test the dashboard in Chromium.                                 |
| `pnpm build`        | Create a production build.                                      |
| `pnpm start`        | Serve the production build on port 3000.                        |

Playwright Test starts the local development server when needed and retains a
screenshot and trace on failure. The HTML report is written to `playwright-report/`.
Playwright MCP provides a separate browser for interactive inspection.

## Environment variables

Use `.env.example` as the template for a local `.env.local` file. The labeled
example graph and mocked tests run without credentials.

| Variable                         | Use                                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------------------- |
| `GEMINI_API_KEY`                 | Required for `POST /api/search` and `POST /api/related`.                                 |
| `GEMINI_MODEL`                   | Optional structured-output model override. Defaults to `gemini-3.8-flash`.               |
| `TAVILY_API_KEY`                 | Required for hosted acceptance testing of web and official documentation retrieval.      |
| `WIKIPEDIA_CONTACT`              | Optional public operator email or project URL sent in the User-Agent.                    |
| `UPSTASH_REDIS_REST_URL`         | Required on Vercel. HTTPS database URL from the Redis REST settings.                     |
| `UPSTASH_REDIS_REST_TOKEN`       | Required on Vercel. Use the read/write REST token.                                       |
| `RATE_LIMIT_NAMESPACE`           | Required on Vercel. Use a stable lowercase name of up to 48 letters, digits, or hyphens. |
| `RATE_LIMIT_REQUESTS_PER_MINUTE` | Optional per-client budget. Defaults to 12.                                              |
| `RATE_LIMIT_REQUESTS_PER_HOUR`   | Optional shared budget across all clients in a namespace. Defaults to 300.               |

Git ignores `.env.local`. Vercel upload exclusions also cover local
environment files and browser artifacts. Keep keys server-side and omit the
`NEXT_PUBLIC_` prefix. Use [Google AI Studio](https://aistudio.google.com/app/apikey) and the
[Tavily dashboard](https://app.tavily.com/) to issue environment-specific keys.
Local `pnpm dev` works without the hosted limiter. A production build serves
the dashboard locally, while valid provider requests require hosted limiter
configuration and trusted Vercel ingress.

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

`POST /api/search` accepts the same JSON query as `/api/retrieve`. After request
validation, the server checks its Gemini configuration and invokes the compiled
LangGraph workflow. The workflow passes usable evidence to the Google GenAI
SDK (3.6.1). The default model is
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

## Search workflow

LangGraph.js 1.7.5 runs the search pipeline on the server. The route returns the
finalized Phase 5 response with the same status codes, citations, and retrieval
metadata. The standalone retrieval endpoint executes the same provider service
directly.

```mermaid
flowchart TD
  Start([Start]) --> Analyze[analyzeQuery]
  Analyze --> Route[routeSources]
  Route --> Retrieve[retrieveEvidence]
  Retrieve -->|Complete or partial retrieval| Process[processEvidence]
  Retrieve -->|Complete failure| Finalize[finalizeResponse]
  Process -->|Usable evidence| Generate[generateKnowledge]
  Process -->|Empty evidence or failure| Finalize
  Generate -->|Model response| Validate[validateKnowledge]
  Generate -->|Generation failure| Finalize
  Validate -->|Validated, insufficient, or invalid| Finalize
  Finalize --> End([End])
```

- Classification and routing use the Phase 4 rules for general knowledge,
  technology, software discovery, and direct repository queries. Retrieval
  receives the selected plan and runs its existing concurrent provider calls,
  deduplication, and ranking once.
- Evidence processing revalidates and bounds ranked results using the Phase 5
  evidence builder. Generation and validation reuse the existing prompt,
  Gemini client, Zod schema, endpoint checks, and citation reconstruction.
- Zod-backed state channels hold the query, classified plan, provider metadata,
  and the payload for the current stage. Prepared evidence replaces the raw
  results, and validation clears the draft and evidence. The output channel
  returns only the finalized response. The Gemini client travels in request
  context so credentials stay outside state.
- Each request makes at most one Gemini attempt. Missing credentials are
  checked before retrieval. Expected failures and unexpected exceptions return
  fixed messages, and completed retrieval metadata is retained alongside
  generation failures. Request cancellation and the existing provider and
  model deadlines bound external work.
- Stage logs record timings, statuses, provider names, counts, and safe error
  codes. Searches stop before dispatch when LangSmith tracing or LangChain
  verbose logging is enabled in the server environment. These framework
  diagnostics can capture query and evidence payloads. Run `pnpm test` for mock-based workflow and API tests and
  `pnpm exec playwright test` for the dashboard and graph regression tests.

## Dashboard exploration

1. Submit a question or choose an example topic. The dashboard sends
   `{ "query": "JavaScript" }` to `POST /api/search` and validates the response
   before it renders the explanation, clickable sources, and initial graph.
   It selects the concept matching the query or answer title, or the first
   concept when neither matches.
2. Select a node on the canvas or under **Browse concepts** to read its
   description, see its source references, and highlight its neighbors.
3. Choose **Expand concept** to request related concepts. Each node tracks its
   own request and retry state. Successful expansion adds connected concepts
   near the selected node, updates its explanation, and keeps earlier nodes,
   relationships, positions, pan, and zoom. New concepts can be expanded too.
4. Submit a new search or choose **New exploration** to clear the current
   workspace and cancel pending requests. Open a saved exploration from
   **Exploration history** to continue it. React owns the active workspace.
   Cytoscape renders the graph and handles gestures.

### Expansion API

Send `POST /api/related` with `Content-Type: application/json`. The shared Zod
schemas live in `src/lib/exploration/contracts.ts`. The request is limited to
16 KiB and accepts these fields.

| Field                | Shape                                                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `topic`              | Original exploration query, 1–300 characters.                                                                              |
| `concept`            | Selected concept with the server-issued `id`, its `name` (up to 120 characters), and `description` (up to 400 characters). |
| `neighbors`          | Up to eight known concepts with their `id` and `name`, including the discovery parent when available.                      |
| `existingConceptIds` | Up to 100 distinct known concept IDs, including the selected concept and neighbors.                                        |

Expansion builds a focused retrieval query from the selected concept and its
context, then runs the same LangGraph pipeline, evidence builder, and Gemini
client as search. The expansion prompt receives the original topic, selected
concept, and neighbors as structured, untrusted context. It asks for an
evidence-backed explanation and up to seven additional concepts linked to the
selected anchor. The backend validates citations, drops duplicate and invalid
relationships, and returns only new concepts reachable from the anchor.
Concept IDs come from normalized names and relationship IDs from the type and
endpoints. The workspace caps the merged graph at 100 concepts.

A successful response uses the search envelope
`{ status, query, knowledge, generation, evidenceCount, retrieval }` plus
`conceptId`. Here `query` is the original exploration topic. The `knowledge`
object contains `evidenceStatus`, `evidenceNote`, `explanation`, `concepts`,
`relationships`, and `sources`. Relationship endpoints can reference existing
concepts or concepts in the returned batch. An empty batch has empty concept and
relationship arrays. Insufficient evidence returns HTTP 200 with
`status: "insufficient_evidence"`, `knowledge: null`, and a message.

Invalid fields or JSON return 400, oversized bodies return 413, and invalid
content types return 415. Retrieval and Gemini failures return the same safe
`{ error: { code, message }, retrieval? }` envelope as search. The browser
validates both endpoints' responses, times requests out after 32 seconds, and
offers retry for failed expansions. The retrieval-only API runs independently
of Gemini and shares the same admission budgets.

### Exploration tests

Run `pnpm test` for MSW-backed provider and dashboard tests, including expansion
context, validation, citations, deduplication, retry, and cancellation. Run
`pnpm exec playwright test` for the mocked JavaScript → React → Hooks journey,
viewport preservation, mobile overflow, and error recovery in Chromium.

## Exploration history

The dashboard sets aside a new exploration ID when a valid search starts.
It saves the first snapshot after the search returns a validated explanation.
Completed expansions, selection changes, final node positions after a drag, and
layout resets update the snapshot. Pan, zoom, animation, and in-flight requests
do not trigger saves. An identical snapshot skips the write. Failed searches
and searches that return insufficient evidence leave history as it was.

Open **Exploration history** in the sidebar or mobile workspace menu to see
saved titles, concept counts, and last updated times. Click a title to reopen
the graph, explanations, citations, completed expansions, selection, and saved
node positions. Opening an entry makes no retrieval or Gemini requests.
The entry's actions menu offers **Rename** and **Delete**. Deletion requires
confirmation. **New exploration** clears the active workspace and keeps saved
entries.

### Snapshot format and limits

The browser stores one JSON record per exploration under
`knowledge-assistant:exploration:<uuid>`. Storage access begins after hydration.
The Zod schema in `src/lib/exploration/history-snapshot.ts` checks every save
and restore.

| Snapshot field                            | Content                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| `version`                                 | Schema version. The initial version is `1`.                              |
| `id`, `title`                             | Exploration UUID and display title of up to 120 characters.              |
| `createdAt`, `updatedAt`                  | UTC timestamps for creation and the last saved change.                   |
| `content.topic`                           | Original search query, independent of the display title.                 |
| `content.graph`                           | Root ID, concept nodes, and relationships with stable IDs.               |
| `content.selectedId`, `content.positions` | Selected concept and saved model-space coordinates, when available.      |
| `content.overview`, `content.expansions`  | Explanation and citation IDs for the topic and each completed expansion. |
| `content.sources`                         | One metadata record per cited source ID, with its validated URL.         |

Version dispatch lives in the snapshot decoder. Future migrations can decode
an older supported version there and validate the migrated record against the
current schema. An unreadable record or unknown version stays untouched and
is skipped in the list. Other entries remain usable.

History can hold 20 records, including unreadable records, and each graph
retains the 100-concept limit. Each serialized record has a budget of 256,000
UTF-16 code units. The combined key and record budget is 2,000,000 units.
The browser's own quota may be lower. When storage is blocked or full,
the current workspace remains usable and the last successful snapshot remains
in history. **Retry save** lets the user try again after freeing space. History
never evicts an entry to make room.

Saved data belongs to the current browser profile and site origin. It survives
refreshes and browser restarts while the browser retains site data. Clearing
site data removes local explorations. The snapshot stores explanations and
citation metadata. Credentials, provider payloads, pending requests, and
temporary errors are excluded. Reopen a saved entry manually after a refresh.
Before saving, the dashboard compares the stored content with the version
currently open. If another tab has saved a newer graph, the dashboard preserves
it and asks the user to reopen that entry. A rename alone can coexist with a
graph update. Browser storage has no transaction spanning the comparison and
write, so exactly simultaneous writes can still race.

### Persistence tests

Run `pnpm test` for snapshot validation, CRUD, corrupt records, storage limits,
and mocked dashboard save and restore tests. Run `pnpm exec playwright test` for
the Chromium journey from JavaScript through React and Hooks, reopening after
refresh, expanding another concept, renaming, and deleting. The browser suite
also exercises the mobile sidebar and recovery after a simulated quota error.

## Security and reliability

- All three POST routes validate JSON before dispatch. Search and retrieval
  accept up to 4 KiB, and expansion accepts up to 16 KiB. Request body reads
  time out after six seconds with HTTP 408. The server worker accepts up to
  eight concurrent validated requests across the routes. Further requests
  return HTTP 429 with `Retry-After: 2`.
- Provider fetches use fixed outbound endpoints and disallow HTTP redirects.
  Official-documentation citations must match an approved HTTPS host and
  documentation path. Citation URLs are validated metadata. A user's browser
  may follow redirects when opening a source link.
- Retrieved evidence and the search topic enter Gemini as data separate from
  the system instructions. The server checks citation IDs and graph
  relationships before returning knowledge. Partial retrieval details remain
  in the API response. These checks establish citation provenance. Factual
  accuracy and the quality of each explanation still require human review.
- The app sends a Content Security Policy that blocks framing and plugin
  objects and limits document base URLs and form submissions. It also sends
  MIME sniffing protection and a referrer policy. The policy preserves the
  statically rendered dashboard and does not enforce a script nonce.
- The `minimatch` override applies only to the `@ts-morph/common` adapter
  used by the shadcn CLI. Version 11.0.9 resolves the moderate advisory
  detected for the prior lockfile.
  [Maintainer advisory](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249)

### Hosted rate limiting

The eight-request cap controls concurrent work in each worker. Once a POST
passes input validation and obtains a worker slot, one atomic Redis command
checks and increments the client and shared budgets before provider calls.
Both counters live in the same Upstash database and namespace across workers.
Vercel's WAF is available as an edge layer. The Redis check supplies the
application's structured error and fails closed when Redis is unavailable.
[Vercel WAF rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting)
[Upstash REST API](https://upstash.com/docs/redis/features/restapi)

Only the Vercel-provided `x-vercel-forwarded-for` header supplies the client
identity. Enable Vercel system variables and use direct Vercel ingress. The
application accepts one IPv4 address or IPv6 `/64` bucket, normalizes
IPv4-mapped IPv6, and uses a keyed digest as the Redis identity. Redis stores
short-lived counters. Request bodies, raw addresses, and credentials are
excluded from counter keys and application limiter logs. Clients behind a
shared network can reach their limit together.
[Vercel request headers](https://vercel.com/docs/headers/request-headers)

Clients over either budget receive HTTP 429, `error.code: "rate_limited"`,
and a numeric `Retry-After` for the remaining window. Missing or invalid
identity, missing configuration, Redis timeouts, and invalid Redis responses
return HTTP 503 with `error.code: "rate_limit_unavailable"`. The check has a
two-second deadline. The default shared budget permits up to 300 admitted
requests per active hour-long window. Each admitted request can make up to
three concurrent retrieval calls and one generation attempt. These counts
bound application calls per window. Provider usage and billing still need
separate quotas and review.

### Protected staging on Vercel

1. Choose the private GitHub repository that should hold the project. If the
   local repository has no remote, add the approved repository as `origin`.
   Review and commit the deployment changes before pushing a staging branch.
2. From the repository root run `pnpm dlx vercel login` and
   `pnpm dlx vercel link`. Select or create the intended staging project.
   In its settings, enable Vercel Authentication for all deployments where
   available. With Standard Protection, use the protected Preview scope and
   keep production domains unassigned to staging. Confirm protection before
   connecting GitHub with `pnpm dlx vercel git connect`. The repository's
   `vercel.json` disables automatic Git deployments so releases are deliberate.
3. Use the **Next.js** preset, the repository root, Node.js **26.x**,
   `pnpm build`, and the preset's default output directory. Enable Fluid
   Compute. In the Preview build environment enable
   `ENABLE_EXPERIMENTAL_COREPACK=1` and leave the Install Command at its
   default so Vercel uses the pnpm pin in `package.json`. Confirm the build log
   uses pnpm 12.23.0 and the checked-in lockfile. Route Functions set maximum
   durations of 40 seconds for search and expansion and 20 for retrieval.
   [Next.js on Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs)
   [Vercel Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)
   [Build configuration](https://vercel.com/docs/builds/configure-a-build)
4. In the Upstash Console create a dedicated staging Redis database with
   a primary region close to the Vercel Function region and no read regions.
   Keep eviction disabled. Set its REST URL and read/write token as server
   environment variables scoped to **Preview**. Set
   `RATE_LIMIT_NAMESPACE=knowledge-staging` and add the Preview Gemini and
   Tavily keys. Confirm **Automatically expose System Environment Variables**
   is enabled so Functions receive the platform's `VERCEL=1` marker.
   [Upstash setup](https://upstash.com/docs/redis/overall/getstarted)
   [Vercel environment variables](https://vercel.com/docs/environment-variables)
5. Deploy using `pnpm dlx vercel deploy` from the reviewed staging checkout.
   Verify the Preview URL and its three POST routes reject an unauthenticated
   browser before sharing the address. Use an authorized browser for the
   acceptance tests. Check that HTTP redirects to HTTPS and that the HTTPS
   response includes HSTS, the app's CSP, and MIME-sniffing protection.
   [Deployment Protection](https://vercel.com/docs/deployment-protection)
   [Vercel response headers](https://vercel.com/docs/headers/response-headers)

### Live acceptance and production release

Run the following on protected staging with its real provider keys. Start with
three provider-backed requests and stop on a credential or model error.

1. Search **Photosynthesis**. Check that the API returns HTTP 200 with
   `status: "ok"`, a validated explanation, valid graph endpoints, and
   citations from Wikipedia or Tavily. Inspect `retrieval.providers`,
   `retrieval.errors`, and the cited source metadata to record which provider
   actually succeeded.
2. Search **React useState**. Verify the explanation and at least one relevant
   official React documentation citation. Open the source and confirm the
   displayed relationship endpoints exist. A provider listed in metadata may
   have failed or returned no usable records.
3. Expand one concept from the technical result. Inspect the original topic,
   selected concept, neighbors, and existing concept IDs in the request.
   Confirm the new graph stays connected, existing nodes and edges remain,
   and new citations resolve to their supplied sources. Record request
   duration and the safe server stage timings for retrieval and generation.

Record GitHub as pending if those three requests never route to it. When it
is part of the release criteria, verify it independently with one
`POST /api/retrieve` for `vercel/next.js`. Check provider failure paths with
mocks or an isolated credential-free deployment. For hosted rate-limit
verification, use a dedicated test Preview and Redis namespace with low
limits and omit the Gemini and Tavily keys. A technical search or expansion
will stop at the Gemini preflight after admission. Verify accepted requests
and a subsequent HTTP 429 with `Retry-After` across all three endpoints.
Use hosting diagnostics to establish separate worker instances where
available. Record the cross-instance check as pending if worker attribution
is unavailable. Verify a limiter outage in that isolated deployment.

Replay the browser journey on mobile and desktop. Confirm source links,
selection, expansion, local history after refresh, rename and deletion.
Inspect the Network and Console panels and safe runtime logs. Record endpoint
status, latency, provider status, and evidence counts. Keep authorization
headers, secret values, and raw provider payloads out of reports. Apply the
browser bundle secret scan to the production build as well.

For production, set separate **Production** provider keys and a dedicated
Redis database and namespace. Review quotas and establish the spend
thresholds before promotion. After staging acceptance, build the production
candidate with `pnpm dlx vercel deploy --prod --skip-domain`. Verify access
protection on its generated URL and repeat production configuration and
browser smoke checks there. Promote the reviewed candidate with
`pnpm dlx vercel promote <candidate-url>` only once all public release
checks pass. Production and Preview use separate browser origins and
therefore separate local history.
[Vercel deployment CLI](https://vercel.com/docs/cli/deploy)

### Verification status

Two separate local production-build processes shared a live, disposable
Upstash database. With synthetic identities and provider keys disabled, the
per-client and shared limits returned 429 across processes with the expected
retry windows. Missing identity returned 503. Redis-backed requests in this
small check took 245–831 ms end to end, including local routing and credential
checks. The probe did not measure retrieval, generation, or Vercel latency.

The local production build and mocked browser suite exercise retrieval,
generation, expansion, failure states, and browser-local history. The
workspace is awaiting a GitHub remote, a linked Vercel project, and the
staging environment variables. Protected staging, live Gemini and retrieval,
hosted expansion, Vercel ingress and HTTPS checks, and browser verification
on the deployed URL are pending. Public release is blocked on those checks
and on shared-limit verification in the actual hosting environment.

### Phase 9 graph benchmark

Five Chromium runs against each production build expanded a synthetic graph
from 93 to 100 concepts, starting with 362 relationships. Graph updates now
skip unchanged Cytoscape data and capture new node positions before autosave.

| Measurement                                       | Before      | After     |
| ------------------------------------------------- | ----------- | --------- |
| Data events on existing elements                  | 455 per run | 0 per run |
| Full layout runs during expansion                 | 0 per run   | 0 per run |
| Observed storage writes during expansion          | 1–2 per run | 1 per run |
| Median first node addition to last position event | 1.6 ms      | 0.8 ms    |

The benchmark measures local graph updates with mocked API responses.

## Status and planned phases

Phase 10 adds Vercel deployment configuration and a shared admission limit.
Vitest covers request bounds, provider behavior, concurrent expansions, and
storage recovery. Playwright runs axe and checks layout at 320, 375, 768,
1024, and 1440 pixels. The hosted acceptance checklist above governs release.

The proposed ten-phase roadmap is:

1. Audit and stabilize the project foundation.
2. Set up the application shell and topic search UI.
3. Render, navigate, and select concepts with Cytoscape.js.
4. Retrieve, normalize, deduplicate, and rank evidence from multiple sources.
5. Generate topic explanations and related concepts with Gemini.
6. Orchestrate server-side search with LangGraph.js.
7. Connect the dashboard to structured search, citations, and recursive expansion.
8. Save and restore recent explorations locally.
9. Improve accessibility, error handling, and feature test coverage.
10. Verify production readiness and deploy to Vercel.
