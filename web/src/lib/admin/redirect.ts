import { routes } from "@/lib/routes";

export type AdminRedirectKind = "unauthenticated" | "forbidden" | "unavailable" | "snapshot";
export type AdminAccessKind = "allowed" | "unauthenticated" | "forbidden" | "unavailable";

export function getAdminRedirectPath(kind: AdminRedirectKind): string | null {
  if (kind === "unauthenticated") return routes.login;
  if (kind === "forbidden") return routes.accessDenied;
  return null;
}

/** Admin pages fail closed when the backend cannot confirm the current role. */
export function getAdminAccessRedirectPath(kind: AdminAccessKind): string | null {
  if (kind === "allowed") return null;
  if (kind === "unauthenticated") return routes.login;
  return routes.accessDenied;
}
