import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const WEB_ROOT = resolve(import.meta.dirname, "../..");
const ENV_ASSIGNMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*=/u;
const TEST_FILE_PATTERN = /\.test\.mjs$/u;
const GLUED_PATH_PATTERN = /\.test\.mjs./u;

/** Tách các đường dẫn test trong script `test:runtime`, bỏ qua `KEY=VALUE` đứng trước lệnh và flag `--*`. */
function readRuntimeTestPaths(scriptValue) {
  const tokens = scriptValue.split(" ").filter(Boolean);
  while (tokens.length > 0 && ENV_ASSIGNMENT_PATTERN.test(tokens[0])) tokens.shift();
  assert.deepEqual(tokens.splice(0, 2), ["node", "--test"], "test:runtime phải có dạng `[KEY=VALUE ...] node --test ...`");
  return tokens.filter((token) => !token.startsWith("--"));
}

/** Trả về danh sách lỗi của các đường dẫn (nêu rõ loại lỗi); rỗng nghĩa là hợp lệ. */
function findRuntimeTestPathProblems(paths, isFile) {
  const problems = [];
  for (const path of paths) {
    if (GLUED_PATH_PATTERN.test(path)) problems.push(`đường dẫn dính liền nhiều file: ${path}`);
    else if (!TEST_FILE_PATTERN.test(path)) problems.push(`không phải file *.test.mjs: ${path}`);
    else if (!isFile(path)) problems.push(`file không tồn tại hoặc không phải file thường: ${path}`);
  }
  return problems;
}

function isRegularFile(path) {
  try {
    return statSync(resolve(WEB_ROOT, path)).isFile();
  } catch {
    return false;
  }
}

test("mọi đường dẫn trong test:runtime hợp lệ, tồn tại và không bị dính liền", () => {
  const packageJson = JSON.parse(readFileSync(resolve(WEB_ROOT, "package.json"), "utf8"));
  const paths = readRuntimeTestPaths(packageJson.scripts["test:runtime"]);
  assert.ok(paths.length > 0);
  assert.deepEqual(findRuntimeTestPathProblems(paths, isRegularFile), []);
});

test("guard phát hiện đường dẫn dính liền hoặc thiếu file", () => {
  const glued = readRuntimeTestPaths("node --test src/a.test.mjssrc/b.test.mjs");
  assert.match(findRuntimeTestPathProblems(glued, () => true)[0], /dính liền/u);
  assert.match(findRuntimeTestPathProblems(["src/missing.test.mjs"], () => false)[0], /không tồn tại/u);
  assert.deepEqual(findRuntimeTestPathProblems(["src/ok.test.mjs"], () => true), []);
});

test("guard bỏ qua flag và KEY=VALUE đứng trước lệnh", () => {
  const paths = readRuntimeTestPaths("NODE_ENV=test FOO=1 node --test --test-concurrency=1 --experimental-test-coverage src/a.test.mjs");
  assert.deepEqual(paths, ["src/a.test.mjs"]);
});

test("guard báo đỏ file .ts và thư mục", () => {
  const paths = readRuntimeTestPaths("node --test src/lib/routes.ts src/lib");
  const problems = findRuntimeTestPathProblems(paths, () => true);
  assert.equal(problems.length, 2);
  for (const problem of problems) assert.match(problem, /không phải file \*\.test\.mjs/u);
});

test("guard báo đỏ thư mục đặt tên giống file test", () => {
  const problems = findRuntimeTestPathProblems(["src/dir.test.mjs"], () => false);
  assert.match(problems[0], /không tồn tại hoặc không phải file thường/u);
});
