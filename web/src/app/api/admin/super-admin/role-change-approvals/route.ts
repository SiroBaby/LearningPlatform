import { requestAuthenticatedBackend } from "@/lib/auth/backend-client";
import { validateBrowserMutation } from "@/lib/auth/request-security";
import {
  invalidAdminActionRequest,
  invalidAdminActionResponse,
  readAdminActionBody,
  safeAdminBackendError,
  UUID_PATTERN,
} from "@/lib/admin/action-route";

export async function POST(request: Request): Promise<Response> {
  const rejected = validateBrowserMutation(request);
  if (rejected) return rejected;

  const parsed = await readAdminActionBody(request);
  if (!parsed.ok) return parsed.response;
  const requestId = parsed.value.requestId;
  if (typeof requestId !== "string" || !UUID_PATTERN.test(requestId)) {
    return invalidAdminActionRequest();
  }

  const response = await requestAuthenticatedBackend({
    method: "POST",
    path: "/api/v1/admin/super-admin/role-change-approvals",
    body: { requestId },
  });
  if (!response.ok) return safeAdminBackendError(response);
  try {
    const value: unknown = await response.json();
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      typeof (value as { completed?: unknown }).completed !== "boolean"
    ) {
      return invalidAdminActionResponse();
    }
    return Response.json(
      { completed: (value as { completed: boolean }).completed },
      { status: response.status },
    );
  } catch {
    return invalidAdminActionResponse();
  }
}
