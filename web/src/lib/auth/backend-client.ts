import "server-only";

import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import type { ClientRequest } from "node:http";
import { cookies } from "next/headers";

interface AuthBackendRequest {
  readonly method: "GET" | "POST" | "PATCH";
  readonly path: string;
  readonly body?: unknown;
  readonly authorization?: string;
}

type AuthenticatedBackendRequest = Omit<AuthBackendRequest, "authorization">;

const SESSION_INVALID_ERROR = {
  code: "SESSION_INVALID",
  message: "Phiên đăng nhập không còn hiệu lực",
} as const;

function getAuthBackendUrl(): string {
  const value = process.env.AUTH_INTERNAL_API_BASE_URL;
  if (!value) throw new Error("AUTH_INTERNAL_API_BASE_URL must be configured");
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("AUTH_INTERNAL_API_BASE_URL must use HTTP or HTTPS");
  }
  return url.toString().replace(/\/$/u, "");
}

function getRequiredTlsPath(name: "AUTH_INTERNAL_MTLS_CA_PATH" | "AUTH_INTERNAL_MTLS_CERT_PATH" | "AUTH_INTERNAL_MTLS_KEY_PATH"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be configured for HTTPS auth backend`);
  return value;
}

function getRequestOptions(url: URL, request: AuthBackendRequest): RequestOptions {
  const options: RequestOptions = {
    headers: {
      ...(request.authorization ? { Authorization: request.authorization } : {}),
      ...(request.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    method: request.method,
    hostname: url.hostname,
    path: `${url.pathname}${url.search}`,
    port: url.port ? Number(url.port) : undefined,
  };
  if (url.protocol === "https:") {
    options.ca = readFileSync(getRequiredTlsPath("AUTH_INTERNAL_MTLS_CA_PATH"));
    options.cert = readFileSync(getRequiredTlsPath("AUTH_INTERNAL_MTLS_CERT_PATH"));
    options.key = readFileSync(getRequiredTlsPath("AUTH_INTERNAL_MTLS_KEY_PATH"));
    options.rejectUnauthorized = true;
  }
  return options;
}

function requestWithClient(url: URL, request: AuthBackendRequest): Promise<Response> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? httpsRequest : httpRequest;
    const requestHandle: ClientRequest = client(getRequestOptions(url, request), (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer | string) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => {
        const headers = new Headers();
        Object.entries(response.headers).forEach(([name, value]) => {
          if (typeof value === "string") headers.set(name, value);
          else if (Array.isArray(value)) headers.set(name, value.join(", "));
        });
        resolve(new Response(Buffer.concat(chunks), {
          headers,
          status: response.statusCode ?? 502,
          statusText: response.statusMessage,
        }));
      });
    });
    requestHandle.setTimeout(10_000, () => requestHandle.destroy(new Error("Auth backend request timed out")));
    requestHandle.once("error", reject);
    if (request.body !== undefined) requestHandle.write(JSON.stringify(request.body));
    requestHandle.end();
  });
}

export async function requestAuthBackend(request: AuthBackendRequest): Promise<Response> {
  try {
    const url = new URL(`${getAuthBackendUrl()}${request.path}`);
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
      throw new Error("AUTH_INTERNAL_API_BASE_URL must use HTTPS in production");
    }
    return await requestWithClient(url, request);
  } catch {
    return Response.json({ code: "AUTH_PROVIDER_UNAVAILABLE", message: "Không thể đăng nhập bằng tài khoản này" }, { status: 502 });
  }
}

export async function requestAuthenticatedBackend(
  request: AuthenticatedBackendRequest,
): Promise<Response> {
  const accessToken = (await cookies()).get("lp_access")?.value;
  if (!accessToken) return Response.json(SESSION_INVALID_ERROR, { status: 401 });
  return requestAuthBackend({
    ...request,
    authorization: `Bearer ${accessToken}`,
  });
}
