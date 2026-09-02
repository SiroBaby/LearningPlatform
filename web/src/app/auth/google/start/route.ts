import { NextResponse } from "next/server";

import { requestAuthBackend } from "@/lib/auth/backend-client";
import { getWebPublicUrl } from "@/lib/auth/public-origin";
import {
  createOAuthBrowserBinding,
  getOAuthBrowserBindingCookieName,
  OAUTH_BROWSER_BINDING_PATH,
  OAUTH_BROWSER_BINDING_TTL_SECONDS,
} from "@/lib/auth/oauth-browser-binding";

const isProduction = process.env.NODE_ENV === "production";

function redirectToLogin(): Response {
  const response = NextResponse.redirect(getWebPublicUrl("/login?error=login_failed"));
  return response;
}

export async function GET(request: Request): Promise<Response> {
  const loginHint = new URL(request.url).searchParams.get("login_hint")?.trim();
  const response = await requestAuthBackend({
    body: loginHint ? { login_hint: loginHint } : {},
    method: "POST",
    path: "/internal/v1/auth/google/start",
  });
  if (!response.ok) return redirectToLogin();
  let body: { readonly authorizationUrl?: string };
  try {
    body = (await response.json()) as { readonly authorizationUrl?: string };
  } catch {
    return redirectToLogin();
  }
  if (!body.authorizationUrl) return redirectToLogin();

  let state: string | null;
  try {
    state = new URL(body.authorizationUrl).searchParams.get("state");
  } catch {
    state = null;
  }
  if (!state) return redirectToLogin();

  const redirect = NextResponse.redirect(body.authorizationUrl);
  redirect.cookies.set(getOAuthBrowserBindingCookieName(state), createOAuthBrowserBinding(state), {
    httpOnly: true,
    maxAge: OAUTH_BROWSER_BINDING_TTL_SECONDS,
    sameSite: "lax",
    secure: isProduction,
    path: OAUTH_BROWSER_BINDING_PATH,
  });
  return redirect;
}
