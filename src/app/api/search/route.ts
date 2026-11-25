import { runSearchWorkflow } from "@/lib/langgraph/search-workflow";
import { withApiAdmission } from "@/lib/server/api-capacity";
import { parseQueryRequest, queryJson } from "@/lib/server/query-request";

export const maxDuration = 40;

export async function POST(request: Request) {
  const parsed = await parseQueryRequest(request);
  if ("response" in parsed) return parsed.response;

  return withApiAdmission(request, async () => {
    const { body, status } = await runSearchWorkflow(
      parsed.query,
      request.signal,
    );
    return queryJson(body, status);
  });
}
