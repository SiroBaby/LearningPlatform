import assert from "node:assert/strict";
import { test } from "node:test";

import { getPhase0UiErrorMessage } from "./ui-errors.ts";

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
