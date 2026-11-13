export enum SubtitleParseErrorCode {
  SUBTITLE_TOO_LARGE = 'SUBTITLE_TOO_LARGE',
  SUBTITLE_ENCODING_INVALID = 'SUBTITLE_ENCODING_INVALID',
  SUBTITLE_FORMAT_INVALID = 'SUBTITLE_FORMAT_INVALID',
  SUBTITLE_TIMESTAMP_INVALID = 'SUBTITLE_TIMESTAMP_INVALID',
  SUBTITLE_CUE_TOO_LONG = 'SUBTITLE_CUE_TOO_LONG',
  SUBTITLE_TOO_MANY_CUES = 'SUBTITLE_TOO_MANY_CUES',
  SUBTITLE_TOO_MANY_CHARS = 'SUBTITLE_TOO_MANY_CHARS',
  SUBTITLE_EMPTY = 'SUBTITLE_EMPTY',
}

/** Typed, content-free parse failure. `line` is the 1-based source line when one applies. */
export class SubtitleParseError extends Error {
  constructor(
    readonly code: SubtitleParseErrorCode,
    readonly line?: number,
  ) {
    super(code);
    this.name = 'SubtitleParseError';
  }
}
