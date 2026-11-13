export const SECONDS_PER_HOUR = 3600;
export const MEDIA_PLAYBACK_DEFAULT_TTL_SEC = 4 * SECONDS_PER_HOUR;
export const MEDIA_PLAYBACK_DURATION_MARGIN_SEC = 2 * SECONDS_PER_HOUR;
export const MEDIA_PLAYBACK_MAX_TTL_SEC = 12 * SECONDS_PER_HOUR;

export const MEDIA_PLAYBACK_REASONS = [
  'INITIAL',
  'SCHEDULED_REFRESH',
  'FOREGROUND',
  'EXPIRED',
  'MANUAL_RETRY',
] as const;

export type MediaPlaybackReason = (typeof MEDIA_PLAYBACK_REASONS)[number];

export const MEDIA_PLAYBACK_DEFAULT_REASON: MediaPlaybackReason = 'INITIAL';

/** ttl = min(MAX, max(DEFAULT, duration + margin)); unknown duration falls back to the default. */
export const calculateMediaPlaybackTtlSec = (durationSec: number | null): number =>
  Math.min(
    MEDIA_PLAYBACK_MAX_TTL_SEC,
    Math.max(MEDIA_PLAYBACK_DEFAULT_TTL_SEC, (durationSec ?? 0) + MEDIA_PLAYBACK_DURATION_MARGIN_SEC),
  );
