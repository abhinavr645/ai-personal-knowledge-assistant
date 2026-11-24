import { runSearchWorkflow } from "@/lib/langgraph/search-workflow";
import { withApiCapacity } from "@/lib/server/api-capacity";
import { parseQueryRequest, queryJson } from "@/lib/server/query-request";

export async function POST(request: Request) {
  const parsed = await parseQueryRequest(request);
  if ("response" in parsed) return parsed.response;

  return withApiCapacity(async () => {
    const { body, status } = await runSearchWorkflow(
      parsed.query,
      request.signal,
    );
    return queryJson(body, status);
  });
}
