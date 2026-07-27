import { proxyPhase0Request } from "@/lib/phase0/route-handler";

export const dynamic = "force-dynamic";

interface AttemptRouteContext {
  readonly params: Promise<{ readonly attemptId: string; readonly id: string }>;
}

export async function GET(
  _request: Request,
  context: AttemptRouteContext,
): Promise<Response> {
  const { attemptId, id } = await context.params;
  return proxyPhase0Request({
    method: "GET",
    path: `/quizzes/${encodeURIComponent(id)}/attempts/${encodeURIComponent(attemptId)}`,
  });
}
