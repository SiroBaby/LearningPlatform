import type { Phase0DocumentProcessingFailureCode } from "@/lib/phase0/contracts";

export interface Phase0DocumentFailurePresentation {
  readonly title: string;
  readonly description: string;
  readonly retryable: boolean;
}

export const MEDIA_REQUIRES_PLATFORM_MODEL_MESSAGE =
  "MP3/MP4 chỉ dùng được với lựa chọn có trong gói. Chọn lại rồi tải lên.";

const RETRYABLE_FAILURE_CODES: readonly Phase0DocumentProcessingFailureCode[] = [
  "BUDGET_EXHAUSTED",
  "GENERATION_OUTPUT_INVALID",
  "GENERATION_OUTPUT_TRUNCATED",
  "INSUFFICIENT_CREDITS_AFTER_EXTRACT",
  "MEDIA_PROBE_STORAGE_TEMPORARY",
  "MEDIA_PROBE_TIMEOUT",
  "PROCESSING_TIMED_OUT",
  "PROVIDER_UNAVAILABLE",
] as const;

export function isRetryableDocumentFailureCode(
  errorCode: Phase0DocumentProcessingFailureCode | null,
): boolean {
  return errorCode !== null && RETRYABLE_FAILURE_CODES.includes(errorCode);
}

/** Error copy never shows credit amounts, so the backend sentence that carries them is not displayed. */
export function getDocumentFailurePresentation(
  errorCode: Phase0DocumentProcessingFailureCode | null,
): Phase0DocumentFailurePresentation {
  switch (errorCode) {
    case "BUDGET_EXHAUSTED":
      return {
        title: "Chưa thể xử lý tài liệu",
        description: "Không đủ credit. Nạp thêm hoặc thử lại với file nhẹ hơn.",
        retryable: true,
      };
    case "CHUNK_RESOURCE_LIMIT_EXCEEDED":
      return {
        title: "Tài liệu quá dài hoặc quá dày",
        description: "Chia nhỏ tài liệu rồi tải lên lại.",
        retryable: false,
      };
    case "EXTRACTION_OBJECT_NOT_FOUND":
      return {
        title: "Không tìm thấy file tài liệu",
        description: "Tải file lên lại từ đầu.",
        retryable: false,
      };
    case "EXTRACTION_OBJECT_TOO_LARGE":
      return {
        title: "File quá lớn",
        description: "Thử lại với file nhẹ hơn.",
        retryable: false,
      };
    case "GENERATION_OUTPUT_INVALID":
      return {
        title: "Chưa thể tạo bộ câu hỏi ổn định",
        description: "Thử lại sau hoặc rút gọn nội dung tài liệu.",
        retryable: true,
      };
    case "GENERATION_OUTPUT_TRUNCATED":
      return {
        title: "Chưa thể tạo bộ câu hỏi hoàn chỉnh",
        description: "Thử lại sau để tạo lại bộ câu hỏi.",
        retryable: true,
      };
    case "INSUFFICIENT_CREDITS_AFTER_EXTRACT":
      return {
        title: "Chưa đủ credit để tạo câu hỏi",
        description: "Không đủ credit. Nạp thêm rồi thử lại.",
        retryable: true,
      };
    case "INSUFFICIENT_VALID_QUESTIONS":
      return {
        title: "Nội dung chưa đủ để tạo câu hỏi",
        description: "Thêm nội dung rõ ràng hơn rồi tải lên lại.",
        retryable: false,
      };
    case "MEDIA_AUDIO_PREP_FAILED":
      return {
        title: "Chưa thể xử lý âm thanh của file",
        description: "Thử lại với file MP3 hoặc MP4 khác.",
        retryable: false,
      };
    case "MEDIA_AUDIO_TRACK_REQUIRED":
      return {
        title: "Video chưa có âm thanh phù hợp",
        description: "Thử lại với video có tiếng giảng.",
        retryable: false,
      };
    case "MEDIA_DURATION_EXCEEDED":
      return {
        title: "File dài hơn giới hạn",
        description: "Thử lại với file dài tối đa 2 giờ.",
        retryable: false,
      };
    case "MEDIA_DURATION_MISMATCH":
      return {
        title: "Thời lượng file không khớp",
        description: "Xuất lại file rồi tải lên lại.",
        retryable: false,
      };
    case "MEDIA_OBJECT_TOO_LARGE":
      return {
        title: "File quá lớn",
        description: "Thử lại với file nhẹ hơn (MP4 tối đa 500 MB, MP3 tối đa 300 MB).",
        retryable: false,
      };
    case "MEDIA_AUDIO_NOT_PREPARED":
      return {
        title: "Chưa chuẩn bị xong âm thanh",
        description: "Tải file lên lại từ đầu.",
        retryable: false,
      };
    case "MEDIA_TRANSCRIPT_EMPTY":
      return {
        title: "Không nhận ra lời nói trong file",
        description: "Thử lại với file có giọng nói rõ hơn.",
        retryable: false,
      };
    case "MEDIA_PROBE_FAILED":
      return {
        title: "Không đọc được file video hoặc âm thanh",
        description: "Thử lại với file phát được và dài tối đa 2 giờ.",
        retryable: false,
      };
    case "MEDIA_PROBE_OUTPUT_CAP_EXCEEDED":
      return {
        title: "File có cấu trúc quá phức tạp",
        description: "Thử lại với định dạng MP4 đơn giản hơn.",
        retryable: false,
      };
    case "MEDIA_PROBE_STORAGE_TEMPORARY":
      return {
        title: "Chưa thể đọc file lúc này",
        description: "Lỗi tạm thời. Thử lại sau ít phút.",
        retryable: true,
      };
    case "MEDIA_PROBE_TIMEOUT":
      return {
        title: "Kiểm tra file mất lâu hơn dự kiến",
        description: "Thử lại sau hoặc thử với file ngắn hơn.",
        retryable: true,
      };
    case "MEDIA_PRICING_UNAVAILABLE":
      return {
        title: "Chưa thể tính credit cho file này",
        description: "Thử lại sau hoặc liên hệ hỗ trợ.",
        retryable: false,
      };
    case "MEDIA_REQUIRES_PLATFORM_MODEL":
      return {
        title: "MP3/MP4 chưa dùng được với lựa chọn này",
        description: MEDIA_REQUIRES_PLATFORM_MODEL_MESSAGE,
        retryable: false,
      };
    case "MEDIA_UNSUPPORTED_AUDIO_CODEC":
      return {
        title: "Âm thanh trong video chưa được hỗ trợ",
        description: "Thử lại với MP4 khác hoặc MP3.",
        retryable: false,
      };
    case "MEDIA_UNSUPPORTED_CONTAINER":
      return {
        title: "File chưa được hỗ trợ",
        description: "Thử lại với file MP4 hoặc MP3 không bị khóa bản quyền.",
        retryable: false,
      };
    case "MEDIA_UNSUPPORTED_VIDEO_CODEC":
      return {
        title: "Video chưa được hỗ trợ",
        description: "Thử lại với MP4 tối đa 1080p.",
        retryable: false,
      };
    case "PDF_INVALID":
      return {
        title: "File PDF không hợp lệ",
        description: "Thử lại với file PDF khác.",
        retryable: false,
      };
    case "PDF_TEXT_NOT_FOUND":
      return {
        title: "PDF chưa có phần chữ để đọc",
        description: "Thử lại với PDF có chữ chọn được.",
        retryable: false,
      };
    case "PROCESSING_FAILED":
      return {
        title: "Chưa thể xử lý tài liệu",
        description: "Kiểm tra file rồi tải lên lại.",
        retryable: false,
      };
    case "PROCESSING_TIMED_OUT":
      return {
        title: "Xử lý mất lâu hơn dự kiến",
        description: "Thử lại sau hoặc rút gọn tài liệu.",
        retryable: true,
      };
    case "PROVIDER_INCOMPATIBLE":
      return {
        title: "Dịch vụ chuyển giọng nói chưa nhận file này",
        description: "Thử lại với file MP3 hoặc MP4 khác.",
        retryable: false,
      };
    case "TRANSCRIPTION_OUTPUT_INVALID":
      return {
        title: "Chưa thể chuyển giọng nói thành văn bản",
        description: "Thử lại với file MP3 hoặc MP4 khác.",
        retryable: false,
      };
    case "PROVIDER_UNAVAILABLE":
      return {
        title: "Hệ thống đang bận",
        description: "Thử lại sau ít phút.",
        retryable: true,
      };
    case null:
      return {
        title: "Chưa thể xử lý tài liệu",
        description: "Kiểm tra file rồi tải lên lại.",
        retryable: false,
      };
  }
}
