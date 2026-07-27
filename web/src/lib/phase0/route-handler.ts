import "server-only";

import { requestPhase0Backend } from "@/lib/phase0/backend-client";

interface BackendRouteRequest {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly body?: unknown;
}

export async function proxyPhase0Request(request: BackendRouteRequest): Promise<Response> {
  const response = await requestPhase0Backend(request);
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok) {
    return response;
  }
  if (contentType.includes("application/json")) {
    return Response.json(await response.json(), { status: response.status });
  }
  return new Response(await response.text(), {
    status: response.status,
    headers: { "Content-Type": contentType || "text/plain; charset=utf-8" },
  });
}

export async function proxyPhase0JsonPost(path: string, request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ message: "The request body must be valid JSON." }, { status: 400 });
  }
  return proxyPhase0Request({ method: "POST", path, body });
}
