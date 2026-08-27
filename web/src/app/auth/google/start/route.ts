import { NextResponse } from "next/server";

import { requestAuthBackend } from "@/lib/auth/backend-client";

export async function GET(request: Request): Promise<Response> {
  const loginHint = new URL(request.url).searchParams.get("login_hint")?.trim();
  const path = loginHint
    ? `/api/v1/auth/google/start?login_hint=${encodeURIComponent(loginHint)}`
    : "/api/v1/auth/google/start";
  const response = await requestAuthBackend({ method: "GET", path });
  if (!response.ok) return NextResponse.redirect(new URL("/login?error=login_failed", request.url));
  const body = (await response.json()) as { readonly authorizationUrl?: string };
  if (!body.authorizationUrl) return NextResponse.redirect(new URL("/login?error=login_failed", request.url));
  return NextResponse.redirect(body.authorizationUrl);
}
