import "server-only";

import {
  mapSafeBackendError,
  sanitizeBackendErrorText,
} from "@/lib/phase0/backend-error";
import { getPhase0ServerConfig } from "@/lib/phase0/server-config";

interface BackendRequest {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly body?: unknown;
}

async function toErrorResponse(response: Response): Promise<Response> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const error = mapSafeBackendError(await response.json());
    return Response.json(error ?? { message: "The Phase 0 API request failed." }, { status: response.status });
  }
  return Response.json(
    { message: sanitizeBackendErrorText(await response.text()) },
    { status: response.status },
  );
}

export async function requestPhase0Backend(request: BackendRequest): Promise<Response> {
  const config = getPhase0ServerConfig();
  const headers = new Headers({ "X-User-Id": config.ownerId });
  const init: RequestInit = { method: request.method, headers, cache: "no-store" };
  if (request.body !== undefined) {
    headers.set("Content-Type", "application/json");
    init.body = JSON.stringify(request.body);
  }
  let response: Response;
  try {
    response = await fetch(`${config.apiBaseUrl}${request.path}`, init);
  } catch {
    return Response.json({ message: "The Phase 0 API is unavailable." }, { status: 502 });
  }
  if (!response.ok) {
    return toErrorResponse(response);
  }
  return response;
}
