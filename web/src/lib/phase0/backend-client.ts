import "server-only";

import { requestAuthenticatedBackend } from "@/lib/auth/backend-client";
import {
  mapSafeBackendError,
  sanitizeBackendErrorText,
} from "@/lib/phase0/backend-error";

interface BackendRequest {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly body?: unknown;
}

const API_PREFIX = "/api/v1";

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

export async function requestAuthenticatedPhase0Backend(request: BackendRequest): Promise<Response> {
  const response = await requestAuthenticatedBackend({
    ...request,
    path: `${API_PREFIX}${request.path}`,
  });
  if (!response.ok) return toErrorResponse(response);
  return response;
}
