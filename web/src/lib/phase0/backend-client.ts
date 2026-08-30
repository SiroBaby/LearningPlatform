import "server-only";

import { cookies } from "next/headers";

import {
  mapSafeBackendError,
  sanitizeBackendErrorText,
} from "./backend-error";

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

function getPhase0ApiBaseUrl(): string {
  const value = process.env.PHASE0_API_BASE_URL;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("PHASE0_API_BASE_URL must be configured for the Phase 0 BFF.");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("PHASE0_API_BASE_URL must be an absolute HTTP(S) URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("PHASE0_API_BASE_URL must use HTTP or HTTPS.");
  }
  return url.toString().replace(/\/$/u, "");
}

export async function requestPhase0Backend(request: BackendRequest): Promise<Response> {
  const accessToken = (await cookies()).get("lp_access")?.value;
  const headers = new Headers();
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  const init: RequestInit = { method: request.method, headers, cache: "no-store" };
  if (request.body !== undefined) {
    headers.set("Content-Type", "application/json");
    init.body = JSON.stringify(request.body);
  }
  let response: Response;
  try {
    response = await fetch(`${getPhase0ApiBaseUrl()}${request.path}`, init);
  } catch {
    return Response.json({ message: "The Phase 0 API is unavailable." }, { status: 502 });
  }
  if (!response.ok) {
    return toErrorResponse(response);
  }
  return response;
}
