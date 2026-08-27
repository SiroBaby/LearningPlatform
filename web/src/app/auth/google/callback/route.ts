import { NextResponse } from "next/server";

import { requestAuthBackend } from "@/lib/auth/backend-client";

const isProduction = process.env.NODE_ENV === "production";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || url.searchParams.get("error")) {
    return NextResponse.redirect(new URL("/login?error=login_failed", request.url));
  }
  const response = await requestAuthBackend({
    body: { code, state },
    method: "POST",
    path: "/api/v1/auth/google/exchange",
  });
  if (!response.ok) return NextResponse.redirect(new URL("/login?error=login_failed", request.url));
  const session = (await response.json()) as {
    readonly accessToken?: string;
    readonly accessExpiresAt?: string;
    readonly refreshToken?: string;
    readonly refreshExpiresAt?: string;
  };
  if (!session.accessToken || !session.refreshToken || !session.accessExpiresAt || !session.refreshExpiresAt) {
    return NextResponse.redirect(new URL("/login?error=login_failed", request.url));
  }
  const redirect = NextResponse.redirect(new URL("/home", request.url));
  redirect.cookies.set("lp_access", session.accessToken, {
    expires: new Date(session.accessExpiresAt),
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: "/",
  });
  redirect.cookies.set("lp_refresh", session.refreshToken, {
    expires: new Date(session.refreshExpiresAt),
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: "/",
  });
  return redirect;
}
