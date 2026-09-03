import { mapSafeBackendError } from "@/lib/phase0/backend-error";

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function invalidAdminActionRequest(): Response {
  return Response.json(
    {
      code: "INVALID_REQUEST",
      message: "Thông tin thao tác chưa đúng",
      retryable: false,
    },
    { status: 400 },
  );
}

export async function readAdminActionBody(
  request: Request,
): Promise<
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly response: Response }
> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return { ok: false, response: invalidAdminActionRequest() };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, response: invalidAdminActionRequest() };
  }
  return { ok: true, value: value as Record<string, unknown> };
}

export async function safeAdminBackendError(response: Response): Promise<Response> {
  const contentType = response.headers.get("content-type") ?? "";
  let safeError: ReturnType<typeof mapSafeBackendError> = null;
  if (contentType.includes("application/json")) {
    try {
      safeError = mapSafeBackendError(await response.json());
    } catch {
      safeError = null;
    }
  }

  const fallbackCode = response.status === 401
    ? "SESSION_INVALID"
    : response.status === 403
      ? "ADMIN_FORBIDDEN"
      : response.status === 409
        ? "ADMIN_ACTION_CONFLICT"
        : response.status >= 500
          ? "ADMIN_BACKEND_UNAVAILABLE"
          : "ADMIN_ACTION_FAILED";
  const fallbackMessage = response.status === 401
    ? "Phiên đăng nhập không còn hiệu lực"
    : response.status === 403
      ? "Bạn không có quyền thực hiện thao tác này"
      : response.status === 409
        ? "Thao tác hiện chưa thể thực hiện. Hãy kiểm tra lại điều kiện và thử lại."
        : response.status >= 500
          ? "Dịch vụ quản trị đang tạm thời chưa sẵn sàng"
          : "Không thể thực hiện thao tác này";

  return Response.json(
    {
      code: safeError?.code ?? fallbackCode,
      message: safeError?.message ?? fallbackMessage,
      retryable: safeError?.retryable ?? response.status >= 500,
    },
    { status: response.status },
  );
}

export function invalidAdminActionResponse(status = 502): Response {
  return Response.json(
    {
      code: "ADMIN_INVALID_RESPONSE",
      message: "Dịch vụ quản trị trả về kết quả không hợp lệ",
      retryable: status >= 500,
    },
    { status },
  );
}
