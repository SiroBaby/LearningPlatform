import assert from "node:assert/strict";
import { test } from "node:test";

import { decidePreviewFailureAction } from "./subtitle-preview-failure.ts";

test("parse errors and rejected states require a different file", () => {
  assert.equal(decidePreviewFailureAction({ status: 400, code: "SUBTITLE_FORMAT_INVALID", retryable: false }), "change-file");
  assert.equal(decidePreviewFailureAction({ status: 409, code: "SUBTITLE_PREVIEW_NOT_ALLOWED" }), "change-file");
  assert.equal(decidePreviewFailureAction({ status: 403 }), "change-file");
});

test("timeouts, transport failures and server errors can be retried on the same document", () => {
  assert.equal(decidePreviewFailureAction({ status: 408, code: "REQUEST_TIMEOUT", retryable: true }), "retry");
  assert.equal(decidePreviewFailureAction({}), "retry");
  assert.equal(decidePreviewFailureAction({ status: 0 }), "retry");
  assert.equal(decidePreviewFailureAction({ status: 503 }), "retry");
  assert.equal(decidePreviewFailureAction({ status: 429 }), "retry");
  assert.equal(decidePreviewFailureAction({ status: 400, retryable: true }), "retry");
});
