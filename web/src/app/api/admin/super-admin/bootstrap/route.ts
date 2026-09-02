import { requestAuthenticatedBackend } from "@/lib/auth/backend-client";
import { validateBrowserMutation } from "@/lib/auth/request-security";
import { safeAdminBackendError } from "@/lib/admin/action-route";

export async function POST(request: Request): Promise<Response> {
  const rejected = validateBrowserMutation(request);
  if (rejected) return rejected;

  const response = await requestAuthenticatedBackend({
    method: "POST",
    path: "/api/v1/admin/super-admin/bootstrap",
  });
  if (!response.ok) return safeAdminBackendError(response);
  if (response.status !== 204) {
    return Response.json(
      {
        code: "ADMIN_INVALID_RESPONSE",
        message: "Dịch vụ quản trị trả về kết quả không hợp lệ",
        retryable: true,
      },
      { status: 502 },
    );
  }
  return new Response(null, { status: 204 });
}
