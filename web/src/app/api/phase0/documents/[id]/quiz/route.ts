import { proxyPhase0Request } from "@/lib/phase0/route-handler";

export const dynamic = "force-dynamic";

interface DocumentRouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function GET(_request: Request, context: DocumentRouteContext): Promise<Response> {
  const { id } = await context.params;
  return proxyPhase0Request({ method: "GET", path: `/documents/${encodeURIComponent(id)}` + "/quiz" });
}
