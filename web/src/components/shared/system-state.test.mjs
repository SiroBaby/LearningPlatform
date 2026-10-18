import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";

const SRC_ROOT = resolve(dirname(import.meta.filename), "../..");
const read = (path) => readFileSync(resolve(SRC_ROOT, path), "utf8");

const SYSTEM_PAGES = {
  "app/not-found.tsx": "Không tìm thấy trang",
  "app/offline/page.tsx": "Mất kết nối",
  "app/maintenance/page.tsx": "Đang bảo trì",
  "app/access-denied/page.tsx": "Không có quyền truy cập",
};

test("system state page never defaults to a guest session", () => {
  const source = read("components/shared/system-state.tsx");
  assert.doesNotMatch(source, /isAuthenticated\s*=\s*false/u);
  assert.match(source, /isAuthenticated: boolean \| null;/u);
});

test("error boundary hides account actions and links to the public home", () => {
  const source = read("app/error.tsx");
  assert.match(source, /isAuthenticated=\{null\}/u);
  assert.match(source, /routes\.landing/u);
  assert.doesNotMatch(source, /"\/home"/u);
  assert.match(source, /<title>Chưa mở được trang/u);
});

test("system pages use Vietnamese titles, context-correct actions and no internal wording", () => {
  for (const [path, title] of Object.entries(SYSTEM_PAGES)) {
    const source = read(path);
    assert.ok(source.includes(`"${title}"`), `${path} must set title ${title}`);
    assert.doesNotMatch(source, /billing\/upgrade|AccessActions|Xem các gói nâng cấp/u, path);
    assert.doesNotMatch(source, /mock|pipeline|surface|production|workspace|route|quota|role|upload|review queue/iu, path);
    assert.match(source, /HomeActions isAuthenticated=\{isAuthenticated\}/u, path);
  }
});

test("home action sends guests to the landing page and signed-in learners to home", () => {
  const source = read("components/shared/system-state.tsx");
  assert.match(source, /isAuthenticated === true \? routes\.home : routes\.landing/u);
});

test("public footer only links to private billing for signed-in visitors", () => {
  const source = read("components/layout/public-shell-content.tsx");
  assert.match(source, /isAuthenticated \? <li><Link href=\{routes\.billing\}>/u);
});
