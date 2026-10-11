import type { Phase0Document } from "@/lib/phase0/contracts";

const DOCUMENT_DELETION_RETRY_LATER_MESSAGE = "Chưa thể xóa tài liệu lúc này. Bạn hãy thử lại sau ít phút.";
const DOCUMENT_DELETION_FALLBACK_MESSAGE = "Chưa thể xóa tài liệu. Bạn hãy thử lại sau.";
const NOT_FOUND_STATUS = 404;
const PURGE_METADATA_UNAVAILABLE_CODE = "DOCUMENT_PURGE_METADATA_UNAVAILABLE";

interface DocumentDeletionClientError {
  readonly status: number;
  readonly code?: string;
  readonly retryable?: boolean;
}

/** A Document in DELETING is already removed from the owner's point of view. */
export function isDocumentDeleting(document: Pick<Phase0Document, "status">): boolean {
  return document.status === "DELETING";
}

/** Polling stops once the Document can no longer change on its own or is being deleted. */
export function isPollingStopStatus(status: Phase0Document["status"]): boolean {
  return status === "READY" || status === "FAILED" || status === "DELETING";
}

/** Focus returns to the confirm button after a failed deletion so it stays inside the dialog. */
export function shouldFocusDeletionConfirm({
  deletionError,
  isDeleting,
}: {
  readonly deletionError: string | null;
  readonly isDeleting: boolean;
}): boolean {
  return deletionError !== null && !isDeleting;
}

export function excludeDeletingDocuments<T extends Pick<Phase0Document, "status">>(
  documents: readonly T[],
): T[] {
  return documents.filter((document) => !isDocumentDeleting(document));
}

function isDocumentDeletionClientError(error: unknown): error is Error & DocumentDeletionClientError {
  if (!(error instanceof Error) || error.name !== "Phase0ClientError") {
    return false;
  }

  return typeof (error as Error & { readonly status?: unknown }).status === "number";
}

/** The Document no longer exists for this owner, e.g. it was deleted in another tab. */
export function isDocumentNotFoundError(error: unknown): boolean {
  return isDocumentDeletionClientError(error) &&
    (error.status === NOT_FOUND_STATUS || error.code === "DOCUMENT_NOT_FOUND");
}

export function getDocumentDeletionErrorMessage(error: unknown): string {
  if (!isDocumentDeletionClientError(error)) {
    return DOCUMENT_DELETION_FALLBACK_MESSAGE;
  }

  if (error.retryable === true || error.code === PURGE_METADATA_UNAVAILABLE_CODE) {
    return DOCUMENT_DELETION_RETRY_LATER_MESSAGE;
  }

  return DOCUMENT_DELETION_FALLBACK_MESSAGE;
}
