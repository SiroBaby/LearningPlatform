import { requestAuthenticatedBackend } from "@/lib/auth/backend-client";
import { validateBrowserMutation } from "@/lib/auth/request-security";
import {
  invalidAdminActionRequest,
  invalidAdminActionResponse,
  readAdminActionBody,
  safeAdminBackendError,
} from "@/lib/admin/action-route";

const MAX_APPROVAL_TOKEN_LENGTH = 8_192;

export async function POST(request: Request): Promise<Response> {
  const rejected = validateBrowserMutation(request);
  if (rejected) return rejected;

  const parsed = await readAdminActionBody(request);
  if (!parsed.ok) return parsed.response;
  const approvalToken = parsed.value.approvalToken;
  if (
    typeof approvalToken !== "string" ||
    approvalToken.trim().length === 0 ||
    approvalToken.length > MAX_APPROVAL_TOKEN_LENGTH
  ) {
    return invalidAdminActionRequest();
  }

  const response = await requestAuthenticatedBackend({
    method: "POST",
    path: "/api/v1/admin/super-admin/break-glass",
    body: { approvalToken },
  });
  if (!response.ok) return safeAdminBackendError(response);
  if (response.status !== 204) return invalidAdminActionResponse();
  return new Response(null, { status: 204 });
}
