import { proxyPhase0JsonPost } from "@/lib/phase0/route-handler";

export const dynamic = "force-dynamic";

interface PlaybackUrlRouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

const NO_STORE = "no-store";

export async function POST(request: Request, context: PlaybackUrlRouteContext): Promise<Response> {
  try {
    const { id } = await context.params;
    const response = await proxyPhase0JsonPost(`/documents/${encodeURIComponent(id)}/playback-url`, request);
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", NO_STORE);
    return new Response(response.body, { status: response.status, headers });
  } catch {
    return Response.json(
      { code: "MEDIA_PLAYBACK_UNAVAILABLE", message: "Media playback is temporarily unavailable.", retryable: true },
      { status: 503, headers: { "Cache-Control": NO_STORE } },
    );
  }
}
