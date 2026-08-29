import { NextResponse } from "next/server";

import { requestAuthBackend } from "@/lib/auth/backend-client";
import { getPostLoginRedirectPath } from "@/lib/auth/onboarding-redirect";
import { getWebPublicUrl } from "@/lib/auth/public-origin";

const isProduction = process.env.NODE_ENV === "production";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || url.searchParams.get("error")) {
    return NextResponse.redirect(getWebPublicUrl("/login?error=login_failed"));
  }
  const response = await requestAuthBackend({
    body: { code, state },
    method: "POST",
    path: "/api/v1/auth/google/exchange",
  });
  if (!response.ok) return NextResponse.redirect(getWebPublicUrl("/login?error=login_failed"));
  const session = (await response.json()) as {
    readonly accessToken?: string;
    readonly accessExpiresAt?: string;
    readonly refreshToken?: string;
    readonly refreshExpiresAt?: string;
  };
  if (!session.accessToken || !session.refreshToken || !session.accessExpiresAt || !session.refreshExpiresAt) {
    return NextResponse.redirect(getWebPublicUrl("/login?error=login_failed"));
  }
  const profileResponse = await requestAuthBackend({
    authorization: `Bearer ${session.accessToken}`,
    method: "GET",
    path: "/api/v1/auth/me",
  });
  const profile = profileResponse.ok ? await profileResponse.json() as {
    readonly onboardingCompletedAt?: string | null;
    readonly onboardingSkippedAt?: string | null;
  } : {};
  const redirect = NextResponse.redirect(getWebPublicUrl(getPostLoginRedirectPath(profile)));
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
