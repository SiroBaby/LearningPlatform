import { proxyPhase0Request } from "@/lib/phase0/route-handler";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return proxyPhase0Request({ method: "GET", path: "/documents" });
}
