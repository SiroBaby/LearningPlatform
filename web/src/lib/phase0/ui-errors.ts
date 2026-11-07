const PHASE0_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  DOCUMENT_NOT_FOUND: "Không tìm thấy tài liệu này hoặc tài liệu không còn sẵn sàng.",
  QUIZ_NOT_READY: "Quiz đang được chuẩn bị. Quay lại sau ít phút.",
  DOCUMENT_PROCESSING_FAILED: "Tài liệu chưa xử lý thành công. Xem trạng thái để biết bước tiếp theo.",
  QUIZ_INVARIANT_VIOLATION: "Chưa thể mở quiz. Thử lại sau.",
  DOCUMENT_RETRY_NOT_ALLOWED: "Chưa thể thử lại tài liệu này. Kiểm tra trạng thái hoặc tải lên tài liệu mới.",
  REQUEST_TIMEOUT: "Hệ thống phản hồi quá lâu. Thử lại sau ít phút.",
  SESSION_INVALID: "Phiên đăng nhập đã hết hạn. Đăng nhập lại.",
};

const INSUFFICIENT_CREDITS_CODE = "INSUFFICIENT_CREDITS";
const INSUFFICIENT_CREDITS_MESSAGE = "Không đủ credit. Nạp thêm hoặc thử lại với file nhẹ hơn.";

function isPhase0ClientError(error: unknown): error is Error & { readonly code?: string } {
  if (!(error instanceof Error) || error.name !== "Phase0ClientError") {
    return false;
  }

  const code = (error as Error & { readonly code?: unknown }).code;
  return code === undefined || typeof code === "string";
}

export function getPhase0UiErrorMessage(
  error: unknown,
  fallback: string,
): string {
  if (isPhase0ClientError(error) && error.code) {
    return PHASE0_ERROR_MESSAGES[error.code] ?? fallback;
  }

  return fallback;
}

/** Short copy for a confirm/retry rejected by a short credit balance (no amounts); null for any other error. */
export function getInsufficientCreditsMessage(error: unknown): string | null {
  if (!isPhase0ClientError(error) || error.code !== INSUFFICIENT_CREDITS_CODE) {
    return null;
  }

  return INSUFFICIENT_CREDITS_MESSAGE;
}
