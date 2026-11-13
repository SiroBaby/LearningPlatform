import { proxyPhase0OptionalJsonPost } from "@/lib/phase0/route-handler";

interface DocumentRouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function POST(request: Request, context: DocumentRouteContext): Promise<Response> {
  const { id } = await context.params;
  return proxyPhase0OptionalJsonPost(`/documents/${encodeURIComponent(id)}` + "/confirm", request);
}
