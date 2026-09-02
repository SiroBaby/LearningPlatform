import "server-only";

import { requestAuthenticatedBackend } from "@/lib/auth/backend-client";
import {
  mapAdminOperationsResponse,
  parseAdminSuperAdminBootstrapStatus,
  type AdminSuperAdminBootstrapStatus,
  parseAdminRoleChangeRequestList,
  type AdminOperationsResult,
  type AdminRoleChangeRequestList,
} from "@/lib/admin/operations-contract";

export type { AdminOperationsSnapshot, AdminOperationsState } from "@/lib/admin/operations-contract";
export { parseAdminOperationsSnapshot } from "@/lib/admin/operations-contract";
export { parseAdminRoleChangeRequestList } from "@/lib/admin/operations-contract";
export { parseAdminSuperAdminBootstrapStatus } from "@/lib/admin/operations-contract";

export type AdminActorRole = "ADMIN" | "SUPER_ADMIN";

export type AdminAccessResult =
  | { readonly kind: "allowed"; readonly role: AdminActorRole }
  | { readonly kind: "unauthenticated" | "forbidden" | "unavailable" };

export async function getAdminAccess(): Promise<AdminAccessResult> {
  try {
    const response = await requestAuthenticatedBackend({
      method: "GET",
      path: "/internal/v1/auth/me",
    });
    if (response.status === 401) return { kind: "unauthenticated" };
    if (response.status === 403) return { kind: "forbidden" };
    if (!response.ok) return { kind: "unavailable" };

    const payload: unknown = await response.json();
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return { kind: "unavailable" };
    }
    const role = (payload as { role?: unknown }).role;
    if (role === "ADMIN" || role === "SUPER_ADMIN") return { kind: "allowed", role };
    if (typeof role === "string") return { kind: "forbidden" };
    return { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

export async function getAdminActorRole(): Promise<AdminActorRole | null> {
  const access = await getAdminAccess();
  return access.kind === "allowed" ? access.role : null;
}

export async function getAdminOperations(): Promise<AdminOperationsResult> {
  try {
    const response = await requestAuthenticatedBackend({
      method: "GET",
      path: "/api/v1/admin/operations",
    });
    return mapAdminOperationsResponse(response.status, await response.json());
  } catch {
    return { kind: "unavailable" };
  }
}

export async function getAdminRoleChangeRequests(): Promise<AdminRoleChangeRequestList | null> {
  try {
    const response = await requestAuthenticatedBackend({
      method: "GET",
      path: "/api/v1/admin/super-admin/role-change-requests?status=pending&limit=50",
    });
    if (!response.ok) return null;
    return parseAdminRoleChangeRequestList(await response.json());
  } catch {
    return null;
  }
}

export async function getAdminSuperAdminBootstrapStatus(): Promise<AdminSuperAdminBootstrapStatus | null> {
  try {
    const response = await requestAuthenticatedBackend({
      method: "GET",
      path: "/api/v1/admin/super-admin/bootstrap/status",
    });
    if (!response.ok) return null;
    return parseAdminSuperAdminBootstrapStatus(await response.json());
  } catch {
    return null;
  }
}

/** Compatibility wrapper for pages that only need to know whether first bootstrap is visible. */
export async function getAdminSuperAdminBootstrapAvailability(): Promise<boolean> {
  const status = await getAdminSuperAdminBootstrapStatus();
  return status?.mode === "FIRST_BOOTSTRAP";
}
