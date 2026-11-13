import { proxyPhase0Request } from "@/lib/phase0/route-handler";

export const dynamic = "force-dynamic";

interface SubtitlePreviewRouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

/** Reading and parsing a subtitle file of up to 5 MiB can outlast the default request timeout. */
const SUBTITLE_PREVIEW_TIMEOUT_MS = 30_000;

export async function POST(_request: Request, context: SubtitlePreviewRouteContext): Promise<Response> {
  const { id } = await context.params;
  return proxyPhase0Request({
    method: "POST",
    path: `/documents/${encodeURIComponent(id)}/subtitle-preview`,
    timeoutMs: SUBTITLE_PREVIEW_TIMEOUT_MS,
  });
}
