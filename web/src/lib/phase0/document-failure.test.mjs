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
  "INSUFFICIENT_CREDITS_AFTER_EXTRACT",
  "MEDIA_PROBE_STORAGE_TEMPORARY",
  "MEDIA_PROBE_TIMEOUT",
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
  assert.doesNotMatch(presentation.description, /thử lại/i);
  assert.match(presentation.description, /tải lên lại/i);
});

test("never marks null error code as retryable", () => {
  assert.equal(isRetryableDocumentFailureCode(null), false);
});

test("uses safe retryable Vietnamese copy for truncated generation", () => {
  const presentation = getDocumentFailurePresentation("GENERATION_OUTPUT_TRUNCATED");

  assert.equal(presentation.retryable, true);
  assert.equal(presentation.title, "Chưa thể tạo bộ câu hỏi hoàn chỉnh");
  assert.equal(presentation.description, "Thử lại sau để tạo lại bộ câu hỏi.");
});

test("uses coherent failed copy for generic processing failure", () => {
  const presentation = getDocumentFailurePresentation("PROCESSING_FAILED");

  assert.equal(presentation.retryable, false);
  assert.equal(presentation.title, "Chưa thể xử lý tài liệu");
  assert.doesNotMatch(presentation.description, /đang xử lý|xử lý xong/i);
  assert.match(presentation.description, /Kiểm tra file|tải lên lại/u);
});

test("guides the learner to MP4 or MP3 for unsupported media audio", () => {
  const presentation = getDocumentFailurePresentation("MEDIA_UNSUPPORTED_AUDIO_CODEC");

  assert.equal(presentation.retryable, false);
  assert.equal(presentation.title, "Âm thanh trong video chưa được hỗ trợ");
  assert.equal(presentation.description, "Thử lại với MP4 khác hoặc MP3.");
});

test("keeps unsupported media video copy short without codec specs", () => {
  const presentation = getDocumentFailurePresentation("MEDIA_UNSUPPORTED_VIDEO_CODEC");

  assert.equal(presentation.retryable, false);
  assert.equal(presentation.title, "Video chưa được hỗ trợ");
  assert.equal(presentation.description, "Thử lại với MP4 tối đa 1080p, 30 khung hình/giây.");
});

test("covers protected files for unsupported media container", () => {
  const presentation = getDocumentFailurePresentation("MEDIA_UNSUPPORTED_CONTAINER");

  assert.equal(presentation.retryable, false);
  assert.match(presentation.description, /khóa bản quyền/u);
});

test("states the 2-hour duration limit when media probe fails", () => {
  assert.match(getDocumentFailurePresentation("MEDIA_PROBE_FAILED").description, /2 giờ/u);
});

test("explains that MP3/MP4 only work with a plan choice, without the old technical wording", () => {
  const presentation = getDocumentFailurePresentation("MEDIA_REQUIRES_PLATFORM_MODEL");

  assert.equal(presentation.retryable, false);
  assert.equal(presentation.description, "MP3/MP4 chỉ dùng được với lựa chọn có trong gói. Chọn lại rồi tải lên.");
  assert.doesNotMatch(presentation.description, /kết nối riêng|mô hình/u);
});

test("shows short credit copy without numbers for insufficient credits after extraction", () => {
  const presentation = getDocumentFailurePresentation("INSUFFICIENT_CREDITS_AFTER_EXTRACT");

  assert.equal(presentation.retryable, true);
  assert.equal(presentation.title, "Chưa đủ credit để tạo câu hỏi");
  assert.equal(presentation.description, "Nạp thêm credit rồi thử lại.");
  assert.doesNotMatch(presentation.description, /\d/u);
});

test("keeps the speech-to-text service wording for incompatible provider", () => {
  const presentation = getDocumentFailurePresentation("PROVIDER_INCOMPATIBLE");

  assert.equal(presentation.title, "Dịch vụ chuyển giọng nói chưa nhận file này");
  assert.equal(presentation.description, "Thử lại với file MP3 hoặc MP4 khác.");
});

test("never shows technical specs or old credit unit in any failure copy", () => {
  for (const errorCode of phase0DocumentProcessingFailureCodes) {
    const { title, description } = getDocumentFailurePresentation(errorCode);
    assert.doesNotMatch(`${title} ${description}`, /H\.264|yuv420p|AAC|MiB|GiB|fps|OCR|lượt dùng|kết nối riêng/u);
  }
});

test("explains the decoded duration rejections without retry", () => {
  assert.match(getDocumentFailurePresentation("MEDIA_DURATION_EXCEEDED").description, /2 giờ/u);
  assert.match(getDocumentFailurePresentation("MEDIA_DURATION_MISMATCH").description, /xuất lại/iu);
  assert.equal(isRetryableDocumentFailureCode("MEDIA_DURATION_MISMATCH"), false);
});
