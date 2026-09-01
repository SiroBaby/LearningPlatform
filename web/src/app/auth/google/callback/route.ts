import { NextResponse } from "next/server";

import { requestAuthBackend } from "@/lib/auth/backend-client";
import { getPostLoginRedirectPath } from "@/lib/auth/onboarding-redirect";
import {
  matchesOAuthBrowserBinding,
  OAUTH_BROWSER_BINDING_COOKIE,
  OAUTH_BROWSER_BINDING_PATH,
} from "@/lib/auth/oauth-browser-binding";
import { getWebPublicUrl } from "@/lib/auth/public-origin";
import { cookies } from "next/headers";

const isProduction = process.env.NODE_ENV === "production";

function redirectToLogin(): Response {
  const response = NextResponse.redirect(getWebPublicUrl("/login?error=login_failed"));
  response.cookies.set(OAUTH_BROWSER_BINDING_COOKIE, "", {
    expires: new Date(0),
    httpOnly: true,
    maxAge: 0,
    sameSite: "lax",
    secure: isProduction,
    path: OAUTH_BROWSER_BINDING_PATH,
  });
  return response;
}

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const browserBinding = (await cookies()).get(OAUTH_BROWSER_BINDING_COOKIE)?.value;
    if (!code || !state || url.searchParams.get("error")) {
      return redirectToLogin();
    }
    if (!matchesOAuthBrowserBinding(browserBinding, state)) {
      return redirectToLogin();
    }
    const response = await requestAuthBackend({
      body: { code, state },
      method: "POST",
      path: "/internal/v1/auth/google/exchange",
    });
    if (!response.ok) return redirectToLogin();
    const session = (await response.json()) as {
      readonly accessToken?: string;
      readonly accessExpiresAt?: string;
      readonly refreshToken?: string;
      readonly refreshExpiresAt?: string;
    };
    if (!session.accessToken || !session.refreshToken || !session.accessExpiresAt || !session.refreshExpiresAt) {
      return redirectToLogin();
    }
    const profileResponse = await requestAuthBackend({
      authorization: `Bearer ${session.accessToken}`,
      method: "GET",
      path: "/internal/v1/auth/me",
    });
    const profile = profileResponse.ok ? await profileResponse.json() as {
      readonly onboardingCompletedAt?: string | null;
      readonly onboardingSkippedAt?: string | null;
    } : {};
    const redirect = NextResponse.redirect(getWebPublicUrl(getPostLoginRedirectPath(profile)));
    redirect.cookies.set(OAUTH_BROWSER_BINDING_COOKIE, "", {
      expires: new Date(0),
      httpOnly: true,
      maxAge: 0,
      sameSite: "lax",
      secure: isProduction,
      path: OAUTH_BROWSER_BINDING_PATH,
    });
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
  } catch {
    return redirectToLogin();
  }
}
