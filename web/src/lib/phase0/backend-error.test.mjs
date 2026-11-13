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

test("preserves a safe shortfallCredits and drops malformed values", () => {
  assert.deepEqual(
    mapSafeBackendError({ code: "INSUFFICIENT_CREDITS", message: "x", shortfallCredits: 12, availableCredits: 3 }),
    { code: "INSUFFICIENT_CREDITS", message: "x", shortfallCredits: 12 },
  );
  assert.deepEqual(
    mapSafeBackendError({ code: "INSUFFICIENT_CREDITS", message: "x", shortfallCredits: -1 }),
    { code: "INSUFFICIENT_CREDITS", message: "x" },
  );
});

test("drops malformed optional backend error fields", () => {
  const error = mapSafeBackendError({
    code: 42,
    message: "Quiz is not ready",
    retryable: "yes",
  });

  assert.deepEqual(error, { message: "Quiz is not ready" });
});

test("preserves a safe 1-based line and drops malformed values", () => {
  assert.deepEqual(
    mapSafeBackendError({ code: "SUBTITLE_TIMESTAMP_INVALID", message: "x", retryable: false, line: 12, path: "/tmp/secret" }),
    { code: "SUBTITLE_TIMESTAMP_INVALID", message: "x", retryable: false, line: 12 },
  );
  for (const line of [0, -2, 1.5, "7", null]) {
    assert.deepEqual(
      mapSafeBackendError({ code: "SUBTITLE_TIMESTAMP_INVALID", message: "x", line }),
      { code: "SUBTITLE_TIMESTAMP_INVALID", message: "x" },
      String(line),
    );
  }
});
