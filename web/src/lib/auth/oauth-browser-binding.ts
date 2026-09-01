import { createHash, timingSafeEqual } from "node:crypto";

export const OAUTH_BROWSER_BINDING_COOKIE = "lp_oauth_browser_binding";
export const OAUTH_BROWSER_BINDING_PATH = "/auth/google";
export const OAUTH_BROWSER_BINDING_TTL_SECONDS = 10 * 60;

/** Store a one-way transaction handle so the callback must return to the browser that started OAuth. */
export function createOAuthBrowserBinding(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("base64url");
}

export function matchesOAuthBrowserBinding(binding: string | undefined, state: string): boolean {
  if (!binding) return false;
  const expected = Buffer.from(createOAuthBrowserBinding(state), "utf8");
  const actual = Buffer.from(binding, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
