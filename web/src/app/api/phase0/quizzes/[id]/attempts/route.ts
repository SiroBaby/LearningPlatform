import { proxyPhase0JsonPost, proxyPhase0Request } from "@/lib/phase0/route-handler";

export const dynamic = "force-dynamic";

interface QuizRouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function POST(request: Request, context: QuizRouteContext): Promise<Response> {
  const { id } = await context.params;
  return proxyPhase0JsonPost(`/quizzes/${encodeURIComponent(id)}/attempts`, request);
}

export async function GET(_request: Request, context: QuizRouteContext): Promise<Response> {
  const { id } = await context.params;
  return proxyPhase0Request({
    method: "GET",
    path: `/quizzes/${encodeURIComponent(id)}/attempts`,
  });
}
