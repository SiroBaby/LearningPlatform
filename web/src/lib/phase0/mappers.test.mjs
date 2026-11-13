import assert from "node:assert/strict";
import { test } from "node:test";

import { phase0DocumentProcessingFailureCodes, phase0DocumentStatuses } from "./contracts.ts";
import {
  mapAttemptHistoryResponse,
  mapAttemptResultResponse,
  mapConfirmDocumentResponse,
  mapDocumentResponse,
  mapDocumentsResponse,
  mapEstimateResponse,
  mapPlaybackUrlResponse,
  mapPracticeFeedbackResponse,
  mapQuizResponse,
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

test("maps an AFTER_MEDIA_CHECK estimate with no credit number", () => {
  const estimate = mapEstimateResponse({
    estimatedCredits: null,
    precision: "AFTER_MEDIA_CHECK",
    selectedModelKind: "PLAN",
    selectedModelLabel: "Fast platform model",
  });

  assert.equal(estimate.estimatedCredits, null);
  assert.equal(estimate.precision, "AFTER_MEDIA_CHECK");
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

test("maps the MEDIA_REQUIRES_PLATFORM_MODEL failure code", () => {
  const document = mapDocumentResponse(buildDocumentOverrides({
    errorCode: "MEDIA_REQUIRES_PLATFORM_MODEL",
    status: "FAILED",
  }));

  assert.equal(document.errorCode, "MEDIA_REQUIRES_PLATFORM_MODEL");
});

function buildPracticeFeedback(locator) {
  return {
    questionId: "q1",
    selectedOptionId: "o1",
    isCorrect: true,
    explanation: "Giải thích.",
    citation: { chunkId: "c1", locator, snippet: "Câu trích." },
  };
}

test("maps a time citation locator with start and end seconds", () => {
  const mapped = mapPracticeFeedbackResponse(
    buildPracticeFeedback({ kind: "time", startSec: 65.5, endSec: 130 }),
  );
  assert.deepEqual(mapped.citation.locator, { kind: "time", startSec: 65.5, endSec: 130 });
});

test("maps a time citation locator without end as a single point", () => {
  const mapped = mapPracticeFeedbackResponse(buildPracticeFeedback({ kind: "time", startSec: 65 }));
  assert.deepEqual(mapped.citation.locator, { kind: "time", startSec: 65, endSec: 65 });
});

test("rejects a time citation locator without a valid start", () => {
  assert.throws(() => mapPracticeFeedbackResponse(buildPracticeFeedback({ kind: "time", endSec: 5 })), TypeError);
});

test("keeps page citation locators unchanged", () => {
  const mapped = mapPracticeFeedbackResponse(buildPracticeFeedback({ kind: "page", page: 3 }));
  assert.deepEqual(mapped.citation.locator, { kind: "page", page: 3 });
});

const playbackPayload = {
  url: "https://storage.example/media/key?X-Amz-Expires=14400",
  expiresAt: "2026-09-04T04:00:00.000Z",
  ttlSec: 14400,
  mimeType: "video/mp4",
  durationSec: 1800,
};

test("maps a playback URL response including a null duration", () => {
  assert.deepEqual(mapPlaybackUrlResponse(playbackPayload), playbackPayload);
  assert.equal(mapPlaybackUrlResponse({ ...playbackPayload, durationSec: null, mimeType: "audio/mpeg" }).durationSec, null);
});

test("rejects malformed playback URL responses", () => {
  for (const override of [
    { url: "javascript:alert(1)" },
    { url: "not a url" },
    { url: 5 },
    { expiresAt: "tomorrow" },
    { ttlSec: 0 },
    { ttlSec: 1.5 },
    { ttlSec: "14400" },
    { mimeType: "application/pdf" },
    { durationSec: -1 },
    { durationSec: "10" },
  ]) {
    assert.throws(() => mapPlaybackUrlResponse({ ...playbackPayload, ...override }), TypeError, JSON.stringify(override));
  }
});

function buildQuizQuestion(overrides = {}) {
  return {
    id: "q1",
    ordinal: 1,
    stem: "Câu hỏi?",
    options: [{ id: "o1", optionIndex: 0, content: "A" }],
    ...overrides,
  };
}

test("maps quiz documentId and a valid question timeRange", () => {
  const quiz = mapQuizResponse({
    id: "quiz-1",
    documentId: "doc-1",
    questions: [buildQuizQuestion({ timeRange: { startSec: 10, endSec: 25.5 } })],
  });

  assert.equal(quiz.documentId, "doc-1");
  assert.deepEqual(quiz.questions[0].timeRange, { startSec: 10, endSec: 25.5 });
});

test("reads missing quiz documentId and timeRange as null (older backend)", () => {
  const quiz = mapQuizResponse({ id: "quiz-1", questions: [buildQuizQuestion()] });

  assert.equal(quiz.documentId, null);
  assert.equal(quiz.questions[0].timeRange, null);
});

test("reads malformed timeRange values as null without throwing", () => {
  const malformed = [
    null,
    "10-20",
    [],
    {},
    { startSec: "1", endSec: 2 },
    { startSec: 5, endSec: 2 },
    { startSec: -1, endSec: 2 },
    { startSec: Number.NaN, endSec: 2 },
  ];

  for (const timeRange of malformed) {
    const quiz = mapQuizResponse({ id: "quiz-1", questions: [buildQuizQuestion({ timeRange })] });
    assert.equal(quiz.questions[0].timeRange, null, JSON.stringify(timeRange));
  }
});

test("maps attempt result documentId and tolerates its absence", () => {
  const base = {
    attemptId: "a1",
    quizId: "quiz-1",
    submittedAt: "2026-07-27T00:00:00.000Z",
    score: 1,
    questionCount: 1,
    results: [],
  };

  assert.equal(mapAttemptResultResponse({ ...base, documentId: "doc-1" }).documentId, "doc-1");
  assert.equal(mapAttemptResultResponse(base).documentId, null);
});
