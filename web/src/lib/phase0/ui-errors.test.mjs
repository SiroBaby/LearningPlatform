import assert from "node:assert/strict";
import { test } from "node:test";

import { getInsufficientCreditsMessage, getPhase0UiErrorMessage } from "./ui-errors.ts";

test("maps known Phase 0 error codes to learner-facing copy", () => {
  const error = new Error("Quiz is still being prepared.");
  error.name = "Phase0ClientError";
  error.code = "QUIZ_NOT_READY";

  assert.equal(
    getPhase0UiErrorMessage(error, "fallback"),
    "Quiz đang được chuẩn bị. Hãy quay lại sau ít phút.",
  );
});

test("hides unknown runtime error details behind the fallback", () => {
  assert.equal(
    getPhase0UiErrorMessage(new Error("connect ECONNREFUSED"), "fallback"),
    "fallback",
  );
});

function createCreditError(shortfallCredits) {
  const error = new Error("Not enough credits to process this Document with the selected platform model.");
  error.name = "Phase0ClientError";
  error.status = 402;
  error.code = "INSUFFICIENT_CREDITS";
  error.retryable = true;
  if (shortfallCredits !== undefined) error.shortfallCredits = shortfallCredits;
  return error;
}

test("maps INSUFFICIENT_CREDITS to Vietnamese copy with the shortfall", () => {
  assert.equal(
    getInsufficientCreditsMessage(createCreditError(250)),
    "Bạn không đủ credit để xử lý tài liệu này. Cần thêm khoảng 250 credit. Hãy bổ sung credit, chọn Custom AI hoặc dùng tệp nhỏ hơn.",
  );
});

test("maps INSUFFICIENT_CREDITS without a shortfall and ignores other errors", () => {
  assert.equal(
    getInsufficientCreditsMessage(createCreditError()),
    "Bạn không đủ credit để xử lý tài liệu này. Hãy bổ sung credit, chọn Custom AI hoặc dùng tệp nhỏ hơn.",
  );
  assert.equal(getInsufficientCreditsMessage(new Error("boom")), null);
});
