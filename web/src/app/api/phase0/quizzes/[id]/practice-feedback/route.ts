import { proxyPhase0JsonPost } from "@/lib/phase0/route-handler";

interface QuizPracticeFeedbackRouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function POST(request: Request, context: QuizPracticeFeedbackRouteContext): Promise<Response> {
  const { id } = await context.params;
  return proxyPhase0JsonPost(`/quizzes/${encodeURIComponent(id)}/practice-feedback`, request);
}
