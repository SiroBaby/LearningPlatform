import { proxyPhase0Request } from "@/lib/phase0/route-handler";

interface DocumentRouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function POST(_request: Request, context: DocumentRouteContext): Promise<Response> {
  const { id } = await context.params;
  return proxyPhase0Request({ method: "POST", path: `/documents/${encodeURIComponent(id)}` + "/confirm" });
}
