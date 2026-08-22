export function getRetryConfirmErrorMessage(error: unknown): string {
  if (isSafeClientError(error) && error.message.trim().length > 0) {
    return error.message;
  }

  return "Chưa thể thử lại tài liệu lúc này. Bạn hãy đợi một chút rồi thử lại.";
}

function isSafeClientError(error: unknown): error is Error & {
  readonly code?: string;
  readonly retryable?: boolean;
  readonly status: number;
} {
  if (!(error instanceof Error) || error.name !== "Phase0ClientError") {
    return false;
  }

  const candidate = error as Error & {
    readonly code?: unknown;
    readonly retryable?: unknown;
    readonly status?: unknown;
  };
  return typeof candidate.status === "number"
    && (candidate.code === undefined || typeof candidate.code === "string")
    && (candidate.retryable === undefined || typeof candidate.retryable === "boolean");
}

interface CreateDocumentProcessingRetryActionOptions {
  readonly documentId: string;
  readonly refresh: () => Promise<void>;
  readonly setRetryError: (value: string | null) => void;
  readonly setIsRetrySubmitting: (value: boolean) => void;
  readonly confirmDocument: (documentId: string) => Promise<unknown>;
}

export function createDocumentProcessingRetryAction({
  documentId,
  refresh,
  setRetryError,
  setIsRetrySubmitting,
  confirmDocument,
}: CreateDocumentProcessingRetryActionOptions): () => Promise<void> {
  let isSubmitting = false;

  return async function retryDocumentProcessing(): Promise<void> {
    if (isSubmitting) {
      return;
    }

    isSubmitting = true;
    setIsRetrySubmitting(true);
    setRetryError(null);

    try {
      await confirmDocument(documentId);
      await refresh();
    } catch (confirmError) {
      setRetryError(getRetryConfirmErrorMessage(confirmError));
    } finally {
      isSubmitting = false;
      setIsRetrySubmitting(false);
    }
  };
}
