/** Learner-facing copy for YouTube link and subtitle errors; keyed by the backend error code. */

interface SubtitleErrorLike {
  readonly code?: string;
  readonly line?: number;
}

const URL_INVALID_MESSAGE = "Link này không phải video YouTube. Kiểm tra lại link.";
const TOO_LONG_MESSAGE = "Phụ đề quá dài (tối đa 10.000 đoạn / 500.000 ký tự).";

const FIXED_MESSAGES: Readonly<Record<string, string>> = {
  YOUTUBE_URL_INVALID: URL_INVALID_MESSAGE,
  YOUTUBE_LESSONS_DISABLED: "Chưa dùng được video YouTube. Thử lại sau.",
  SUBTITLE_ENCODING_INVALID: "Không đọc được chữ trong file phụ đề. Lưu file dạng UTF-8 rồi thử lại.",
  SUBTITLE_FORMAT_INVALID: "File phụ đề không đúng dạng .vtt hoặc .srt.",
  SUBTITLE_TOO_MANY_CUES: TOO_LONG_MESSAGE,
  SUBTITLE_TOO_MANY_CHARS: TOO_LONG_MESSAGE,
  SUBTITLE_EMPTY: "Phụ đề không có nội dung.",
  SUBTITLE_TOO_LARGE: "File phụ đề tối đa 5 MB.",
  SUBTITLE_RIGHTS_CONFIRMATION_REQUIRED: "Tích ô xác nhận quyền dùng video và phụ đề để tiếp tục.",
  SUBTITLE_PREVIEW_REQUIRED: "Xem lại phụ đề trước khi xử lý.",
  SUBTITLE_PREVIEW_NOT_ALLOWED: "Không xem trước được phụ đề của tài liệu này.",
};

function buildLineMessage(line: number | undefined, withLine: (line: number) => string, withoutLine: string): string {
  return line === undefined ? withoutLine : withLine(line);
}

/** Returns Vietnamese copy for a known YouTube/subtitle error, or null for any other error. */
export function getSubtitleErrorMessage(error: SubtitleErrorLike): string | null {
  if (error.code === undefined) return null;
  if (error.code === "SUBTITLE_TIMESTAMP_INVALID") {
    return buildLineMessage(error.line, (line) => `Dòng ${line}: mốc thời gian không đúng.`, "Mốc thời gian trong phụ đề không đúng.");
  }
  if (error.code === "SUBTITLE_CUE_TOO_LONG") {
    return buildLineMessage(
      error.line,
      (line) => `Đoạn ở dòng ${line} quá dài (tối đa 2.000 ký tự).`,
      "Có đoạn phụ đề quá dài (tối đa 2.000 ký tự).",
    );
  }
  return FIXED_MESSAGES[error.code] ?? null;
}
