import { runSearchWorkflow } from "@/lib/langgraph/search-workflow";
import { parseQueryRequest, queryJson } from "@/lib/server/query-request";

export async function POST(request: Request) {
  const parsed = await parseQueryRequest(request);
  if ("response" in parsed) return parsed.response;

  const { body, status } = await runSearchWorkflow(
    parsed.query,
    request.signal,
  );
  return queryJson(body, status);
}
