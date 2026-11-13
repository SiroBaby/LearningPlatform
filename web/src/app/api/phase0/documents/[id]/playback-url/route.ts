import { proxyPhase0JsonPost } from "@/lib/phase0/route-handler";

export const dynamic = "force-dynamic";

interface PlaybackUrlRouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

export async function POST(request: Request, context: PlaybackUrlRouteContext): Promise<Response> {
  const { id } = await context.params;
  const response = await proxyPhase0JsonPost(`/documents/${encodeURIComponent(id)}/playback-url`, request);
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, headers });
}
