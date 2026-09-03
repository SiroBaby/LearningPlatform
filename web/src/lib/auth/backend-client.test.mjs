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

test("bounds the complete internal backend request, including a stalled response", () => {
  assert.match(source, /AUTH_BACKEND_REQUEST_TIMEOUT_MS/u);
  assert.match(source, /setTimeout\(\(\) => \{/u);
  assert.match(source, /requestHandle\.destroy\(error\)/u);
  assert.match(source, /response\.once\("error"/u);
  assert.match(source, /clearTimeout\(timeout\)/u);
});

test("preserves empty successful responses such as the bootstrap 204 contract", () => {
  assert.match(source, /RESPONSE_STATUSES_WITHOUT_BODY/u);
  assert.match(source, /RESPONSE_STATUSES_WITHOUT_BODY\.has\(status\) \? null/u);
  assert.match(source, /new Response\(body, \{ headers, status, statusText: response\.statusMessage \}\)/u);
  assert.match(source, /catch \(error: unknown\)/u);
});
