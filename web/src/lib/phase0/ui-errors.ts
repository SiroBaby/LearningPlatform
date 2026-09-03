const PHASE0_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  DOCUMENT_NOT_FOUND: "Không tìm thấy tài liệu này hoặc tài liệu không còn sẵn sàng.",
  QUIZ_NOT_READY: "Quiz đang được chuẩn bị. Hãy quay lại sau ít phút.",
  DOCUMENT_PROCESSING_FAILED: "Tài liệu chưa xử lý thành công. Hãy xem trạng thái để biết bước tiếp theo.",
  QUIZ_INVARIANT_VIOLATION: "Chưa thể mở quiz lúc này. Hãy thử lại sau.",
  DOCUMENT_RETRY_NOT_ALLOWED: "Tài liệu này chưa thể thử lại ở trạng thái hiện tại. Hãy kiểm tra trạng thái hoặc tải lên tài liệu mới.",
  REQUEST_TIMEOUT: "Hệ thống phản hồi quá lâu. Bạn hãy thử lại sau ít phút.",
  SESSION_INVALID: "Phiên đăng nhập không còn hiệu lực. Hãy đăng nhập lại.",
};

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
