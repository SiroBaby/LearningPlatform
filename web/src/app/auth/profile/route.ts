import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { requestAuthBackend } from "@/lib/auth/backend-client";
import { validateBrowserMutation } from "@/lib/auth/request-security";

export async function PATCH(request: Request): Promise<Response> {
  const rejected = validateBrowserMutation(request);
  if (rejected) return rejected;
  const accessToken = (await cookies()).get("lp_access")?.value;
  if (!accessToken) return NextResponse.json({ code: "SESSION_INVALID", message: "Phiên đăng nhập không còn hiệu lực" }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "INVALID_REQUEST", message: "Dữ liệu không hợp lệ" }, { status: 400 });
  }
  const response = await requestAuthBackend({ authorization: `Bearer ${accessToken}`, body, method: "PATCH", path: "/api/v1/auth/profile" });
  if (!response.ok) return NextResponse.json({ code: response.status === 401 ? "SESSION_INVALID" : "PROFILE_UPDATE_FAILED", message: response.status === 401 ? "Phiên đăng nhập không còn hiệu lực" : "Không thể lưu thông tin tài khoản" }, { status: response.status === 401 ? 401 : 400 });
  return NextResponse.json(await response.json(), { status: 200 });
}
