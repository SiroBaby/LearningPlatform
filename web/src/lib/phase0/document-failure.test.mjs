import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getDocumentFailurePresentation,
  isRetryableDocumentFailureCode,
} from "./document-failure.ts";
import { phase0DocumentProcessingFailureCodes } from "./contracts.ts";

const retryableCodes = new Set([
  "BUDGET_EXHAUSTED",
  "GENERATION_OUTPUT_INVALID",
  "GENERATION_OUTPUT_TRUNCATED",
  "PROCESSING_TIMED_OUT",
  "PROVIDER_UNAVAILABLE",
]);

for (const errorCode of phase0DocumentProcessingFailureCodes) {
  test(`returns stable presentation for ${errorCode}`, () => {
    const presentation = getDocumentFailurePresentation(errorCode);

    assert.ok(presentation.title.length > 0);
    assert.ok(presentation.description.length > 0);
    assert.equal(presentation.retryable, retryableCodes.has(errorCode));
  });

  test(`marks retryability for ${errorCode}`, () => {
    assert.equal(isRetryableDocumentFailureCode(errorCode), retryableCodes.has(errorCode));
  });
}

test("returns safe fallback presentation for null error code", () => {
  const presentation = getDocumentFailurePresentation(null);

  assert.equal(presentation.retryable, false);
  assert.match(presentation.title, /Chưa thể xử lý tài liệu/);
  assert.match(presentation.description, /thử lại sau|tải lại file/i);
});

test("never marks null error code as retryable", () => {
  assert.equal(isRetryableDocumentFailureCode(null), false);
});

test("uses safe retryable Vietnamese copy for truncated generation", () => {
  const presentation = getDocumentFailurePresentation("GENERATION_OUTPUT_TRUNCATED");

  assert.equal(presentation.retryable, true);
  assert.equal(presentation.title, "Chưa thể tạo bộ câu hỏi hoàn chỉnh");
  assert.equal(presentation.description, "Hãy thử lại sau để tạo lại bộ câu hỏi.");
});

test("uses coherent failed copy for generic processing failure", () => {
  const presentation = getDocumentFailurePresentation("PROCESSING_FAILED");

  assert.equal(presentation.retryable, false);
  assert.equal(presentation.title, "Chưa thể xử lý tài liệu");
  assert.doesNotMatch(presentation.description, /đang xử lý|xử lý xong/i);
  assert.match(presentation.description, /kiểm tra lại file|tải lại/i);
});
