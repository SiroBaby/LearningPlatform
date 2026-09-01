import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { requestAuthBackend } from "@/lib/auth/backend-client";
import { validateBrowserMutation } from "@/lib/auth/request-security";

const isProduction = process.env.NODE_ENV === "production";

export async function POST(request: Request): Promise<Response> {
  const rejected = validateBrowserMutation(request);
  if (rejected) return rejected;
  const refreshToken = (await cookies()).get("lp_refresh")?.value;
  if (!refreshToken) return NextResponse.json({ code: "SESSION_INVALID", message: "Phiên đăng nhập không còn hiệu lực" }, { status: 401 });
  const response = await requestAuthBackend({ authorization: `Bearer ${refreshToken}`, method: "POST", path: "/internal/v1/auth/refresh" });
  if (!response.ok) return NextResponse.json({ code: "SESSION_INVALID", message: "Phiên đăng nhập không còn hiệu lực" }, { status: 401 });
  const session = (await response.json()) as { accessToken?: string; accessExpiresAt?: string; refreshToken?: string; refreshExpiresAt?: string };
  if (!session.accessToken || !session.refreshToken || !session.accessExpiresAt || !session.refreshExpiresAt) {
    return NextResponse.json({ code: "SESSION_INVALID", message: "Phiên đăng nhập không còn hiệu lực" }, { status: 401 });
  }
  const result = NextResponse.json({ ok: true });
  result.cookies.set("lp_access", session.accessToken, { expires: new Date(session.accessExpiresAt), httpOnly: true, sameSite: "lax", secure: isProduction, path: "/" });
  result.cookies.set("lp_refresh", session.refreshToken, { expires: new Date(session.refreshExpiresAt), httpOnly: true, sameSite: "lax", secure: isProduction, path: "/" });
  return result;
}
