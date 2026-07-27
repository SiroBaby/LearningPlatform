import assert from "node:assert/strict";
import { test } from "node:test";

import { mapDocumentResponse } from "./mappers.ts";

const budgetStatuses = [
  "NOT_RESERVED",
  "CUSTOM_ZERO_COST",
  "SETTLED",
  "HELD",
  "EXHAUSTED",
];

for (const budgetStatus of budgetStatuses) {
  test(`maps a document with ${budgetStatus} budget status`, () => {
    const document = mapDocumentResponse({
      budgetStatus,
      createdAt: "2026-07-27T00:00:00.000Z",
      durationSec: null,
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
    });

    assert.equal(document.budgetStatus, budgetStatus);
  });
}
