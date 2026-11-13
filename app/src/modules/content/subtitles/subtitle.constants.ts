/** Bump when parsing or sanitizing rules change; stored with every snapshot. */
export const SUBTITLE_PARSER_VERSION = 'subtitle-parser-1';

export const MAX_SUBTITLE_BYTES = 5 * 1024 * 1024;
export const MAX_SUBTITLE_CUES = 10_000;
/** Counted in code points (runes) so the Go worker applies the identical cap. */
export const MAX_SUBTITLE_CHARS = 500_000;
export const MAX_SUBTITLE_CUE_CHARS = 2_000;
export const MAX_SUBTITLE_DURATION_MS = 24 * 60 * 60 * 1000;

export const MILLISECONDS_PER_SECOND = 1000;
export const SECONDS_PER_MINUTE = 60;
export const MINUTES_PER_HOUR = 60;
