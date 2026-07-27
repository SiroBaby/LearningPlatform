import { proxyPhase0JsonPost } from "@/lib/phase0/route-handler";

interface QuizRouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function POST(request: Request, context: QuizRouteContext): Promise<Response> {
  const { id } = await context.params;
  return proxyPhase0JsonPost(`/quizzes/${encodeURIComponent(id)}/attempts`, request);
}
