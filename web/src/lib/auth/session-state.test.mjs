import assert from "node:assert/strict";
import test from "node:test";

const { isSignedInSessionState } = await import("./session-state.ts");

test("public navigation treats every non-guest state as signed in", () => {
  assert.equal(isSignedInSessionState("authenticated"), true);
  assert.equal(isSignedInSessionState("refreshable"), true);
  assert.equal(isSignedInSessionState("unavailable"), true);
  assert.equal(isSignedInSessionState("guest"), false);
});
