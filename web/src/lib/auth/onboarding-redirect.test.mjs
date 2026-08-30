import assert from "node:assert/strict";
import test from "node:test";

const { getPostLoginRedirectPath } = await import("./onboarding-redirect.ts");

test("sends an incomplete profile to onboarding after Google login", () => {
  assert.equal(getPostLoginRedirectPath({}), "/onboarding");
});

test("keeps completed and skipped profiles on home after Google login", () => {
  assert.equal(getPostLoginRedirectPath({ onboardingCompletedAt: "2026-08-29T15:00:00.000Z" }), "/home");
  assert.equal(getPostLoginRedirectPath({ onboardingSkippedAt: "2026-08-29T15:00:00.000Z" }), "/home");
});
