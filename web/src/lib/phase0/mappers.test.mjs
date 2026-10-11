import assert from "node:assert/strict";
import { test } from "node:test";

import { phase0DocumentProcessingFailureCodes, phase0DocumentStatuses } from "./contracts.ts";
import {
  mapAttemptHistoryResponse,
  mapConfirmDocumentResponse,
  mapDocumentResponse,
  mapDocumentsResponse,
} from "./mappers.ts";

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

test("maps an unknown error code to null instead of failing the document", () => {
  const document = mapDocumentResponse(buildDocumentOverrides({
    errorCode: "MEDIA_SOMETHING_NEW",
    status: "FAILED",
  }));

  assert.equal(document.status, "FAILED");
  assert.equal(document.errorCode, null);
});

test("rejects a non-string error code", () => {
  assert.throws(() => mapDocumentResponse(buildDocumentOverrides({ errorCode: 42, status: "FAILED" })), TypeError);
});

test("maps a document list containing a failed media document", () => {
  const documents = mapDocumentsResponse([
    buildDocumentOverrides({ id: "pdf-id", status: "READY" }),
    buildDocumentOverrides({
      durationSec: null,
      errorCode: "MEDIA_UNSUPPORTED_AUDIO_CODEC",
      id: "media-id",
      originalName: "lesson.mp4",
      status: "FAILED",
      type: "VIDEO",
    }),
    buildDocumentOverrides({ errorCode: "FUTURE_FAILURE_CODE", id: "future-id", status: "FAILED" }),
  ]);

  assert.deepEqual(
    documents.map((document) => [document.id, document.errorCode]),
    [["pdf-id", null], ["media-id", "MEDIA_UNSUPPORTED_AUDIO_CODEC"], ["future-id", null]],
  );
});

const backendDocumentStatuses = ["UPLOADED", "PROBING", "PROCESSING", "READY", "FAILED", "DELETING"];

test("keeps the document status union aligned with backend DocumentStatus", () => {
  assert.deepEqual([...phase0DocumentStatuses], backendDocumentStatuses);
});

for (const status of backendDocumentStatuses) {
  test(`maps a document with ${status} status`, () => {
    const document = mapDocumentResponse(buildDocumentOverrides({ status }));

    assert.equal(document.status, status);
  });
}

test("maps a document list containing a DELETING document without failing the library", () => {
  const documents = mapDocumentsResponse([
    buildDocumentOverrides({ id: "ready-id", status: "READY" }),
    buildDocumentOverrides({ id: "deleting-id", status: "DELETING" }),
  ]);

  assert.deepEqual(
    documents.map((document) => [document.id, document.status]),
    [["ready-id", "READY"], ["deleting-id", "DELETING"]],
  );
});

test("maps the accepted delete response with DELETING status", () => {
  const response = mapConfirmDocumentResponse({ documentId: "document-id", status: "DELETING" });

  assert.deepEqual(response, { documentId: "document-id", status: "DELETING" });
});

test("rejects an unknown document status", () => {
  assert.throws(
    () => mapDocumentResponse(buildDocumentOverrides({ status: "PURGED" })),
    /document\.status to be a valid document status/u,
  );
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
