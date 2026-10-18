/**
 * - authenticated: Nest confirmed the access token.
 * - refreshable: access token missing/expired but a refresh cookie exists; proxy renews it on private routes.
 * - unavailable: cookies exist but the auth backend could not answer in time.
 * - guest: no usable cookies.
 */
export type SessionState = "authenticated" | "refreshable" | "unavailable" | "guest";

/** Public navigation shows the signed-in menu unless the visitor is certainly a guest. */
export function isSignedInSessionState(state: SessionState): boolean {
  return state !== "guest";
}
