import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";

const source = readFileSync(resolve(dirname(import.meta.filename), "processing-status-screen.tsx"), "utf8");
const sections = readFileSync(resolve(dirname(import.meta.filename), "processing-status-sections.tsx"), "utf8");
const button = readFileSync(resolve(dirname(import.meta.filename), "../ui/button.tsx"), "utf8");

test("processing retry uses the dedicated document retry command", () => {
  assert.match(source, /retryPhase0Document/u);
  assert.match(source, /retryDocument: retryPhase0Document/u);
  assert.doesNotMatch(source, /confirmPhase0Document/u);
});

test("retry state remains keyboard and responsive safe", () => {
  assert.match(sections, /aria-busy=\{isRetrySubmitting\}/u);
  assert.match(sections, /role="alert"/u);
  assert.match(sections, /sm:grid-cols-2/u);
  assert.match(button, /focus-visible:ring/u);
});

test("terminal processing failures provide a clear support path without technical details", () => {
  assert.match(sections, /!failurePresentation\.retryable/u);
  assert.match(sections, /mailto:ngocphat076@gmail\.com/u);
  assert.match(sections, /liên hệ hỗ trợ/u);
  assert.match(sections, /không gửi mật khẩu, token hoặc mã xác thực/u);
});
