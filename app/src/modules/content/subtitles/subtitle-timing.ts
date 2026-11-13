import {
  MAX_SUBTITLE_DURATION_MS,
  MILLISECONDS_PER_SECOND,
  MINUTES_PER_HOUR,
  SECONDS_PER_MINUTE,
} from './subtitle.constants';
import type { SubtitleFormat } from './subtitle.types';

export interface TimingRange {
  readonly startMs: number;
  readonly endMs: number;
}

const MAX_CLOCK_FIELD = 59;
const VTT_TIMING_PATTERN =
  /^(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})[ \t]+-->[ \t]+(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})(?:[ \t][^\n]*)?$/u;
const SRT_TIMING_PATTERN =
  /^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})[ \t]+-->[ \t]+(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})(?:[ \t]+X1:[^\n]*)?[ \t]*$/u;

/** True when a source line is meant to be a timing line, whether or not it is well formed. */
export function looksLikeTimingLine(line: string): boolean {
  return line.includes('-->');
}

/**
 * Parses one timing line. Returns null for any malformed line or invalid range (minutes/seconds above 59,
 * end not after start, end beyond 24 hours).
 */
export function parseTimingLine(line: string, format: SubtitleFormat): TimingRange | null {
  const match = (format === 'VTT' ? VTT_TIMING_PATTERN : SRT_TIMING_PATTERN).exec(line);
  if (!match) return null;
  const fields = match.slice(1).map((value) => (value === undefined ? 0 : Number(value)));
  const [startHours, startMinutes, startSeconds, startMillis, endHours, endMinutes, endSeconds, endMillis] = fields;
  if (![startMinutes, startSeconds, endMinutes, endSeconds].every((field) => field <= MAX_CLOCK_FIELD)) {
    return null;
  }
  const startMs = toMilliseconds(startHours, startMinutes, startSeconds, startMillis);
  const endMs = toMilliseconds(endHours, endMinutes, endSeconds, endMillis);
  if (endMs <= startMs || endMs > MAX_SUBTITLE_DURATION_MS) return null;
  return { startMs, endMs };
}

function toMilliseconds(hours: number, minutes: number, seconds: number, millis: number): number {
  const totalSeconds = (hours * MINUTES_PER_HOUR + minutes) * SECONDS_PER_MINUTE + seconds;
  return totalSeconds * MILLISECONDS_PER_SECOND + millis;
}
