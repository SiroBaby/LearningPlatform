import "server-only";

import { cookies } from "next/headers";

import { requestAuthBackend } from "./backend-client";
import { isSignedInSessionState } from "./session-state";
import type { SessionState } from "./session-state";

const SESSION_CHECK_TIMEOUT_MS = 1_500;

/**
 * Resolves the session for server-rendered pages without refreshing tokens.
 * Refresh stays single-flight in `proxy.ts`; this only reports what the cookies imply.
 */
export async function resolveSessionState(): Promise<SessionState> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("lp_access")?.value;
  const hasRefreshToken = Boolean(cookieStore.get("lp_refresh")?.value);
  if (!accessToken) return hasRefreshToken ? "refreshable" : "guest";

  try {
    const response = await requestAuthBackend({
      authorization: `Bearer ${accessToken}`,
      method: "GET",
      path: "/internal/v1/auth/me",
      timeoutMs: SESSION_CHECK_TIMEOUT_MS,
    });
    if (response.ok) return "authenticated";
    if (response.status === 401) return hasRefreshToken ? "refreshable" : "guest";
  } catch {
    // Fall through: an auth backend failure must never break public pages.
  }
  return "unavailable";
}

/** True only when Nest confirmed the access session; used to keep signed-in users out of login. */
export async function hasAuthenticatedSession(): Promise<boolean> {
  return (await resolveSessionState()) === "authenticated";
}

/** True when the visitor holds a session that is valid or can still be refreshed; used by public navigation. */
export async function hasSignedInSession(): Promise<boolean> {
  return isSignedInSessionState(await resolveSessionState());
}
