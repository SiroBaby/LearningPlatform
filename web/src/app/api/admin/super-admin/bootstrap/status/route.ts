import { requestAuthenticatedBackend } from "@/lib/auth/backend-client";
import { parseAdminSuperAdminBootstrapStatus } from "@/lib/admin/operations-contract";
import { invalidAdminActionResponse, safeAdminBackendError } from "@/lib/admin/action-route";

export async function GET(): Promise<Response> {
  const response = await requestAuthenticatedBackend({
    method: "GET",
    path: "/api/v1/admin/super-admin/bootstrap/status",
  });
  if (!response.ok) return safeAdminBackendError(response);
  try {
    const status = parseAdminSuperAdminBootstrapStatus(await response.json());
    return status
      ? Response.json(status, { status: response.status })
      : invalidAdminActionResponse();
  } catch {
    return invalidAdminActionResponse();
  }
}
