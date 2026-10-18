import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { isLearnerRouteActive } from "./learner-nav-active.ts";

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

test("menu Thêm trên điện thoại có Tiến độ và Khóa học", () => {
  const nav = readFileSync(new URL("./nav.ts", import.meta.url), "utf8");
  const block = nav.slice(nav.indexOf("learnerMobileMoreNav"), nav.indexOf("export const teacherNav"));
  assert.match(block, /label: "Tiến độ"/u);
  assert.match(block, /label: "Khóa học"/u);
  const shell = readFileSync(new URL("../components/layout/learner-shell.tsx", import.meta.url), "utf8");
  assert.match(shell, /learnerMobileMoreNav\.map/u);
});
