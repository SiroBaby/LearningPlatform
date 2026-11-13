import type { SelectedPhase0File } from "./upload-workspace-utils";

export const MAX_SUBTITLE_SIZE_BYTES = 5 * 1024 * 1024;
export const SUBTITLE_FILE_ACCEPT = ".vtt,.srt,text/vtt,application/x-subrip,text/plain";

const SUBTITLE_EXTENSIONS: readonly string[] = ["vtt", "srt"];
/** Browsers often report an empty or generic type for .srt and .vtt files. */
const ACCEPTED_SUBTITLE_MIME_TYPES: readonly string[] = [
  "",
  "text/vtt",
  "text/plain",
  "text/srt",
  "application/x-subrip",
  "application/octet-stream",
];

export const SUBTITLE_EMPTY_FILE_MESSAGE = "File trống. Chọn file khác.";
export const SUBTITLE_WRONG_FORMAT_MESSAGE = "File phụ đề không đúng dạng .vtt hoặc .srt.";
export const SUBTITLE_TOO_LARGE_MESSAGE = "File phụ đề tối đa 5 MB.";

function readExtension(name: string): string {
  const segments = name.split(".");
  return segments.length > 1 ? (segments.at(-1)?.toLowerCase() ?? "") : "";
}

/** Checks the subtitle file before any upload; the backend validates the content itself. */
export function normalizeSubtitleSelection(file: File): SelectedPhase0File | { readonly error: string } {
  if (file.size <= 0) return { error: SUBTITLE_EMPTY_FILE_MESSAGE };
  const mimeType = file.type.trim().toLowerCase();
  if (!SUBTITLE_EXTENSIONS.includes(readExtension(file.name)) || !ACCEPTED_SUBTITLE_MIME_TYPES.includes(mimeType)) {
    return { error: SUBTITLE_WRONG_FORMAT_MESSAGE };
  }
  if (file.size > MAX_SUBTITLE_SIZE_BYTES) return { error: SUBTITLE_TOO_LARGE_MESSAGE };
  return { file, normalizedType: "YOUTUBE" };
}
