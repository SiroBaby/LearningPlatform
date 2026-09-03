export const QUIZ_ATTEMPT_NOT_AVAILABLE_TITLE = "Không thể mở kết quả quiz";
export const QUIZ_ATTEMPT_NOT_AVAILABLE_DESCRIPTION =
  "Kết quả này không tồn tại hoặc không thuộc tài khoản của bạn. Hãy mở lịch sử làm bài để chọn một kết quả khác.";

export function isQuizAttemptNotAvailableError(error: unknown): boolean {
  if (!(error instanceof Error) || error.name !== "Phase0ServerError") {
    return false;
  }

  return (error as Error & { readonly status?: unknown }).status === 404;
}
