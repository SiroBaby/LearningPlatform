import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";

const shellSource = readFileSync(resolve(dirname(import.meta.filename), "../layout/admin-shell.tsx"), "utf8");
const navSource = readFileSync(resolve(dirname(import.meta.filename), "../../lib/nav.ts"), "utf8");
const routesSource = readFileSync(resolve(dirname(import.meta.filename), "../../lib/routes.ts"), "utf8");

test("admin navigation uses learner-friendly sections", () => {
  assert.match(navSource, /label: "Tổng quan"/u);
  assert.match(navSource, /label: "Người dùng & quyền"/u);
  assert.match(navSource, /label: "Hoạt động"/u);
  assert.match(navSource, /label: "Tình trạng hệ thống"/u);
  assert.doesNotMatch(shellSource, /Admin \/ Operator/u);
});

test("admin navigation exposes desktop and mobile destinations", () => {
  assert.match(routesSource, /adminAccess: "\/admin\/access"/u);
  assert.match(routesSource, /adminActivity: "\/admin\/activity"/u);
  assert.match(routesSource, /adminHealth: "\/admin\/health"/u);
  assert.match(shellSource, /Điều hướng quản trị trên điện thoại/u);
  assert.match(shellSource, /aria-current=\{active \? "page" : undefined\}/u);
});
