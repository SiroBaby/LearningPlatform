import { proxyPhase0JsonPost } from "@/lib/phase0/route-handler";

export async function POST(request: Request): Promise<Response> {
  return proxyPhase0JsonPost("/documents/upload-url", request);
}
