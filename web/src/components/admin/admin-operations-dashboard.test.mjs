import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";

const source = readFileSync(resolve(dirname(import.meta.filename), "admin-operations-dashboard.tsx"), "utf8");

test("renders a learner-friendly admin overview with Vietnamese labels", () => {
  assert.match(source, /Tổng quan quản trị/u);
  assert.match(source, /Bức tranh hôm nay/u);
  assert.match(source, /Việc đang chờ/u);
  assert.match(source, /Cần xem/u);
  assert.match(source, /Các phần quan trọng vẫn đang hoạt động/u);
});

test("redacts raw resource and failure identifiers from the dashboard", () => {
  assert.match(source, /function getFailureLabel/u);
  assert.match(source, /Một nhóm tác vụ cần được xem lại/u);
  assert.match(source, /Xử lý tài liệu/u);
  assert.match(source, /\{getFailureLabel\(failure\.code\)\}/u);
  assert.doesNotMatch(source, /<span[^>]*>\{resource\.name\}<\/span>/u);
});

test("labels sample metrics so operators do not mistake them for live data", () => {
  assert.match(source, /Dữ liệu minh họa/u);
  assert.match(source, /Các thẻ dưới đây là mẫu giao diện/u);
  assert.match(source, /Người học hôm nay/u);
});

test("passes the protected super-admin status to the actions panel", () => {
  assert.match(source, /superAdminStatus: AdminSuperAdminBootstrapStatus \| null/u);
  assert.match(source, /superAdminStatus=\{superAdminStatus\}/u);
  const actionsPanel = readFileSync(resolve(dirname(import.meta.filename), "admin-actions-panel.tsx"), "utf8");
  assert.match(actionsPanel, /actorRole === "ADMIN" && currentMode === "FIRST_BOOTSTRAP"/u);
});
