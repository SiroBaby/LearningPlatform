import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";

const source = readFileSync(resolve(dirname(import.meta.filename), "quiz-start-screen.tsx"), "utf8");

test("history exposes loading, error, retry, and empty states", () => {
  assert.match(source, /getPhase0AttemptHistory/u);
  assert.match(source, /isHistoryLoading/u);
  assert.match(source, /historyError/u);
  assert.match(source, /role="status" aria-live="polite"/u);
  assert.match(source, /role="alert"/u);
  assert.match(source, /onRetry/u);
  assert.match(source, /attempts\.length === 0/u);
});

test("history rows remain mobile-friendly and keyboard-visible", () => {
  assert.match(source, /sm:flex-row/u);
  assert.match(source, /focus-visible:ring/u);
  assert.match(source, /LinkButton href=\{routes\.quizResult/u);
});
