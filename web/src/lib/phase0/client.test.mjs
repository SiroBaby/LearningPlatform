import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";

const source = readFileSync(resolve(dirname(import.meta.filename), "client.ts"), "utf8");

test("uses the dedicated retry command and keeps the bounded client request", () => {
  assert.match(source, /export function retryPhase0Document/u);
  assert.match(source, /`\/api\/phase0\/documents\/\$\{documentId\}\/retry`/u);
  assert.match(source, /mapConfirmDocumentResponse/u);
  assert.match(source, /PHASE0_REQUEST_TIMEOUT_MS/u);
  assert.match(source, /new AbortController\(\)/u);
  assert.match(source, /signal: abortController\.signal/u);
  assert.match(source, /new Phase0ClientError\(408/u);
});

test("keeps attempt history as a top-level response contract", () => {
  assert.match(source, /export function getPhase0AttemptHistory/u);
  assert.match(source, /`\/api\/phase0\/quizzes\/\$\{quizId\}\/attempts`/u);
  assert.match(source, /mapAttemptHistoryResponse/u);
});
