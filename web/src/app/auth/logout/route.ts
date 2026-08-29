import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { requestAuthBackend } from "@/lib/auth/backend-client";
import { validateBrowserMutation } from "@/lib/auth/request-security";

export async function POST(request: Request): Promise<Response> {
  const rejected = validateBrowserMutation(request);
  if (rejected) return rejected;
  const accessToken = (await cookies()).get("lp_access")?.value;
  if (accessToken) await requestAuthBackend({ authorization: `Bearer ${accessToken}`, method: "POST", path: "/api/v1/auth/logout" });
  const response = NextResponse.json({ ok: true });
  response.cookies.delete("lp_access");
  response.cookies.delete("lp_refresh");
  return response;
}
