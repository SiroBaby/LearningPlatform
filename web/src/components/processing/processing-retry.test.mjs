import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createDocumentProcessingRetryAction,
  getRetryConfirmErrorMessage,
} from "./processing-retry.ts";
import { shouldRestoreRetryFocus } from "./processing-focus.ts";

class SafeClientError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "Phase0ClientError";
    this.status = status;
  }
}

test("retry action confirms document and refreshes status on success", async () => {
  const calls = [];
  const retryErrors = [];
  const submittingStates = [];

  const retry = createDocumentProcessingRetryAction({
    documentId: "document-123",
    refresh: async () => {
      calls.push("refresh");
    },
    setRetryError: (value) => {
      retryErrors.push(value);
    },
    setIsRetrySubmitting: (value) => {
      submittingStates.push(value);
    },
    confirmDocument: async (documentId) => {
      calls.push(`confirm:${documentId}`);
      return { documentId, status: "PROCESSING" };
    },
  });

  await retry();

  assert.deepEqual(calls, ["confirm:document-123", "refresh"]);
  assert.deepEqual(retryErrors, [null]);
  assert.deepEqual(submittingStates, [true, false]);
});

test("retry action surfaces safe error when confirm fails", async () => {
  const retryErrors = [];
  const submittingStates = [];

  const retry = createDocumentProcessingRetryAction({
    documentId: "document-123",
    refresh: async () => {
      throw new Error("refresh should not run");
    },
    setRetryError: (value) => {
      retryErrors.push(value);
    },
    setIsRetrySubmitting: (value) => {
      submittingStates.push(value);
    },
    confirmDocument: async () => {
      throw new SafeClientError(409, "Bạn hãy đợi một chút rồi thử lại.");
    },
  });

  await retry();

  assert.deepEqual(retryErrors, [null, "Bạn hãy đợi một chút rồi thử lại."]);
  assert.deepEqual(submittingStates, [true, false]);
});

test("retry action ignores duplicate submissions while confirm is in flight", async () => {
  let resolveConfirm;
  let confirmCalls = 0;
  const retryErrors = [];
  const submittingStates = [];

  const retry = createDocumentProcessingRetryAction({
    documentId: "document-123",
    refresh: async () => {},
    setRetryError: (value) => {
      retryErrors.push(value);
    },
    setIsRetrySubmitting: (value) => {
      submittingStates.push(value);
    },
    confirmDocument: async () => {
      confirmCalls += 1;
      await new Promise((resolve) => {
        resolveConfirm = resolve;
      });
      return { documentId: "document-123", status: "PROCESSING" };
    },
  });

  const firstAttempt = retry();
  const secondAttempt = retry();
  resolveConfirm();

  await Promise.all([firstAttempt, secondAttempt]);

  assert.equal(confirmCalls, 1);
  assert.deepEqual(retryErrors, [null]);
  assert.deepEqual(submittingStates, [true, false]);
});

test("maps unknown retry confirm failures to safe fallback copy", () => {
  assert.equal(
    getRetryConfirmErrorMessage(new Error("connect ECONNREFUSED 127.0.0.1:3000")),
    "Chưa thể thử lại tài liệu lúc này. Bạn hãy đợi một chút rồi thử lại.",
  );
});

test("restores retry focus only when a new retry error appears after submit finishes", () => {
  assert.equal(
    shouldRestoreRetryFocus({
      previousRetryError: null,
      retryError: "Bạn hãy đợi một chút rồi thử lại.",
      isRetrySubmitting: false,
    }),
    true,
  );

  assert.equal(
    shouldRestoreRetryFocus({
      previousRetryError: "Bạn hãy đợi một chút rồi thử lại.",
      retryError: "Bạn hãy đợi một chút rồi thử lại.",
      isRetrySubmitting: false,
    }),
    false,
  );

  assert.equal(
    shouldRestoreRetryFocus({
      previousRetryError: null,
      retryError: "Bạn hãy đợi một chút rồi thử lại.",
      isRetrySubmitting: true,
    }),
    false,
  );

  assert.equal(
    shouldRestoreRetryFocus({
      previousRetryError: null,
      retryError: null,
      isRetrySubmitting: false,
    }),
    false,
  );
});
