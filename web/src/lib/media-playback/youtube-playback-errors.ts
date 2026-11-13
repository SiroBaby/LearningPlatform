/** Maps YouTube IFrame `onError` codes to what the learner can do next. */

export type YouTubePlaybackErrorKind = "unavailable" | "unplayable" | "load-failed";

/** 2 invalid id, 100 removed or private, 101/150 embedding disabled, 153 missing referrer: retrying cannot help. */
const FATAL_ERROR_CODES: ReadonlySet<number> = new Set([2, 100, 101, 150, 153]);

const ERROR_MESSAGES: Readonly<Record<YouTubePlaybackErrorKind, string>> = {
  unavailable: "Video này không còn phát được. Bạn vẫn có thể làm quiz.",
  unplayable: "Trình duyệt không phát được video này.",
  "load-failed": "Không tải được trình phát video.",
};

/** Fatal codes mean the video itself cannot play; every other code (5 included) may work after a retry. */
export function classifyYouTubeErrorCode(code: number): YouTubePlaybackErrorKind {
  return FATAL_ERROR_CODES.has(code) ? "unavailable" : "unplayable";
}

export function getYouTubePlaybackErrorMessage(kind: YouTubePlaybackErrorKind): string {
  return ERROR_MESSAGES[kind];
}

export function canRetryYouTubePlayback(kind: YouTubePlaybackErrorKind): boolean {
  return kind !== "unavailable";
}
