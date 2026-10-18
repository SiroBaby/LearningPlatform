import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { requestAuthBackend } from "@/lib/auth/backend-client";
import { isAuthEntryPath } from "@/lib/auth/auth-page-redirect";
import { getWebPublicUrl } from "@/lib/auth/public-origin";

interface RefreshedSession {
  readonly accessToken: string;
  readonly accessExpiresAt: string;
  readonly refreshToken: string;
  readonly refreshExpiresAt: string;
}

type AccessSessionStatus = "missing" | "valid" | "invalid" | "unavailable";

const REFRESH_SUCCESS_GRACE_MS = 5_000;
const AUTH_ENTRY_SESSION_CHECK_TIMEOUT_MS = 1_500;
const refreshFlights = new Map<string, Promise<RefreshedSession | null>>();

async function getAccessSessionStatus(request: NextRequest, timeoutMs?: number): Promise<AccessSessionStatus> {
  const accessToken = request.cookies.get("lp_access")?.value;
  if (!accessToken) return "missing";

  try {
    const response = await requestAuthBackend({
      authorization: `Bearer ${accessToken}`,
      method: "GET",
      path: "/internal/v1/auth/me",
      timeoutMs,
    });
    if (response.ok) return "valid";
    return response.status === 401 ? "invalid" : "unavailable";
  } catch {
    return "unavailable";
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(new Date(value).getTime());
}

function isRefreshedSession(session: unknown): session is RefreshedSession {
  if (!session || typeof session !== "object") return false;
  const candidate = session as Partial<RefreshedSession>;
  return isNonEmptyString(candidate.accessToken)
    && isValidDate(candidate.accessExpiresAt)
    && isNonEmptyString(candidate.refreshToken)
    && isValidDate(candidate.refreshExpiresAt);
}

function setSessionCookies(response: NextResponse, session: RefreshedSession): void {
  response.cookies.set("lp_access", session.accessToken, {
    expires: new Date(session.accessExpiresAt),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  response.cookies.set("lp_refresh", session.refreshToken, {
    expires: new Date(session.refreshExpiresAt),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

function isApiRequest(request: NextRequest): boolean {
  const pathname = request.nextUrl.pathname;
  return pathname.startsWith("/api/") || pathname === "/auth/me" || pathname === "/auth/profile";
}

function sessionInvalidApiResponse(): NextResponse {
  return NextResponse.json(
    { code: "SESSION_INVALID", message: "Phiên đăng nhập không còn hiệu lực" },
    { status: 401 },
  );
}

function authBackendUnavailableApiResponse(): NextResponse {
  return NextResponse.json(
    {
      code: "AUTH_BACKEND_UNAVAILABLE",
      message: "Dịch vụ xác thực tạm thời không khả dụng",
      retryable: true,
    },
    { status: 503 },
  );
}

async function requestRefreshedSession(refreshToken: string): Promise<RefreshedSession | null> {
  try {
    const response = await requestAuthBackend({
      authorization: `Bearer ${refreshToken}`,
      method: "POST",
      path: "/internal/v1/auth/refresh",
    });
    if (!response.ok) return null;
    const session: unknown = await response.json();
    if (!isRefreshedSession(session)) return null;
    return session;
  } catch {
    return null;
  }
}

function getRefreshFlight(refreshToken: string): Promise<RefreshedSession | null> {
  const key = createHash("sha256").update(refreshToken, "utf8").digest("hex");
  const existing = refreshFlights.get(key);
  if (existing) return existing;

  const refresh = requestRefreshedSession(refreshToken);
  refreshFlights.set(key, refresh);
  refresh.then(
    (session) => {
      if (refreshFlights.get(key) !== refresh) return;
      if (!session) {
        refreshFlights.delete(key);
        return;
      }
      const cleanupTimer = setTimeout(() => {
        if (refreshFlights.get(key) === refresh) refreshFlights.delete(key);
      }, REFRESH_SUCCESS_GRACE_MS);
      if (typeof cleanupTimer === "object" && cleanupTimer !== null && "unref" in cleanupTimer && typeof cleanupTimer.unref === "function") {
        cleanupTimer.unref();
      }
    },
    () => {
      if (refreshFlights.get(key) === refresh) refreshFlights.delete(key);
    },
  );
  return refresh;
}

async function refreshAccessSession(request: NextRequest): Promise<NextResponse | null> {
  const refreshToken = request.cookies.get("lp_refresh")?.value;
  if (!refreshToken) return null;

  const session = await getRefreshFlight(refreshToken);
  if (!session) return null;
  const redirect = NextResponse.redirect(getWebPublicUrl(`${request.nextUrl.pathname}${request.nextUrl.search}`));
  setSessionCookies(redirect, session);
  return redirect;
}

/**
 * Login/signup are public: guests (no cookies) pass through without a backend call, and a failed or
 * unavailable refresh never redirects, so the entry page cannot loop through `/login`.
 * The `/auth/me` check uses the same short timeout as the page-level display check.
 */
async function handleAuthEntryRequest(request: NextRequest): Promise<NextResponse> {
  const hasSessionCookie = Boolean(request.cookies.get("lp_access")?.value || request.cookies.get("lp_refresh")?.value);
  if (!hasSessionCookie) return NextResponse.next();
  const accessSessionStatus = await getAccessSessionStatus(request, AUTH_ENTRY_SESSION_CHECK_TIMEOUT_MS);
  if (accessSessionStatus === "valid" || accessSessionStatus === "unavailable") return NextResponse.next();
  return (await refreshAccessSession(request)) ?? NextResponse.next();
}

/** Reject unauthenticated requests before rendering a private App Router route. */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  if (isAuthEntryPath(request.nextUrl.pathname)) return handleAuthEntryRequest(request);
  const apiRequest = isApiRequest(request);
  const accessSessionStatus = await getAccessSessionStatus(request);
  if (accessSessionStatus === "valid") return NextResponse.next();
  if (accessSessionStatus === "unavailable") {
    return apiRequest
      ? authBackendUnavailableApiResponse()
      : NextResponse.redirect(getWebPublicUrl("/login"));
  }
  const refreshed = await refreshAccessSession(request);
  if (refreshed) return refreshed;
  return apiRequest
    ? sessionInvalidApiResponse()
    : NextResponse.redirect(getWebPublicUrl("/login"));
}

export const config = {
  matcher: [
    "/api/:path*",
    "/admin/:path*",
    "/analytics/:path*",
    "/billing/:path*",
    "/courses/:path*",
    "/exam/:path*",
    "/flashcards/:path*",
    "/home/:path*",
    "/library/:path*",
    "/login",
    "/notifications/:path*",
    "/onboarding/:path*",
    "/processing/:path*",
    "/quiz/:path*",
    "/review/:path*",
    "/settings/:path*",
    "/signup",
    "/study-plan/:path*",
    "/teacher/:path*",
    "/tutor/:path*",
    "/upload/:path*",
    "/auth/me",
    "/auth/profile",
  ],
};
