import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const WEB_ROOT = resolve(import.meta.dirname, "../..");
const SCRIPT_PREFIX = "node --test ";

/** Tách các đường dẫn test trong script `test:runtime` của package.json. */
function readRuntimeTestPaths(scriptValue) {
  assert.ok(scriptValue.startsWith(SCRIPT_PREFIX), "test:runtime phải bắt đầu bằng `node --test `");
  return scriptValue.slice(SCRIPT_PREFIX.length).split(" ").filter(Boolean);
}

/** Trả về danh sách lỗi của các đường dẫn; rỗng nghĩa là hợp lệ. */
function findRuntimeTestPathProblems(paths, fileExists) {
  const problems = [];
  for (const path of paths) {
    if ((path.match(/\.test\.mjs/gu) ?? []).length > 1) problems.push(`đường dẫn dính liền: ${path}`);
    else if (!fileExists(path)) problems.push(`không tồn tại: ${path}`);
  }
  return problems;
}

test("mọi đường dẫn trong test:runtime tồn tại và không bị dính liền", () => {
  const packageJson = JSON.parse(readFileSync(resolve(WEB_ROOT, "package.json"), "utf8"));
  const paths = readRuntimeTestPaths(packageJson.scripts["test:runtime"]);
  assert.ok(paths.length > 0);
  assert.deepEqual(findRuntimeTestPathProblems(paths, (path) => existsSync(resolve(WEB_ROOT, path))), []);
});

test("guard phát hiện đường dẫn dính liền hoặc thiếu file", () => {
  const glued = readRuntimeTestPaths("node --test src/a.test.mjssrc/b.test.mjs");
  assert.equal(findRuntimeTestPathProblems(glued, () => true).length, 1);
  assert.equal(findRuntimeTestPathProblems(["src/missing.test.mjs"], () => false).length, 1);
  assert.deepEqual(findRuntimeTestPathProblems(["src/ok.test.mjs"], () => true), []);
});
