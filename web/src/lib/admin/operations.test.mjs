import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";

const {
  mapAdminOperationsResponse,
  parseAdminRoleChangeRequestList,
  parseAdminOperationsSnapshot,
  parseAdminSuperAdminBootstrapStatus,
} = await import("./operations-contract.ts");

const validSnapshot = {
  failureClasses: [{ count: 2, failureCode: "PROVIDER_TIMEOUT" }],
  health: "healthy",
  jobSummary: [
    { count: 3, status: "PENDING" },
    { count: 1, status: "FAILED" },
  ],
  readiness: "ready",
  resources: ["processingJobs"],
};

test("parses only the approved redacted operations snapshot", () => {
  assert.deepEqual(parseAdminOperationsSnapshot(validSnapshot), {
    failures: [{ code: "PROVIDER_TIMEOUT", count: 2 }],
    health: "healthy",
    jobs: { cancelled: 0, completed: 0, failed: 1, pending: 3, running: 0 },
    readiness: "healthy",
    resources: [{ name: "processing-jobs", status: "healthy" }],
  });
});

test("accepts cancelled processing jobs without exposing backend identifiers", () => {
  assert.deepEqual(parseAdminOperationsSnapshot({
    ...validSnapshot,
    jobSummary: [{ count: 4, status: "CANCELLED" }],
  })?.jobs, { cancelled: 4, completed: 0, failed: 0, pending: 0, running: 0 });
});

test("parses pending role-change cards and rejects expanded or malformed fields", () => {
  const request = {
    approvalCount: 1,
    canApprove: true,
    createdAt: "2026-09-02T08:00:00.000Z",
    desiredRole: "SUPER_ADMIN",
    id: "00000000-0000-0000-0000-000000000010",
    requesterId: "00000000-0000-0000-0000-000000000001",
    requiredApprovals: 2,
    targetUserId: "00000000-0000-0000-0000-000000000002",
    expiresAt: "2026-09-02T08:30:00.000Z",
  };
  assert.deepEqual(parseAdminRoleChangeRequestList({ items: [request], nextCursor: null }), {
    items: [request],
    nextCursor: null,
  });
  assert.equal(parseAdminRoleChangeRequestList({ items: [{ ...request, approvalCount: 3 }], nextCursor: null }), null);
  assert.equal(parseAdminRoleChangeRequestList({ items: [{ ...request, extra: "secret" }], nextCursor: null }), null);
});

test("rejects malformed or expanded operations fields instead of exposing them", () => {
  assert.equal(
    parseAdminOperationsSnapshot({
      ...validSnapshot,
      jobSummary: [{ count: 1, status: "PENDING" }, { count: 2, status: "PENDING" }],
    }),
    null,
  );
  assert.equal(
    parseAdminOperationsSnapshot({
      ...validSnapshot,
      failureClasses: [{ count: 1, failureCode: "provider timeout" }],
    }),
    null,
  );
  assert.equal(
    parseAdminOperationsSnapshot({ ...validSnapshot, resources: ["processingJobs", "authSessions"] }),
    null,
  );
  assert.equal(parseAdminOperationsSnapshot({ ...validSnapshot, readiness: "not-ready" }), null);
});

test("maps authentication, authorization, and unavailable responses safely", () => {
  assert.deepEqual(mapAdminOperationsResponse(401, null), { kind: "unauthenticated" });
  assert.deepEqual(mapAdminOperationsResponse(403, null), { kind: "forbidden" });
  assert.deepEqual(mapAdminOperationsResponse(502, { message: "backend details" }), {
    kind: "unavailable",
  });
  assert.deepEqual(mapAdminOperationsResponse(200, { error: "raw backend message" }), {
    kind: "unavailable",
  });
});

test("accepts only the minimal named bootstrap status contract", () => {
  assert.deepEqual(parseAdminSuperAdminBootstrapStatus({ mode: "FIRST_BOOTSTRAP" }), { mode: "FIRST_BOOTSTRAP" });
  assert.deepEqual(parseAdminSuperAdminBootstrapStatus({ mode: "SEED_SECOND" }), { mode: "SEED_SECOND" });
  assert.equal(parseAdminSuperAdminBootstrapStatus({ mode: "NORMAL", detail: "secret" }), null);
  assert.equal(parseAdminSuperAdminBootstrapStatus({ available: true }), null);
  assert.equal(parseAdminSuperAdminBootstrapStatus({ mode: "UNKNOWN" }), null);
});

test("keeps expiry optional for older pending-request responses while preserving the typed null", () => {
  const request = {
    approvalCount: 0,
    canApprove: true,
    createdAt: "2026-09-02T08:00:00.000Z",
    desiredRole: "SUPER_ADMIN",
    id: "00000000-0000-0000-0000-000000000010",
    requesterId: "00000000-0000-0000-0000-000000000001",
    requiredApprovals: 2,
    targetUserId: "00000000-0000-0000-0000-000000000002",
  };
  assert.equal(parseAdminRoleChangeRequestList({ items: [request], nextCursor: null })?.items[0].expiresAt, null);
});

test("uses the server-only authenticated backend boundary and fails closed", () => {
  const source = readFileSync(resolve(dirname(import.meta.filename), "operations.ts"), "utf8");
  assert.match(source, /import "server-only"/u);
  assert.match(source, /requestAuthenticatedBackend/u);
  assert.match(source, /path: "\/api\/v1\/admin\/operations"/u);
  assert.match(source, /return \{ kind: "unavailable" \}/u);
  assert.match(source, /\/api\/v1\/admin\/super-admin\/bootstrap\/status/u);
  assert.match(source, /return null/u);
});
