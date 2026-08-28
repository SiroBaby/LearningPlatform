import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { requestAuthBackend } from "@/lib/auth/backend-client";

export async function POST(): Promise<Response> {
  const accessToken = (await cookies()).get("lp_access")?.value;
  if (accessToken) await requestAuthBackend({ authorization: `Bearer ${accessToken}`, method: "POST", path: "/api/v1/auth/logout" });
  const response = NextResponse.json({ ok: true });
  response.cookies.delete("lp_access");
  response.cookies.delete("lp_refresh");
  return response;
}
