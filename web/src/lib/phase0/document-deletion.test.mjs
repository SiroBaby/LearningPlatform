import assert from "node:assert/strict";
import { test } from "node:test";

import {
  excludeDeletingDocuments,
  getDocumentDeletionErrorMessage,
  isDocumentDeleting,
  isDocumentNotFoundError,
  isPollingStopStatus,
  shouldFocusDeletionConfirm,
} from "./document-deletion.ts";

function createClientError({ status, code, retryable }) {
  const error = new Error("backend message");
  error.name = "Phase0ClientError";
  error.status = status;
  error.code = code;
  error.retryable = retryable;
  return error;
}

test("treats only DELETING documents as deleting", () => {
  assert.equal(isDocumentDeleting({ status: "DELETING" }), true);
  for (const status of ["UPLOADED", "PROBING", "PROCESSING", "READY", "FAILED"]) {
    assert.equal(isDocumentDeleting({ status }), false);
  }
});

test("hides DELETING documents from the library list and keeps order", () => {
  const inputDocuments = [
    { id: "a", status: "READY" },
    { id: "b", status: "DELETING" },
    { id: "c", status: "PROCESSING" },
  ];

  const actualDocuments = excludeDeletingDocuments(inputDocuments);

  assert.deepEqual(actualDocuments.map((document) => document.id), ["a", "c"]);
});

test("asks the learner to retry later when purge metadata is temporarily unavailable", () => {
  const mockError = createClientError({
    status: 409,
    code: "DOCUMENT_PURGE_METADATA_UNAVAILABLE",
    retryable: true,
  });

  assert.equal(
    getDocumentDeletionErrorMessage(mockError),
    "Chưa thể xóa tài liệu lúc này. Bạn hãy thử lại sau ít phút.",
  );
});

test("asks the learner to retry later on a client timeout", () => {
  const mockError = createClientError({ status: 408, code: "REQUEST_TIMEOUT", retryable: true });

  assert.match(getDocumentDeletionErrorMessage(mockError), /thử lại sau ít phút/u);
});

test("recognizes a missing document as already deleted", () => {
  assert.equal(isDocumentNotFoundError(createClientError({ status: 404, code: "DOCUMENT_NOT_FOUND" })), true);
  assert.equal(isDocumentNotFoundError(createClientError({ status: 404 })), true);
  assert.equal(isDocumentNotFoundError(createClientError({ status: 409, code: "DOCUMENT_PURGE_METADATA_UNAVAILABLE" })), false);
  assert.equal(isDocumentNotFoundError(new Error("boom")), false);
});

test("never shows backend text for unknown failures", () => {
  const mockClientError = createClientError({ status: 500, code: "INTERNAL" });

  assert.equal(getDocumentDeletionErrorMessage(mockClientError), "Chưa thể xóa tài liệu. Bạn hãy thử lại sau.");
  assert.equal(getDocumentDeletionErrorMessage(new Error("boom")), "Chưa thể xóa tài liệu. Bạn hãy thử lại sau.");
  assert.equal(getDocumentDeletionErrorMessage("boom"), "Chưa thể xóa tài liệu. Bạn hãy thử lại sau.");
});

test("stops polling once the document is READY, FAILED or DELETING", () => {
  for (const status of ["READY", "FAILED", "DELETING"]) {
    assert.equal(isPollingStopStatus(status), true, status);
  }
  for (const status of ["UPLOADED", "PROBING", "PROCESSING"]) {
    assert.equal(isPollingStopStatus(status), false, status);
  }
});

test("returns focus to the confirm button only after a failed deletion settles", () => {
  assert.equal(shouldFocusDeletionConfirm({ deletionError: "Chưa thể xóa tài liệu.", isDeleting: false }), true);
  assert.equal(shouldFocusDeletionConfirm({ deletionError: "Chưa thể xóa tài liệu.", isDeleting: true }), false);
  assert.equal(shouldFocusDeletionConfirm({ deletionError: null, isDeleting: false }), false);
});
