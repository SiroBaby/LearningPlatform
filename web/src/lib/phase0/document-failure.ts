import type { Phase0DocumentProcessingFailureCode } from "@/lib/phase0/contracts";

export interface Phase0DocumentFailurePresentation {
  readonly title: string;
  readonly description: string;
  readonly retryable: boolean;
}

export const MEDIA_REQUIRES_PLATFORM_MODEL_MESSAGE =
  "Tệp MP3/MP4 chỉ xử lý được bằng mô hình có trong gói của bạn, chưa dùng được với kết nối riêng. Hãy chọn mô hình có trong gói rồi tải lại.";

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

const INSUFFICIENT_CREDITS_AFTER_EXTRACT_FALLBACK =
  "Tài liệu cần thêm credit để tạo câu hỏi. Hãy bổ sung credit rồi thử lại.";

/**
 * `errorMessage` is only used for INSUFFICIENT_CREDITS_AFTER_EXTRACT: the backend writes the exact Vietnamese
 * sentence with the credit amounts (the Document needs N, the wallet has M), which a static string cannot carry.
 */
export function getDocumentFailurePresentation(
  errorCode: Phase0DocumentProcessingFailureCode | null,
  errorMessage: string | null = null,
): Phase0DocumentFailurePresentation {
  switch (errorCode) {
    case "BUDGET_EXHAUSTED":
      return {
        title: "Chưa thể xử lý tài liệu",
        description: "Bạn đã dùng hết credit cho lần này. Hãy chờ thêm rồi thử lại sau.",
        retryable: true,
      };
    case "CHUNK_RESOURCE_LIMIT_EXCEEDED":
      return {
        title: "Tài liệu quá dài hoặc quá dày",
        description: "Hãy chia nhỏ tài liệu hoặc bỏ bớt phần không cần thiết rồi tải lại.",
        retryable: false,
      };
    case "EXTRACTION_OBJECT_NOT_FOUND":
      return {
        title: "Không tìm thấy file tài liệu",
        description: "Hãy tải lại đúng file rồi bắt đầu lại từ đầu.",
        retryable: false,
      };
    case "EXTRACTION_OBJECT_TOO_LARGE":
      return {
        title: "File quá lớn",
        description: "Hãy giảm dung lượng file hoặc tách thành nhiều file nhỏ hơn rồi tải lại.",
        retryable: false,
      };
    case "GENERATION_OUTPUT_INVALID":
      return {
        title: "Chưa thể tạo bộ câu hỏi ổn định",
        description: "Hãy thử lại sau. Nếu lỗi lặp lại, bạn có thể rút gọn hoặc làm rõ nội dung tài liệu rồi tải lại.",
        retryable: true,
      };
    case "GENERATION_OUTPUT_TRUNCATED":
      return {
        title: "Chưa thể tạo bộ câu hỏi hoàn chỉnh",
        description: "Hãy thử lại sau để tạo lại bộ câu hỏi.",
        retryable: true,
      };
    case "INSUFFICIENT_CREDITS_AFTER_EXTRACT":
      return {
        title: "Chưa đủ credit để tạo câu hỏi",
        description: errorMessage?.trim() || INSUFFICIENT_CREDITS_AFTER_EXTRACT_FALLBACK,
        retryable: true,
      };
    case "INSUFFICIENT_VALID_QUESTIONS":
      return {
        title: "Nội dung chưa đủ để tạo câu hỏi",
        description: "Hãy bổ sung thêm nội dung rõ ràng, có ý chính đầy đủ rồi tải lại.",
        retryable: false,
      };
    case "MEDIA_AUDIO_PREP_FAILED":
      return {
        title: "Chưa thể xử lý âm thanh của file",
        description: "Hệ thống không tách được âm thanh để chuyển thành văn bản. Hãy xuất lại file rồi tải lại; nếu vẫn lỗi, hãy liên hệ quản trị viên.",
        retryable: false,
      };
    case "MEDIA_AUDIO_TRACK_REQUIRED":
      return {
        title: "Video chưa có âm thanh phù hợp",
        description: "Hãy dùng video có một luồng âm thanh chính chứa lời giảng rồi tải lại.",
        retryable: false,
      };
    case "MEDIA_DURATION_EXCEEDED":
      return {
        title: "File dài hơn giới hạn",
        description: "Âm thanh thực tế dài quá 2 giờ. Hãy cắt ngắn file rồi tải lại.",
        retryable: false,
      };
    case "MEDIA_DURATION_MISMATCH":
      return {
        title: "Thời lượng file không khớp",
        description: "Thời lượng ghi trong file khác nhiều so với âm thanh thật. Hãy xuất lại file rồi tải lại.",
        retryable: false,
      };
    case "MEDIA_OBJECT_TOO_LARGE":
      return {
        title: "File quá lớn",
        description: "MP4 tối đa 500 MiB, MP3 tối đa 300 MiB. Hãy cắt ngắn hoặc nén file rồi tải lại.",
        retryable: false,
      };
    case "MEDIA_AUDIO_NOT_PREPARED":
      return {
        title: "Chưa chuẩn bị xong âm thanh",
        description: "Hệ thống chưa chuẩn bị được âm thanh từ file này. Hãy tải lại file để bắt đầu lại.",
        retryable: false,
      };
    case "MEDIA_TRANSCRIPT_EMPTY":
      return {
        title: "Không nhận ra lời nói trong file",
        description: "File chưa có đủ lời nói rõ để tạo câu hỏi. Hãy dùng file có giọng nói rõ hơn rồi tải lại.",
        retryable: false,
      };
    case "MEDIA_PROBE_FAILED":
      return {
        title: "Không đọc được file video hoặc âm thanh",
        description: "File có thể bị hỏng hoặc dài quá 2 giờ. Hãy kiểm tra file phát được trên máy, cắt ngắn nếu cần rồi tải lại.",
        retryable: false,
      };
    case "MEDIA_PROBE_OUTPUT_CAP_EXCEEDED":
      return {
        title: "File có cấu trúc quá phức tạp",
        description: "Hãy xuất lại thành MP4 chỉ gồm một luồng video và một luồng âm thanh rồi tải lại.",
        retryable: false,
      };
    case "MEDIA_PROBE_STORAGE_TEMPORARY":
      return {
        title: "Chưa thể đọc file lúc này",
        description: "Đây là lỗi tạm thời. Hãy chờ một lúc rồi thử lại.",
        retryable: true,
      };
    case "MEDIA_PROBE_TIMEOUT":
      return {
        title: "Kiểm tra file mất lâu hơn dự kiến",
        description: "Hãy thử lại sau. Nếu vẫn lỗi, bạn có thể cắt ngắn file rồi tải lại.",
        retryable: true,
      };
    case "MEDIA_PRICING_UNAVAILABLE":
      return {
        title: "Chưa thể tính lượt dùng cho tệp này",
        description: "Hệ thống chưa tính được lượt dùng cho video hoặc âm thanh lúc này. Hãy thử tải lại sau hoặc liên hệ hỗ trợ nếu lỗi lặp lại.",
        retryable: false,
      };
    case "MEDIA_REQUIRES_PLATFORM_MODEL":
      return {
        title: "Video và âm thanh chưa hỗ trợ kết nối riêng",
        description: MEDIA_REQUIRES_PLATFORM_MODEL_MESSAGE,
        retryable: false,
      };
    case "MEDIA_UNSUPPORTED_AUDIO_CODEC":
      return {
        title: "Định dạng âm thanh chưa được hỗ trợ",
        description: "Hãy xuất lại MP4 với âm thanh AAC-LC (1 hoặc 2 kênh), hoặc dùng file MP3 không kèm ảnh bìa rồi tải lại.",
        retryable: false,
      };
    case "MEDIA_UNSUPPORTED_CONTAINER":
      return {
        title: "Định dạng file chưa được hỗ trợ",
        description: "Hãy dùng file MP4 hoặc MP3 không bị khóa bản quyền. Nếu là MP4, hãy xuất lại chỉ gồm hình và tiếng (bỏ phụ đề, track phụ) rồi tải lại.",
        retryable: false,
      };
    case "MEDIA_UNSUPPORTED_VIDEO_CODEC":
      return {
        title: "Định dạng video chưa được hỗ trợ",
        description: "Hãy xuất lại MP4 với một luồng video H.264 8-bit (yuv420p), tối đa 1080p (cạnh dài 1920 px) và tối đa 30 fps rồi tải lại.",
        retryable: false,
      };
    case "PDF_INVALID":
      return {
        title: "File PDF không hợp lệ",
        description: "Hãy mở lại file, xuất hoặc lưu thành PDF hợp lệ rồi tải lại.",
        retryable: false,
      };
    case "PDF_TEXT_NOT_FOUND":
      return {
        title: "PDF chưa có phần chữ để đọc",
        description: "Hãy dùng PDF có thể chọn được chữ hoặc thêm OCR trước khi tải lại.",
        retryable: false,
      };
    case "PROCESSING_FAILED":
      return {
        title: "Chưa thể xử lý tài liệu",
        description: "Hãy kiểm tra lại file và nội dung rồi tải lại một bản phù hợp hơn.",
        retryable: false,
      };
    case "PROCESSING_TIMED_OUT":
      return {
        title: "Xử lý mất lâu hơn dự kiến",
        description: "Hãy thử lại sau. Nếu vẫn chậm, bạn có thể rút gọn tài liệu rồi tải lại.",
        retryable: true,
      };
    case "PROVIDER_INCOMPATIBLE":
      return {
        title: "Dịch vụ chuyển giọng nói chưa nhận file này",
        description: "Hãy kiểm tra file rồi tải lại. Nếu lỗi lặp lại, hãy liên hệ hỗ trợ.",
        retryable: false,
      };
    case "TRANSCRIPTION_OUTPUT_INVALID":
      return {
        title: "Chưa thể chuyển giọng nói thành văn bản",
        description: "Dịch vụ trả về kết quả không hợp lệ. Hãy tải lại file; nếu lỗi lặp lại, hãy liên hệ hỗ trợ.",
        retryable: false,
      };
    case "PROVIDER_UNAVAILABLE":
      return {
        title: "Hệ thống đang bận",
        description: "Hãy chờ một lúc rồi thử lại sau.",
        retryable: true,
      };
    case null:
      return {
        title: "Chưa thể xử lý tài liệu",
        description: "Hãy kiểm tra file rồi tải lại.",
        retryable: false,
      };
  }
}
