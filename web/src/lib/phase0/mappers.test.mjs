import assert from "node:assert/strict";
import { test } from "node:test";

import { phase0DocumentProcessingFailureCodes } from "./contracts.ts";
import { mapAttemptHistoryResponse, mapDocumentResponse } from "./mappers.ts";

const budgetStatuses = [
  "NOT_RESERVED",
  "CUSTOM_ZERO_COST",
  "SETTLED",
  "HELD",
  "EXHAUSTED",
];

function buildDocumentOverrides(overrides = {}) {
  return {
    budgetStatus: "SETTLED",
    createdAt: "2026-07-27T00:00:00.000Z",
    durationSec: null,
    errorCode: null,
    errorMessage: null,
    estimateStatus: "COARSE",
    estimatedCredits: 100,
    id: "document-id",
    language: null,
    originalName: "lesson.pdf",
    pageCount: null,
    selectedModelKind: "PLAN",
    selectedModelLabel: "Fast platform model",
    settledCredits: null,
    sizeBytes: 1024,
    status: "PROCESSING",
    type: "PDF",
    updatedAt: "2026-07-27T00:00:00.000Z",
    ...overrides,
  };
}

for (const budgetStatus of budgetStatuses) {
  test(`maps a document with ${budgetStatus} budget status`, () => {
    const document = mapDocumentResponse(buildDocumentOverrides({ budgetStatus }));

    assert.equal(document.budgetStatus, budgetStatus);
  });
}

test("maps a document with AUTHORITATIVE estimate status", () => {
  const document = mapDocumentResponse(buildDocumentOverrides({
    budgetStatus: "SETTLED",
    estimateStatus: "AUTHORITATIVE",
    settledCredits: 80,
    status: "READY",
  }));

  assert.equal(document.estimateStatus, "AUTHORITATIVE");
});

test("maps a document with null errorCode", () => {
  const document = mapDocumentResponse(buildDocumentOverrides({ errorCode: null }));

  assert.equal(document.errorCode, null);
});

for (const errorCode of phase0DocumentProcessingFailureCodes) {
  test(`maps a document with ${errorCode} error code`, () => {
    const document = mapDocumentResponse(buildDocumentOverrides({
      errorCode,
      status: "FAILED",
    }));

    assert.equal(document.errorCode, errorCode);
  });
}

test("maps a document with truncated generation failure code", () => {
  const document = mapDocumentResponse(buildDocumentOverrides({
    errorCode: "GENERATION_OUTPUT_TRUNCATED",
    status: "FAILED",
  }));

  assert.equal(document.errorCode, "GENERATION_OUTPUT_TRUNCATED");
});

test("maps attempt history returned as a top-level array", () => {
  const attempts = mapAttemptHistoryResponse([
    {
      attemptId: "attempt-1",
      quizId: "quiz-1",
      submittedAt: "2026-07-27T00:00:00.000Z",
      score: 3,
      questionCount: 5,
    },
  ]);

  assert.deepEqual(attempts, [
    {
      attemptId: "attempt-1",
      quizId: "quiz-1",
      submittedAt: "2026-07-27T00:00:00.000Z",
      score: 3,
      questionCount: 5,
    },
  ]);
});
