import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { requestAuthBackend } from "@/lib/auth/backend-client";

export async function GET(): Promise<Response> {
  const accessToken = (await cookies()).get("lp_access")?.value;
  if (!accessToken) return NextResponse.json({ code: "SESSION_INVALID", message: "Phiên đăng nhập không còn hiệu lực" }, { status: 401 });
  const response = await requestAuthBackend({ authorization: `Bearer ${accessToken}`, method: "GET", path: "/api/v1/auth/me" });
  if (!response.ok) return NextResponse.json({ code: "SESSION_INVALID", message: "Phiên đăng nhập không còn hiệu lực" }, { status: 401 });
  return NextResponse.json(await response.json(), { status: 200 });
}
