import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getWebPublicUrl } from "@/lib/auth/public-origin";

async function hasValidAccessSession(request: NextRequest): Promise<boolean> {
  const accessToken = request.cookies.get("lp_access")?.value;
  const apiBaseUrl = process.env.AUTH_INTERNAL_API_BASE_URL;
  if (!accessToken || !apiBaseUrl) return false;

  try {
    const response = await fetch(new URL("/api/v1/auth/me", apiBaseUrl), {
      cache: "no-store",
      headers: { Authorization: `Bearer ${accessToken}` },
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
