const RETRY_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  DOCUMENT_RETRY_NOT_ALLOWED: "Tài liệu này chưa thể thử lại ở trạng thái hiện tại. Hãy kiểm tra trạng thái hoặc tải lên tài liệu mới.",
  REQUEST_TIMEOUT: "Hệ thống phản hồi quá lâu. Bạn hãy thử lại sau ít phút.",
};

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

export function getRetryConfirmErrorMessage(error: unknown): string {
  if (isSafeClientError(error) && error.code && RETRY_ERROR_MESSAGES[error.code]) {
    return RETRY_ERROR_MESSAGES[error.code];
  }

  return "Chưa thể thử lại tài liệu lúc này. Bạn hãy đợi một chút rồi thử lại.";
}

interface CreateDocumentProcessingRetryActionOptions {
  readonly documentId: string;
  readonly refresh: () => Promise<void>;
  readonly setRetryError: (value: string | null) => void;
  readonly setIsRetrySubmitting: (value: boolean) => void;
  readonly retryDocument: (documentId: string) => Promise<unknown>;
}

export function createDocumentProcessingRetryAction({
  documentId,
  refresh,
  setRetryError,
  setIsRetrySubmitting,
  retryDocument,
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
      await retryDocument(documentId);
      await refresh();
    } catch (retryError) {
      setRetryError(getRetryConfirmErrorMessage(retryError));
    } finally {
      isSubmitting = false;
      setIsRetrySubmitting(false);
    }
  };
}
