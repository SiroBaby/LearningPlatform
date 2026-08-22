import assert from "node:assert/strict";
import { test } from "node:test";

import { mapSafeBackendError } from "./backend-error.ts";

test("preserves safe machine-readable backend error fields", () => {
  const error = mapSafeBackendError({
    code: "DOCUMENT_PROCESSING_FAILED",
    internalDetail: "must not cross the BFF boundary",
    message: "Processing budget was exhausted",
    retryable: true,
  });

  assert.deepEqual(error, {
    code: "DOCUMENT_PROCESSING_FAILED",
    message: "Processing budget was exhausted",
    retryable: true,
  });
});

test("drops malformed optional backend error fields", () => {
  const error = mapSafeBackendError({
    code: 42,
    message: "Quiz is not ready",
    retryable: "yes",
  });

  assert.deepEqual(error, { message: "Quiz is not ready" });
});
