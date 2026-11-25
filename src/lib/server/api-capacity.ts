import "server-only";

import { queryJson } from "./query-request";
import { enforceRateLimit } from "./rate-limit";

export const maxConcurrentApiRequests = 8;
// Route handlers may be separate bundles in the same server worker.
const worker = globalThis as typeof globalThis & {
  knowledgeAssistantRequests?: number;
};

export async function withApiCapacity(run: () => Promise<Response>) {
  const active = worker.knowledgeAssistantRequests ?? 0;
  if (active >= maxConcurrentApiRequests) {
    return queryJson(
      {
        error: {
          code: "service_busy",
          message: "The service is busy. Please try again shortly.",
        },
      },
      429,
      { "Retry-After": "2" },
    );
  }
  worker.knowledgeAssistantRequests = active + 1;
  try {
    return await run();
  } finally {
    worker.knowledgeAssistantRequests =
      (worker.knowledgeAssistantRequests ?? 1) - 1;
  }
}

export function withApiAdmission(
  request: Request,
  run: () => Promise<Response>,
) {
  return withApiCapacity(
    async () => (await enforceRateLimit(request)) ?? run(),
  );
}
