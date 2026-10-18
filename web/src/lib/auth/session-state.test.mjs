import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";

const { isSignedInSessionState } = await import("./session-state.ts");

test("public navigation treats every non-guest state as signed in", () => {
  assert.equal(isSignedInSessionState("authenticated"), true);
  assert.equal(isSignedInSessionState("refreshable"), true);
  assert.equal(isSignedInSessionState("unavailable"), true);
  assert.equal(isSignedInSessionState("guest"), false);
});

test("proxy matcher covers login and signup so expired sessions can refresh there", () => {
  const proxySource = readFileSync(resolve(dirname(import.meta.filename), "../../proxy.ts"), "utf8");
  assert.match(proxySource, /"\/login",/u);
  assert.match(proxySource, /"\/signup",/u);
});
