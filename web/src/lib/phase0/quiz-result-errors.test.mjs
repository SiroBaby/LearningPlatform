import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isQuizAttemptNotAvailableError,
  QUIZ_ATTEMPT_NOT_AVAILABLE_DESCRIPTION,
  QUIZ_ATTEMPT_NOT_AVAILABLE_TITLE,
} from "./quiz-result-errors.ts";

function makeServerError(status) {
  const error = new Error("Attempt lookup failed");
  error.name = "Phase0ServerError";
  error.status = status;
  return error;
}

test("maps owner-safe attempt 404s to the learner-safe unavailable state", () => {
  assert.equal(isQuizAttemptNotAvailableError(makeServerError(404)), true);
  assert.equal(QUIZ_ATTEMPT_NOT_AVAILABLE_TITLE, "Không thể mở kết quả quiz");
  assert.match(QUIZ_ATTEMPT_NOT_AVAILABLE_DESCRIPTION, /không tồn tại hoặc không thuộc tài khoản/u);
});

test("does not collapse unrelated server errors into the unavailable result state", () => {
  assert.equal(isQuizAttemptNotAvailableError(makeServerError(403)), false);
  assert.equal(isQuizAttemptNotAvailableError(makeServerError(500)), false);
  assert.equal(isQuizAttemptNotAvailableError(new Error("Attempt lookup failed")), false);
});
