import { requestAuthenticatedBackend } from "@/lib/auth/backend-client";
import { validateBrowserMutation } from "@/lib/auth/request-security";
import { parseAdminRoleChangeRequestList } from "@/lib/admin/operations-contract";
import {
  invalidAdminActionRequest,
  invalidAdminActionResponse,
  readAdminActionBody,
  safeAdminBackendError,
  UUID_PATTERN,
} from "@/lib/admin/action-route";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "pending";
  const limit = url.searchParams.get("limit") ?? "50";
  if (status !== "pending" || !/^[1-9][0-9]?$/u.test(limit) || Number(limit) > 50) {
    return invalidAdminActionRequest();
  }

  const response = await requestAuthenticatedBackend({
    method: "GET",
    path: `/api/v1/admin/super-admin/role-change-requests?status=pending&limit=${limit}`,
  });
  if (!response.ok) return safeAdminBackendError(response);
  try {
    const payload: unknown = await response.json();
    const list = parseAdminRoleChangeRequestList(payload);
    return list
      ? Response.json(list, { status: response.status })
      : invalidAdminActionResponse();
  } catch {
    return invalidAdminActionResponse();
  }
}

export async function POST(request: Request): Promise<Response> {
  const rejected = validateBrowserMutation(request);
  if (rejected) return rejected;

  const parsed = await readAdminActionBody(request);
  if (!parsed.ok) return parsed.response;
  const targetUserId = parsed.value.targetUserId;
  const desiredRole = parsed.value.desiredRole;
  if (
    typeof targetUserId !== "string" ||
    !UUID_PATTERN.test(targetUserId) ||
    (desiredRole !== "ADMIN" && desiredRole !== "SUPER_ADMIN")
  ) {
    return invalidAdminActionRequest();
  }

  const response = await requestAuthenticatedBackend({
    method: "POST",
    path: "/api/v1/admin/super-admin/role-change-requests",
    body: { targetUserId, desiredRole },
  });
  if (!response.ok) return safeAdminBackendError(response);
  try {
    const value: unknown = await response.json();
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      typeof (value as { requestId?: unknown }).requestId !== "string" ||
      !UUID_PATTERN.test((value as { requestId: string }).requestId)
    ) {
      return invalidAdminActionResponse();
    }
    return Response.json(
      { requestId: (value as { requestId: string }).requestId },
      { status: response.status },
    );
  } catch {
    return invalidAdminActionResponse();
  }
}
