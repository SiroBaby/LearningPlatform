import "server-only";

import { getPhase0ServerConfig } from "@/lib/phase0/server-config";

interface BackendRequest {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly body?: unknown;
}

const MAX_ERROR_MESSAGE_LENGTH = 512;

function sanitizeMessage(value: string): string {
  const compactValue = value.replace(/[\u0000-\u001F\u007F]/g, " ").trim();
  return compactValue.slice(0, MAX_ERROR_MESSAGE_LENGTH) || "The Phase 0 API request failed.";
}

function readErrorMessage(value: unknown): string | null {
  if (typeof value === "string") {
    return sanitizeMessage(value);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const message = Object.entries(value).find(([key]) => key === "message")?.[1];
  if (typeof message === "string") {
    return sanitizeMessage(message);
  }
  if (Array.isArray(message) && message.every((entry) => typeof entry === "string")) {
    return sanitizeMessage(message.join(" "));
  }
  return null;
}

async function toErrorResponse(response: Response): Promise<Response> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const message = readErrorMessage(await response.json());
    return Response.json({ message: message ?? "The Phase 0 API request failed." }, { status: response.status });
  }
  return Response.json(
    { message: sanitizeMessage(await response.text()) },
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
