import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { MOBILE_MORE_HREFS, isLearnerRouteActive, isMobileMoreActive } from "./learner-nav-active.ts";
import { routes } from "./routes.ts";

test("mục Ôn tập sáng ở flashcards, kế hoạch học và bài thi thử", () => {
  for (const pathname of ["/review", "/flashcards/d1", "/flashcards/d1/review", "/study-plan", "/exam/setup", "/exam/e1/practice", "/exam/e1/result/a1"]) {
    assert.equal(isLearnerRouteActive(pathname, "/review"), true, pathname);
  }
});

test("mục khác không sáng nhầm ở các khu vực này", () => {
  for (const href of ["/home", "/library", "/tutor", "/analytics", "/courses", "/upload"]) {
    assert.equal(isLearnerRouteActive("/study-plan", href), false, href);
    assert.equal(isLearnerRouteActive("/exam/setup", href), false, href);
    assert.equal(isLearnerRouteActive("/flashcards/d1", href), false, href);
  }
});

test("khớp theo ranh giới đường dẫn và /home không khớp tiền tố", () => {
  assert.equal(isLearnerRouteActive("/reviewer", "/review"), false);
  assert.equal(isLearnerRouteActive("/examples", "/review"), false);
  assert.equal(isLearnerRouteActive("/home", "/home"), true);
  assert.equal(isLearnerRouteActive("/home/x", "/home"), false);
  assert.equal(isLearnerRouteActive("/notifications", "/notifications"), true);
  assert.equal(isLearnerRouteActive("/courses/c1", "/courses"), true);
});

test("nút Thêm sáng ở các trang thuộc menu Thêm", () => {
  for (const pathname of ["/analytics", "/analytics/weak-topic/x", "/courses", "/courses/c1", "/billing", "/billing/upgrade", "/settings"]) {
    assert.equal(isMobileMoreActive(pathname), true, pathname);
  }
});

test("nút Thêm không sáng ở các mục trên thanh dưới hoặc khu vực Ôn tập", () => {
  for (const pathname of ["/home", "/library", "/review", "/tutor", "/upload", "/study-plan", "/exam/setup", "/flashcards/d1", "/notifications"]) {
    assert.equal(isMobileMoreActive(pathname), false, pathname);
  }
});

test("danh sách menu Thêm khớp route map", () => {
  assert.deepEqual([...MOBILE_MORE_HREFS], [routes.analytics, routes.courses, routes.billing, routes.settings]);
});

test("menu Thêm trong shell dùng danh sách riêng cho điện thoại", () => {
  const shell = readFileSync(new URL("../components/layout/learner-shell.tsx", import.meta.url), "utf8");
  assert.match(shell, /learnerMobileMoreNav\.map/u);
});
