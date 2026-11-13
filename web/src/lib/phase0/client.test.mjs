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

test("sends document deletion as a bounded DELETE request", () => {
  assert.match(source, /export function deletePhase0Document/u);
  assert.match(
    source,
    /requestPhase0Api\(`\/api\/phase0\/documents\/\$\{documentId\}`, "DELETE", mapConfirmDocumentResponse\)/u,
  );
  assert.match(source, /method: "GET" \| "POST" \| "DELETE"/u);
});

test("keeps attempt history as a top-level response contract", () => {
  assert.match(source, /export function getPhase0AttemptHistory/u);
  assert.match(source, /`\/api\/phase0\/quizzes\/\$\{quizId\}\/attempts`/u);
  assert.match(source, /mapAttemptHistoryResponse/u);
});

test("requests playback URLs via the dedicated BFF route with a reason and abort support", () => {
  assert.match(source, /export function createPhase0PlaybackUrl/u);
  assert.match(source, /`\/api\/phase0\/documents\/\$\{documentId\}\/playback-url`/u);
  assert.match(source, /mapPlaybackUrlResponse/u);
  assert.match(source, /public readonly retryAfterSec\?: number/u);
  assert.match(source, /parseRetryAfterSeconds\(response\.headers\.get\("retry-after"\)/u);
});

test("confirms with an optional rights body and previews subtitles through a longer bounded request", () => {
  assert.match(source, /export function confirmPhase0Document\(\s*documentId: string,\s*request\?: Phase0ConfirmDocumentRequest/u);
  assert.match(source, /mapConfirmDocumentResponse,\s*request,/u);
  assert.match(source, /export function previewPhase0Subtitle/u);
  assert.match(source, /`\/api\/phase0\/documents\/\$\{documentId\}\/subtitle-preview`/u);
  assert.match(source, /mapSubtitlePreviewResponse/u);
  assert.match(source, /SUBTITLE_PREVIEW_TIMEOUT_MS/u);
  assert.match(source, /public readonly line\?: number/u);
  assert.match(source, /globalThis\.setTimeout\(\(\) => abortController\.abort\(\), timeoutMs\)/u);
});
