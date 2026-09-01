import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";

const source = readFileSync(resolve(dirname(import.meta.filename), "backend-client.ts"), "utf8");
const phase0Source = readFileSync(resolve(dirname(import.meta.filename), "../phase0/backend-client.ts"), "utf8");
const legacyOwnerHeader = ["X-User", "Id"].join("-");
const legacyOwnerEnvironment = ["PHASE0", "DEV", "OWNER", "ID"].join("_");

test("forwards the host-only access cookie as a bearer token", () => {
  assert.match(source, /cookies\(\)\)\.get\("lp_access"\)/u);
  assert.match(source, /authorization: `Bearer \$\{accessToken\}`/u);
  assert.match(source, /if \(!accessToken\) return Response\.json\(SESSION_INVALID_ERROR, \{ status: 401 \}\)/u);
  assert.doesNotMatch(source, new RegExp(`${legacyOwnerHeader}|${legacyOwnerEnvironment}`, "u"));
});

test("does not expose the legacy owner-id configuration in the web runtime", () => {
  const configExample = readFileSync(resolve(dirname(import.meta.filename), "../../../.env.example"), "utf8");
  assert.doesNotMatch(configExample, new RegExp(`${legacyOwnerEnvironment}|${legacyOwnerHeader}`, "u"));
});

test("routes protected Phase 0 requests through the versioned internal API", () => {
  assert.match(phase0Source, /requestAuthenticatedPhase0Backend/u);
  assert.match(phase0Source, /path: `\$\{API_PREFIX\}\$\{request\.path\}`/u);
  assert.doesNotMatch(phase0Source, new RegExp(`${legacyOwnerHeader}|${legacyOwnerEnvironment}`, "u"));
});
