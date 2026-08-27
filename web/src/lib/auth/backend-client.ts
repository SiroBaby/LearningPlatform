import "server-only";

interface AuthBackendRequest {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly body?: unknown;
}

function getAuthBackendUrl(): string {
  const value = process.env.AUTH_INTERNAL_API_BASE_URL;
  if (!value) throw new Error("AUTH_INTERNAL_API_BASE_URL must be configured");
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("AUTH_INTERNAL_API_BASE_URL must use HTTP or HTTPS");
  }
  return url.toString().replace(/\/$/u, "");
}

export async function requestAuthBackend(request: AuthBackendRequest): Promise<Response> {
  const headers = new Headers();
  if (request.body !== undefined) headers.set("Content-Type", "application/json");
  try {
    return await fetch(`${getAuthBackendUrl()}${request.path}`, {
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      cache: "no-store",
      headers,
      method: request.method,
    });
  } catch {
    return Response.json({ code: "AUTH_PROVIDER_UNAVAILABLE", message: "Không thể đăng nhập bằng tài khoản này" }, { status: 502 });
  }
}
