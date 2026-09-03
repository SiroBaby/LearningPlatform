import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";

const directory = dirname(import.meta.filename);
const source = (relativePath) => readFileSync(resolve(directory, relativePath), "utf8");

test("admin action BFF routes keep browser mutations behind the server boundary", () => {
  const routes = [
    "../../app/api/admin/super-admin/bootstrap/route.ts",
    "../../app/api/admin/super-admin/break-glass/route.ts",
    "../../app/api/admin/super-admin/role-change-requests/route.ts",
    "../../app/api/admin/super-admin/role-change-approvals/route.ts",
  ].map(source);

  for (const route of routes) {
    assert.match(route, /requestAuthenticatedBackend/u);
    assert.match(route, /validateBrowserMutation/u);
    assert.doesNotMatch(route, /lp_access|lp_refresh|Authorization/u);
  }
  const statusRoute = source("../../app/api/admin/super-admin/bootstrap/status/route.ts");
  assert.match(statusRoute, /requestAuthenticatedBackend/u);
  assert.doesNotMatch(statusRoute, /lp_access|lp_refresh|Authorization/u);
});

test("admin action BFF routes call only the approved Nest contracts", () => {
  assert.match(source("../../app/api/admin/super-admin/bootstrap/route.ts"), /\/api\/v1\/admin\/super-admin\/bootstrap/u);
  assert.match(source("../../app/api/admin/super-admin/bootstrap/status/route.ts"), /\/api\/v1\/admin\/super-admin\/bootstrap\/status/u);
  assert.match(source("../../app/api/admin/super-admin/bootstrap/status/route.ts"), /export async function GET/u);
  assert.match(source("../../app/api/admin/super-admin/role-change-requests/route.ts"), /\/api\/v1\/admin\/super-admin\/role-change-requests/u);
  assert.match(source("../../app/api/admin/super-admin/role-change-approvals/route.ts"), /\/api\/v1\/admin\/super-admin\/role-change-approvals/u);
  assert.match(source("../../app/api/admin/super-admin/role-change-requests/route.ts"), /export async function GET/u);
  assert.match(source("../../app/api/admin/super-admin/role-change-requests/route.ts"), /status=pending&limit=/u);
});

test("break-glass BFF forwards only the bounded approval token contract", () => {
  const route = source("../../app/api/admin/super-admin/break-glass/route.ts");
  assert.match(route, /\/api\/v1\/admin\/super-admin\/break-glass/u);
  assert.match(route, /approvalToken/u);
  assert.match(route, /MAX_APPROVAL_TOKEN_LENGTH/u);
  assert.match(route, /invalidAdminActionRequest/u);
  assert.match(route, /invalidAdminActionResponse/u);
  assert.match(route, /safeAdminBackendError/u);
  assert.doesNotMatch(route, /console\.|logger\.|privateKey|jti/u);
});

test("role action payloads are allowlisted and UUID-bound before forwarding", () => {
  const requestRoute = source("../../app/api/admin/super-admin/role-change-requests/route.ts");
  const approvalRoute = source("../../app/api/admin/super-admin/role-change-approvals/route.ts");
  assert.match(requestRoute, /targetUserId|desiredRole/u);
  assert.match(requestRoute, /UUID_PATTERN\.test/u);
  assert.match(requestRoute, /body: \{ targetUserId, desiredRole \}/u);
  assert.match(approvalRoute, /requestId/u);
  assert.match(approvalRoute, /UUID_PATTERN\.test/u);
  assert.match(approvalRoute, /body: \{ requestId \}/u);
  assert.match(source("./action-route.ts"), /retryable/u);
});

test("admin panel confirms actions and keeps operational controls keyboard/mobile-safe", () => {
  const panel = source("../../components/admin/admin-actions-panel.tsx");
  assert.match(panel, /use client/u);
  assert.match(panel, /<Dialog/u);
  assert.match(panel, /Xác nhận/u);
  assert.match(panel, /aria-live="polite"/u);
  assert.match(panel, /Đang xử lý…/u);
  assert.match(panel, /api\/admin\/super-admin\/bootstrap/u);
  assert.match(panel, /api\/admin\/super-admin\/role-change-requests/u);
  assert.match(panel, /api\/admin\/super-admin\/role-change-approvals/u);
  assert.match(panel, /roleChangeRequests\.map/u);
  assert.match(panel, /Duyệt yêu cầu/u);
  assert.doesNotMatch(panel, /id="admin-role-change-request-id"/u);
  assert.match(panel, /className="w-full"/u);
});

test("admin action confirmation exits safely when the BFF is slow", () => {
  const panel = source("../../components/admin/admin-actions-panel.tsx");
  assert.match(panel, /ADMIN_ACTION_TIMEOUT_MS/u);
  assert.match(panel, /new AbortController\(\)/u);
  assert.match(panel, /signal: abortController\.signal/u);
  assert.match(panel, /window\.clearTimeout\(timeoutId\)/u);
  assert.match(panel, /Thao tác mất quá nhiều thời gian/u);
});

test("admin panel explains each quorum mode without exposing approval material", () => {
  const panel = source("../../components/admin/admin-actions-panel.tsx");
  for (const mode of ["FIRST_BOOTSTRAP", "SEED_SECOND", "NORMAL", "QUORUM_RECOVERY", "LOCKOUT_RECOVERY"]) {
    assert.match(panel, new RegExp(mode, "u"));
  }
  assert.match(panel, /Bước cấp quyền tạm thời được thực hiện qua quy trình vận hành/u);
  assert.match(panel, /Hệ thống chỉ còn một quản trị cấp cao/u);
  assert.match(panel, /currentMode === "NORMAL"/u);
  assert.match(panel, /hoàn tất bước thiết lập nhóm quản trị bên ngoài/u);
  assert.match(panel, /request\.expiresAt/u);
  assert.match(panel, /Đã hết hạn/u);
  assert.doesNotMatch(panel, /privateKey|approvalToken|jti/u);
});
