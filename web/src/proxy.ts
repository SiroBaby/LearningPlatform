import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { requestAuthBackend } from "@/lib/auth/backend-client";
import { getWebPublicUrl } from "@/lib/auth/public-origin";

async function hasValidAccessSession(request: NextRequest): Promise<boolean> {
  const accessToken = request.cookies.get("lp_access")?.value;
  if (!accessToken) return false;

  try {
    const response = await requestAuthBackend({
      authorization: `Bearer ${accessToken}`,
      method: "GET",
      path: "/internal/v1/auth/me",
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Reject unauthenticated requests before rendering a private App Router route. */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  if (await hasValidAccessSession(request)) return NextResponse.next();
  return NextResponse.redirect(getWebPublicUrl("/login"));
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/analytics/:path*",
    "/billing/:path*",
    "/courses/:path*",
    "/exam/:path*",
    "/flashcards/:path*",
    "/home/:path*",
    "/library/:path*",
    "/notifications/:path*",
    "/onboarding/:path*",
    "/processing/:path*",
    "/quiz/:path*",
    "/review/:path*",
    "/settings/:path*",
    "/study-plan/:path*",
    "/teacher/:path*",
    "/tutor/:path*",
    "/upload/:path*",
  ],
};
