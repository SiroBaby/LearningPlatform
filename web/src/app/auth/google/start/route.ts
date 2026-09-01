import { NextResponse } from "next/server";

import { requestAuthBackend } from "@/lib/auth/backend-client";
import { getWebPublicUrl } from "@/lib/auth/public-origin";

export async function GET(request: Request): Promise<Response> {
  const loginHint = new URL(request.url).searchParams.get("login_hint")?.trim();
  const response = await requestAuthBackend({
    body: loginHint ? { login_hint: loginHint } : {},
    method: "POST",
    path: "/internal/v1/auth/google/start",
  });
  if (!response.ok) return NextResponse.redirect(getWebPublicUrl("/login?error=login_failed"));
  const body = (await response.json()) as { readonly authorizationUrl?: string };
  if (!body.authorizationUrl) return NextResponse.redirect(getWebPublicUrl("/login?error=login_failed"));
  return NextResponse.redirect(body.authorizationUrl);
}
