import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";

const { getHomeHref, getPublicChromeView } = await import("./system-state-view.ts");

const SRC_ROOT = resolve(dirname(import.meta.filename), "../..");
const read = (path) => readFileSync(resolve(SRC_ROOT, path), "utf8");

const SYSTEM_PAGE_TITLES = {
  "app/not-found.tsx": "Không tìm thấy trang",
  "app/offline/page.tsx": "Mất kết nối",
  "app/maintenance/page.tsx": "Đang bảo trì",
  "app/access-denied/page.tsx": "Chưa có quyền truy cập",
};

test("home link sends guests and unknown sessions to the landing page, learners to home", () => {
  assert.equal(getHomeHref(true), "/home");
  assert.equal(getHomeHref(false), "/");
  assert.equal(getHomeHref(null), "/");
});

test("public chrome never defaults an unknown session to guest and hides private links", () => {
  assert.deepEqual(getPublicChromeView(true), { accountMode: "member", showUsageLink: true });
  assert.deepEqual(getPublicChromeView(false), { accountMode: "guest", showUsageLink: false });
  assert.deepEqual(getPublicChromeView(null), { accountMode: "hidden", showUsageLink: false });
});

test("system pages use Vietnamese titles, context-correct actions and no internal wording", () => {
  for (const [path, title] of Object.entries(SYSTEM_PAGE_TITLES)) {
    const source = read(path);
    assert.ok(source.includes(title), `${path} must set title ${title}`);
    assert.doesNotMatch(source, /billing\/upgrade|Xem các gói nâng cấp/u, path);
    assert.doesNotMatch(source, /mock|pipeline|surface|production|workspace|quota|review queue/iu, path);
  }
});

test("error boundary hides account actions and retries through Next retry()", () => {
  const source = read("app/error.tsx");
  assert.match(source, /isAuthenticated=\{null\}/u);
  assert.match(source, /retry\(\)/u);
  assert.doesNotMatch(source, /reset\(/u);
});
