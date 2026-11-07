import assert from "node:assert/strict";
import { test } from "node:test";

import { getInsufficientCreditsMessage, getPhase0UiErrorMessage } from "./ui-errors.ts";

test("maps known Phase 0 error codes to learner-facing copy", () => {
  const error = new Error("Quiz is still being prepared.");
  error.name = "Phase0ClientError";
  error.code = "QUIZ_NOT_READY";

  assert.equal(
    getPhase0UiErrorMessage(error, "fallback"),
    "Quiz đang được chuẩn bị. Quay lại sau ít phút.",
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

test("maps INSUFFICIENT_CREDITS to short copy without credit numbers", () => {
  const message = getInsufficientCreditsMessage(createCreditError(250));

  assert.equal(message, "Không đủ credit. Nạp thêm hoặc thử lại với file nhẹ hơn.");
  assert.doesNotMatch(message, /\d/u);
});

test("maps INSUFFICIENT_CREDITS without a shortfall and ignores other errors", () => {
  assert.equal(
    getInsufficientCreditsMessage(createCreditError()),
    "Không đủ credit. Nạp thêm hoặc thử lại với file nhẹ hơn.",
  );
  assert.equal(getInsufficientCreditsMessage(new Error("boom")), null);
});
