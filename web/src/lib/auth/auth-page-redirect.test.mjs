import assert from "node:assert/strict";
import test from "node:test";

const { AUTH_ENTRY_PATHS, getAuthEntryRedirectPath, isAuthEntryPath } = await import("./auth-page-redirect.ts");

test("keeps unauthenticated visitors on Google auth entry pages", () => {
  assert.equal(getAuthEntryRedirectPath(false), null);
});

test("redirects authenticated visitors from auth entry pages to home", () => {
  assert.deepEqual(AUTH_ENTRY_PATHS, ["/login", "/signup"]);
  assert.equal(getAuthEntryRedirectPath(true), "/home");
  assert.equal(isAuthEntryPath("/auth/google/callback"), false);
});
